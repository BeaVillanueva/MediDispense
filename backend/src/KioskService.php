<?php
declare(strict_types=1);

final class KioskError extends RuntimeException {
    public function __construct(public readonly string $errorCode, string $message, public readonly int $httpStatus=409) { parent::__construct($message); }
}

/** MySQL is authoritative. This service never activates hardware. */
final class KioskService {
    public function __construct(
        private PDO $db,
        private string $machineCode,
        private FirebaseRealtimeDatabase $firebase
    ) {}
    private function one(string $sql, array $args=[]): ?array { $s=$this->db->prepare($sql); $s->execute($args); return $s->fetch() ?: null; }
    private function exec(string $sql, array $args=[]): void { $this->db->prepare($sql)->execute($args); }
    private function atomic(callable $action): mixed {
        // Competing checkouts can deadlock on index gap locks. Retry only a fully
        // rolled-back database transaction, never a hardware action.
        for($attempt=0; ; $attempt++) {
            $this->db->beginTransaction();
            try { $value=$action(); $this->db->commit(); return $value; }
            catch(Throwable $e) {
                if($this->db->inTransaction()) $this->db->rollBack();
                if($e instanceof PDOException && in_array((int)($e->errorInfo[1]??0),[1205,1213],true) && $attempt<2) { usleep(20000); continue; }
                throw $e;
            }
        }
    }
    private static function cents(mixed $value): int {
        if (!is_numeric($value) || !is_finite((float)$value) || (float)$value < 0 || (float)$value > 99999999) throw new KioskError('INVALID_AMOUNT','Invalid coin amount.',422);
        return (int)round((float)$value*100);
    }
    private static function money(int $cents): string { return number_format($cents/100,2,'.',''); }
    private function transaction(int $id, bool $lock=false): array {
        $t=$this->one('SELECT *, (expires_at IS NOT NULL AND expires_at < NOW()) AS is_expired FROM transactions WHERE id=?'.($lock?' FOR UPDATE':''),[$id]);
        if(!$t) throw new KioskError('TRANSACTION_NOT_FOUND','Purchase not found.',404);
        return $t;
    }
    private function item(int $id): array {
        $item=$this->one('SELECT * FROM transaction_items WHERE transaction_id=? ORDER BY id LIMIT 1',[$id]);
        if(!$item) throw new KioskError('TRANSACTION_NOT_FOUND','Purchase item not found.',404);
        return $item;
    }
    private function authorize(array $t,string $token): void {
        if(!preg_match('/^[a-f0-9]{64}$/D',$token) || !$t['access_token_hash'] || !hash_equals($t['access_token_hash'],hash('sha256',$token))) throw new KioskError('TRANSACTION_NOT_FOUND','Purchase not found.',404);
    }
    public function expireUnpaid(): void {
        $rows=$this->db->query("SELECT id FROM transactions WHERE checkout_key IS NOT NULL AND payment_status='pending' AND amount_paid=0 AND expires_at < NOW() LIMIT 100")->fetchAll();
        foreach($rows as $row) $this->atomic(function() use($row) {
            $t=$this->transaction((int)$row['id'],true);
            if($t['payment_status']==='pending' && self::cents($t['amount_paid'])===0 && (bool)$t['is_expired']) $this->cancelLocked($t);
        });
    }
    public function medicines(bool $available=true): array {
        if($available) $this->expireUnpaid();
        $sql="SELECT m.*,c.name category_name,c.is_active category_active,i.quantity,i.reserved_quantity,s.id slot_id,s.slot_number,s.slot_status,ma.machine_code,ma.is_enabled machine_enabled FROM medicines m JOIN medicine_categories c ON c.id=m.category_id JOIN inventory i ON i.medicine_id=m.id LEFT JOIN machine_slots s ON s.medicine_id=m.id LEFT JOIN machines ma ON ma.id=s.machine_id ORDER BY m.name,s.id";
        $rows=[]; $today=(string)$this->db->query('SELECT CURDATE()')->fetchColumn();
        foreach($this->db->query($sql)->fetchAll() as $r) {
            $stock=$available ? max(0,(int)$r['quantity']-(int)$r['reserved_quantity']) : (int)$r['quantity'];
            $eligible=$r['is_enabled'] && $r['category_active'] && $r['machine_enabled'] && $r['machine_code']===$this->machineCode && in_array($r['slot_status'],['ready','low'],true) && $r['expiry_date']>=$today;
            if($available && (!$eligible || $stock<1)) continue;
            $status=$r['expiry_date']<$today?'expired':($stock===0?'out_of_stock':($r['expiry_date']<=date('Y-m-d',strtotime($today.' +30 days'))?'near_expiry':($stock<=(int)$r['minimum_stock_level']?'low_stock':'in_stock')));
            $row=['id'=>(int)$r['id'],'name'=>$r['name'],'genericName'=>$r['generic_name'],'category'=>$r['category_name'],'description'=>$r['description'],'dosage'=>$r['dosage_information'],'instructions'=>$r['usage_instructions'],'stockQuantity'=>$stock,'minimumStockLevel'=>(int)$r['minimum_stock_level'],'price'=>(float)$r['unit_price'],'expiryDate'=>$r['expiry_date'],'imageUrl'=>$r['image_url']??'','slotNumber'=>$r['slot_number']===null?null:(int)$r['slot_number'],'slotId'=>$r['slot_id']===null?null:(int)$r['slot_id'],'status'=>$status,'enabled'=>(bool)$r['is_enabled'],'dateAdded'=>$r['created_at'],'updatedAt'=>$r['updated_at']];
            // One catalog entry per medicine. Checkout independently revalidates its slot.
            if(!isset($rows[$row['id']])) $rows[$row['id']]=$row;
        }
        return array_values($rows);
    }
    public function checkout(array $body,string $token): array {
        $items=$body['items']??[]; $key=$body['request_id']??'';
        if(!is_array($items)||count($items)!==1||!is_array($items[0]??null)) throw new KioskError('INVALID_QUANTITY','Choose exactly one medicine.',422);
        $item=$items[0]; $qty=$item['quantity']??null; $medicineId=$item['medicine_id']??null;
        if(!is_int($qty)||$qty<1||!is_int($medicineId)||$medicineId<1) throw new KioskError('INVALID_QUANTITY','Quantity must be a positive whole number.',422);
        if(!is_string($key)||!preg_match('/^[a-zA-Z0-9-]{16,64}$/D',$key)||!preg_match('/^[a-f0-9]{64}$/D',$token)) throw new KioskError('INVALID_REQUEST','A purchase request identifier and recovery token are required.',422);
        $this->expireUnpaid();
        return $this->atomic(function() use($item,$qty,$medicineId,$key,$token) {
            $existing=$this->one('SELECT * FROM transactions WHERE checkout_key=? FOR UPDATE',[$key]);
            if($existing) {
                $this->authorize($existing,$token); $old=$this->item((int)$existing['id']);
                if((int)$old['medicine_id']!==$medicineId||(int)$old['quantity']!==$qty) throw new KioskError('REQUEST_CONFLICT','This request identifier belongs to another purchase.');
                return $this->snapshot((int)$existing['id']);
            }
            $r=$this->one('SELECT m.*,i.quantity,i.reserved_quantity,c.is_active category_active,(m.expiry_date<CURDATE()) AS is_expired FROM medicines m JOIN inventory i ON i.medicine_id=m.id JOIN medicine_categories c ON c.id=m.category_id WHERE m.id=? FOR UPDATE',[$medicineId]);
            if(!$r||!$r['is_enabled']||!$r['category_active']||$r['is_expired']) throw new KioskError('MEDICINE_UNAVAILABLE','This medicine is unavailable.');
            $slot=$this->one("SELECT s.*,ma.is_enabled FROM machine_slots s JOIN machines ma ON ma.id=s.machine_id WHERE s.medicine_id=? AND ma.machine_code=? AND ma.is_enabled=1 AND s.slot_status IN ('ready','low') ORDER BY s.id LIMIT 1 FOR UPDATE",[$medicineId,$this->machineCode]);
            if(!$slot) throw new KioskError('SLOT_UNAVAILABLE','No active vending slot is assigned.');
            if((int)$r['quantity']-(int)$r['reserved_quantity']<$qty) throw new KioskError('OUT_OF_STOCK','Not enough medicine is available. Please review the quantity.');
            $total=self::money(self::cents($r['unit_price'])*$qty);
            $code='TXN-'.strtoupper(bin2hex(random_bytes(12)));
            $this->exec("INSERT INTO transactions(transaction_code,machine_id,subtotal,total_amount,checkout_key,access_token_hash,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))",[$code,$slot['machine_id'],$total,$total,$key,hash('sha256',$token)]);
            $id=(int)$this->db->lastInsertId();
            $this->exec('INSERT INTO transaction_items(transaction_id,medicine_id,slot_id,medicine_name_snapshot,unit_price_snapshot,quantity,subtotal) VALUES(?,?,?,?,?,?,?)',[$id,$medicineId,$slot['id'],$r['name'],$r['unit_price'],$qty,$total]);
            $this->exec('INSERT INTO payments(transaction_id,amount_due) VALUES(?,?)',[$id,$total]);
            $this->exec('UPDATE inventory SET reserved_quantity=reserved_quantity+? WHERE medicine_id=?',[$qty,$medicineId]);
            if(self::cents($total)===0) {
                $this->exec("UPDATE transactions SET payment_status='successful',expires_at=NULL WHERE id=?",[$id]);
                $this->exec("UPDATE payments SET status='successful',verified_at=NOW() WHERE transaction_id=?",[$id]);
                $this->queue($this->transaction($id));
            }
            // Reservation is not an inventory deduction. Physical quantity is unchanged.
            return $this->snapshot($id);
        });
    }
    public function get(int $id,string $token): array { $this->expireUnpaid(); $t=$this->transaction($id); $this->authorize($t,$token); return $this->snapshot($id); }
    public function recover(string $key,string $token): array {
        $t=$this->one('SELECT id FROM transactions WHERE checkout_key=?',[$key]);
        if(!$t) throw new KioskError('TRANSACTION_NOT_FOUND','Purchase not found.',404);
        return $this->get((int)$t['id'],$token);
    }
    private function cancelLocked(array $t): void {
        $item=$this->item((int)$t['id']);
        $this->exec('UPDATE inventory SET reserved_quantity=reserved_quantity-? WHERE medicine_id=? AND reserved_quantity>=?',[$item['quantity'],$item['medicine_id'],$item['quantity']]);
        $this->exec("UPDATE transactions SET payment_status='cancelled',dispensing_status='cancelled' WHERE id=?",[$t['id']]);
        $this->exec("UPDATE payments SET status='cancelled' WHERE transaction_id=?",[$t['id']]);
    }
    public function cancel(int $id,string $token): array {
        return $this->atomic(function() use($id,$token) {
            $t=$this->transaction($id,true); $this->authorize($t,$token);
            if($t['payment_status']==='cancelled') return $this->snapshot($id);
            if($t['payment_status']!=='pending'||self::cents($t['amount_paid'])>0||$t['dispensing_status']!=='pending') throw new KioskError('PAYMENT_IN_PROGRESS','Inserted coins cannot be returned. Contact assistance.');
            $this->cancelLocked($t); return $this->snapshot($id);
        });
    }
    /** Only a trusted hardware caller may enter this boundary. Amount is a coin delta. */
    public function coin(int $id,string $eventId,mixed $amount): array {
        $delta=self::cents($amount);
        if($delta<1||!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$eventId)) throw new KioskError('INVALID_COIN_EVENT','A positive coin amount and stable event ID are required.',422);
        return $this->atomic(function() use($id,$eventId,$delta) {
            $t=$this->transaction($id,true);
            if(!$t['checkout_key']) throw new KioskError('LEGACY_TRANSACTION','Legacy purchases require staff reconciliation.');
            $event=$this->one('SELECT amount FROM payment_events WHERE transaction_id=? AND event_id=?',[$id,$eventId]);
            if($event) { if(self::cents($event['amount'])!==$delta) throw new KioskError('EVENT_CONFLICT','Coin event already recorded with a different amount.'); return $this->snapshot($id); }
            if($t['payment_status']==='cancelled'||($t['payment_status']==='pending'&&self::cents($t['amount_paid'])===0&&(bool)$t['is_expired'])) throw new KioskError('PAYMENT_CLOSED','This coin session is closed. Contact assistance.');
            $inserted=self::cents($t['amount_paid'])+$delta; $paid=$inserted>=self::cents($t['total_amount']);
            $this->exec('INSERT INTO payment_events(transaction_id,event_id,amount) VALUES(?,?,?)',[$id,$eventId,self::money($delta)]);
            $this->exec('UPDATE transactions SET amount_paid=?,change_amount=0,payment_status=?,expires_at=NULL WHERE id=?',[self::money($inserted),$paid?'successful':'pending',$id]);
            $this->exec('UPDATE payments SET amount_inserted=?,status=?,verified_at=IF(?=1,NOW(),NULL) WHERE transaction_id=?',[self::money($inserted),$paid?'successful':'pending',$paid?1:0,$id]);
            if($paid && $t['dispensing_status']==='pending') $this->queue($t);
            return $this->snapshot($id);
        });
    }
    private function queue(array $t): void {
        $item=$this->item((int)$t['id']);
        $slot=$this->one('SELECT s.*,m.is_enabled machine_enabled FROM machine_slots s JOIN machines m ON m.id=s.machine_id WHERE s.id=? FOR UPDATE',[$item['slot_id']]);
        if(!$slot||!$slot['machine_enabled']||(int)$slot['medicine_id']!==(int)$item['medicine_id']||!in_array($slot['slot_status'],['ready','low'],true)) {
            // Money is durably recorded even if a slot was disabled during payment.
            $this->exec("UPDATE transactions SET dispensing_status='failed' WHERE id=?",[$t['id']]); return;
        }
        $payload=['transaction_id'=>(int)$t['id'],'slot_id'=>(int)$slot['id'],'slot_number'=>(int)$slot['slot_number'],'motor_id'=>$slot['motor_id'],'sensor_id'=>$slot['sensor_id'],'requested_quantity'=>(int)$item['quantity'],'next_unit_number'=>1];
        $this->exec('INSERT INTO dispensing_requests(transaction_id,machine_id,slot_id,quantity,command_reference,command_payload) VALUES(?,?,?,?,?,?)',[$t['id'],$slot['machine_id'],$slot['id'],$item['quantity'],'DISP-'.bin2hex(random_bytes(16)),json_encode($payload)]);
        $this->exec("UPDATE transactions SET dispensing_status='dispensing' WHERE id=?",[$t['id']]);
    }
    public function sent(int $requestId): array{
        $r = $this->one(
            'SELECT transaction_id FROM dispensing_requests WHERE id=?',
            [$requestId]
        );

        if (!$r) {
            throw new KioskError(
                'DISPENSE_NOT_ALLOWED',
                'Dispensing request not found.',
                404
            );
        }

        $result = $this->atomic(function () use ($r, $requestId) {
            $t = $this->transaction(
                (int)$r['transaction_id'],
                true
            );

            if (
                $t['payment_status'] !== 'successful' ||
                $t['dispensing_status'] !== 'dispensing'
            ) {
                throw new KioskError(
                    'DISPENSE_NOT_ALLOWED',
                    'No active paid dispensing request.'
                );
            }

            $this->exec(
                "UPDATE dispensing_requests
                SET request_status='sent',
                    sent_at=COALESCE(sent_at,NOW())
                WHERE id=?
                AND request_status IN ('queued','sent','dispensing')",
                [$requestId]
            );

            $request = $this->one(
                'SELECT * FROM dispensing_requests WHERE id=?',
                [$requestId]
            );

            $mapping = json_decode(
                $request['command_payload'],
                true
            );

            return [
                'dispensing_request_id' => $requestId,
                'command_reference' => $request['command_reference'],
                'unit_number' => (int)$request['dispensed_quantity'] + 1,
                'mapping' => $mapping,
            ];
        });

        $slot = (int)($result['mapping']['slot_number'] ?? 0);
        $quantity = (int)($result['mapping']['requested_quantity'] ?? 0);

        $this->firebase->sendDispenseCommand(
            $slot,
            $quantity
        );

        return $result;
    }
    public function sensor(int $requestId,int $unit,bool $success): array {
        $request=$this->one('SELECT * FROM dispensing_requests WHERE id=?',[$requestId]);
        if(!$request) throw new KioskError('DISPENSE_NOT_ALLOWED','Dispensing request not found.',404);
        return $this->atomic(function() use($request,$requestId,$unit,$success) {
            $id=(int)$request['transaction_id']; $t=$this->transaction($id,true);
            $r=$this->one('SELECT * FROM dispensing_requests WHERE id=? FOR UPDATE',[$requestId]);
            if(!$t['checkout_key']) throw new KioskError('LEGACY_TRANSACTION','Legacy requests require staff reconciliation.');
            $old=$this->one('SELECT sensor_confirmed FROM dispensing_logs WHERE dispensing_request_id=? AND unit_number=?',[$requestId,$unit]);
            if($old) { if((bool)$old['sensor_confirmed']!==$success) throw new KioskError('EVENT_CONFLICT','This unit already has a different result.'); return $this->snapshot($id); }
            if($t['payment_status']!=='successful'||$t['dispensing_status']!=='dispensing'||$unit!==(int)$r['dispensed_quantity']+1||$unit>(int)$r['quantity']) throw new KioskError('DISPENSE_NOT_ALLOWED','No matching active paid unit cycle.');
            $item=$this->item($id);
            $stock=$this->one('SELECT * FROM inventory WHERE medicine_id=? FOR UPDATE',[$item['medicine_id']]);
            $this->exec('INSERT INTO dispensing_logs(dispensing_request_id,event_type,sensor_confirmed,unit_number) VALUES(?,?,?,?)',[$requestId,$success?'dispensed_successfully':'dispensing_failed',$success?1:0,$unit]);
            if($success) {
                if(!$stock||(int)$stock['quantity']<1||(int)$stock['reserved_quantity']<1) throw new KioskError('STOCK_RECONCILIATION_REQUIRED','Confirmed unit requires inventory reconciliation.');
                $this->exec('UPDATE inventory SET quantity=quantity-1,reserved_quantity=reserved_quantity-1,last_counted_at=NOW() WHERE medicine_id=?',[$item['medicine_id']]);
                $this->exec("INSERT INTO stock_movements(medicine_id,transaction_id,dispensing_request_id,previous_quantity,new_quantity,change_quantity,change_type,reason) VALUES(?,?,?,?,?,-1,'successful_dispensing','Confirmed unit drop')",[$item['medicine_id'],$id,$requestId,$stock['quantity'],(int)$stock['quantity']-1]);
                $done=$unit===(int)$r['quantity'];
                $this->exec('UPDATE dispensing_requests SET dispensed_quantity=?,request_status=?,completed_at=IF(?=1,NOW(),NULL) WHERE id=?',[$unit,$done?'success':'queued',$done?1:0,$requestId]);
                $this->exec('UPDATE transactions SET dispensing_status=? WHERE id=?',[$done?'dispensed':'dispensing',$id]);
                $this->exec('UPDATE machine_slots SET last_dispensing_at=NOW() WHERE id=?',[$r['slot_id']]);
            } else {
                $remaining=(int)$r['quantity']-(int)$r['dispensed_quantity'];
                $this->exec('UPDATE inventory SET reserved_quantity=reserved_quantity-? WHERE medicine_id=? AND reserved_quantity>=?',[$remaining,$item['medicine_id'],$remaining]);
                $this->exec("UPDATE dispensing_requests SET request_status='failed',completed_at=NOW() WHERE id=?",[$requestId]);
                $this->exec("UPDATE transactions SET dispensing_status='failed' WHERE id=?",[$id]);
                $this->exec("INSERT INTO notifications(notification_type,title,message,severity,transaction_id) VALUES('dispensing_failure','Dispensing issue',?,'danger',?)",['Confirmed '.$r['dispensed_quantity'].' of '.$r['quantity'].' units. Assistance required.',$id]);
            }
            return $this->snapshot($id);
        });
    }
    public function snapshot(int $id): array {
        $t=$this->transaction($id); $item=$this->item($id);
        $r=$this->one('SELECT * FROM dispensing_requests WHERE transaction_id=? ORDER BY id DESC LIMIT 1',[$id]);
        $slot=$this->one('SELECT slot_number FROM machine_slots WHERE id=?',[$item['slot_id']]);
        $stmt=$this->db->prepare('SELECT * FROM transaction_items WHERE transaction_id=? ORDER BY id');
        $stmt->execute([$id]);
        $allItems=array_map(fn($line)=>['medicineId'=>(int)$line['medicine_id'],'medicineName'=>$line['medicine_name_snapshot'],'quantity'=>(int)$line['quantity'],'unitPrice'=>(float)$line['unit_price_snapshot'],'subtotal'=>(float)$line['subtotal']],$stmt->fetchAll());
        $inserted=(float)$t['amount_paid']; $total=(float)$t['total_amount'];
        return ['id'=>$t['transaction_code'],'databaseId'=>$id,'items'=>$allItems,'total'=>$total,'amountPaid'=>$inserted,'insertedAmount'=>$inserted,'remainingAmount'=>max(0,round($total-$inserted,2)),'overpaymentAmount'=>max(0,round($inserted-$total,2)),'change'=>0,'paymentStatus'=>$t['payment_status'],'coinStatus'=>$inserted>$total?'OVERPAYMENT':($t['payment_status']==='successful'?'PAID':($inserted>0?'PARTIAL':'WAITING_FOR_COINS')),'dispensingStatus'=>$t['dispensing_status'],'requestedQuantity'=>(int)$item['quantity'],'dispensedQuantity'=>$r?(int)$r['dispensed_quantity']:0,'dispensingRequestId'=>$r?(int)$r['id']:null,'createdAt'=>$t['created_at'],'slotNumber'=>$slot?(int)$slot['slot_number']:null,'expiresAt'=>$t['expires_at']];
    }
}
