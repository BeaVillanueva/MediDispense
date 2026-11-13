<?php
declare(strict_types=1);
require_once __DIR__.'/DispenseIssueRecovery.php';
require_once __DIR__.'/TransactionReceipt.php';

final class KioskError extends RuntimeException {
    public function __construct(public readonly string $errorCode, string $message, public readonly int $httpStatus=409, public readonly array $details=[]) { parent::__construct($message); }
}

/** Implement only after a reviewed hardware inhibit/drain and safe handoff protocol exists. */
interface PaymentIsolationGateway {
    // Must prove no accepted/pending/reconciling coins for this exact session and
    // keep input isolated from future sessions. Never trust a browser assertion.
    public function isSafelyIsolated(int $machineId, int $transactionId): bool;
}

/** MySQL is authoritative; hardware commands are sent only by sent(). */
final class KioskService {
    use DispenseIssueRecovery;
    public function __construct(
        private PDO $db,
        private string $machineCode,
        private DispenseCommandGateway $firebase,
        private ?PaymentIsolationGateway $paymentIsolation = null,
        private bool $controlledDemoExpiration = false,
        private bool $controlledDemoAutoBinding = false,
        private array $protectedTransactionIds = []
    ) {}
    private function one(string $sql, array $args=[]): ?array { $s=$this->db->prepare($sql); $s->execute($args); return $s->fetch() ?: null; }
    private function exec(string $sql, array $args=[]): void { $this->db->prepare($sql)->execute($args); }
    private function atomic(callable $action, bool $retry = true): mixed {
        // Competing checkouts can deadlock on index gap locks. Retry only a fully
        // rolled-back database transaction, never a hardware action.
        for($attempt=0; ; $attempt++) {
            $this->db->beginTransaction();
            try { $value=$action(); $this->db->commit(); return $value; }
            catch(Throwable $e) {
                if($this->db->inTransaction()) $this->db->rollBack();
                if($retry && $e instanceof PDOException && in_array((int)($e->errorInfo[1]??0),[1205,1213],true) && $attempt<2) { usleep(20000); continue; }
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
        // Automatic expiry is intentionally disabled: current ESP32 firmware cannot
        // inhibit coin input or acknowledge that buffered pulses have been reconciled.
        // A zero DB balance is not proof of zero physical/in-flight payment.
        // Keep this compatibility entry point inert; staff/customer cancellation still
        // uses the existing authenticated, locked cancellation workflow.
    }

    public function medicines(bool $available=true): array {
        if($available) $this->expireUnpaid();
        $machineReady = !$this->machineIssueReviewPending() && !$this->one("SELECT dr.id FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id JOIN machines ma ON ma.id=dr.machine_id WHERE ma.machine_code=? AND t.dispensing_status='dispensing' LIMIT 1",[$this->machineCode]);
        $sql="SELECT m.*,c.name category_name,c.is_active category_active,i.quantity,i.reserved_quantity,s.id slot_id,s.slot_number,s.slot_status,ma.machine_code,ma.is_enabled machine_enabled FROM medicines m JOIN medicine_categories c ON c.id=m.category_id JOIN inventory i ON i.medicine_id=m.id LEFT JOIN machine_slots s ON s.medicine_id=m.id LEFT JOIN machines ma ON ma.id=s.machine_id ORDER BY m.name,s.id";
        $rows=[]; $today=(string)$this->db->query('SELECT CURDATE()')->fetchColumn();
        foreach($this->db->query($sql)->fetchAll() as $r) {
            $stock=$available ? max(0,(int)$r['quantity']-(int)$r['reserved_quantity']) : (int)$r['quantity'];
            $eligible=$r['is_enabled'] && $r['category_active'] && $r['machine_enabled'] && $r['machine_code']===$this->machineCode && in_array($r['slot_status'],['ready','low'],true) && $r['expiry_date']>=$today;
            // Catalog membership is separate from purchase eligibility. Keep assigned
            // active products visible while a slot is blocked, empty, or under recovery.
            if($available && (!$r['is_enabled'] || !$r['category_active'] || $r['machine_code']!==$this->machineCode || $r['slot_id']===null)) continue;
            $availableStock=max(0,(int)$r['quantity']-(int)$r['reserved_quantity']);
            $status=$r['expiry_date']<$today?'expired':($availableStock===0?'out_of_stock':($r['expiry_date']<=date('Y-m-d',strtotime($today.' +30 days'))?'near_expiry':($availableStock<=(int)$r['minimum_stock_level']?'low_stock':'in_stock')));
            $row=['id'=>(int)$r['id'],'name'=>$r['name'],'genericName'=>$r['generic_name'],'category'=>$r['category_name'],'description'=>$r['description'],'dosage'=>$r['dosage_information'],'instructions'=>$r['usage_instructions'],'stockQuantity'=>$stock,'minimumStockLevel'=>(int)$r['minimum_stock_level'],'price'=>(float)$r['unit_price'],'expiryDate'=>$r['expiry_date'],'imageUrl'=>$r['image_url']??'','slotNumber'=>$r['slot_number']===null?null:(int)$r['slot_number'],'slotId'=>$r['slot_id']===null?null:(int)$r['slot_id'],'status'=>$status,'enabled'=>(bool)$r['is_enabled'],'dateAdded'=>$r['created_at'],'updatedAt'=>$r['updated_at']];
            // One catalog entry per medicine. Checkout independently revalidates its slot.
            if ($available) {
                $row['machineReady'] = $machineReady && (bool)$r['machine_enabled'];
                $row['slotReady'] = in_array($r['slot_status'],['ready','low'],true);
                $row['availableForPurchase'] = $eligible && $stock>0 && $machineReady;
                $row['unavailableReason'] = !$r['machine_enabled'] ? 'Machine unavailable' : (!$machineReady ? 'Machine awaiting recovery' : (!$row['slotReady'] ? 'Slot awaiting staff check' : ($r['expiry_date']<$today ? 'Expired — unavailable' : ($stock<1 ? 'Out of stock' : null))));
            }
            $row['availableStockQuantity']=$availableStock;
            if(!isset($rows[$row['id']])) $rows[$row['id']]=$row;
        }
        return array_values($rows);
    }
    public function checkout(array $body, string $token): array{
        $items = $body['items'] ?? [];
        $key = $body['request_id'] ?? '';

        if (
            !is_array($items) ||
            count($items) !== 1 ||
            !is_array($items[0] ?? null)
        ) {
            throw new KioskError(
                'INVALID_QUANTITY',
                'Choose exactly one medicine.',
                422
            );
        }

        $item = $items[0];
        $qty = $item['quantity'] ?? null;
        $medicineId = $item['medicine_id'] ?? null;

        // MediDispense allows 1 to 3 tablets per transaction.
        if (
            !is_int($qty) ||
            $qty < 1 ||
            $qty > 3 ||
            !is_int($medicineId) ||
            $medicineId < 1
        ) {
            throw new KioskError(
                'INVALID_QUANTITY',
                'Quantity must be between 1 and 3 tablets.',
                422
            );
        }

        if (
            !is_string($key) ||
            !preg_match('/^[a-zA-Z0-9-]{16,64}$/D', $key) ||
            !preg_match('/^[a-f0-9]{64}$/D', $token)
        ) {
            throw new KioskError(
                'INVALID_REQUEST',
                'A purchase request identifier and recovery token are required.',
                422
            );
        }

        $this->expireUnpaid();

        return $this->atomic(function () use (
            $item,
            $qty,
            $medicineId,
            $key,
            $token
        ) {
            $existing = $this->one(
                'SELECT * FROM transactions WHERE checkout_key=? FOR UPDATE',
                [$key]
            );

            if ($existing) {
                $this->authorize($existing, $token);

                $old = $this->item((int)$existing['id']);

                if (
                    (int)$old['medicine_id'] !== $medicineId ||
                    (int)$old['quantity'] !== $qty
                ) {
                    throw new KioskError(
                        'REQUEST_CONFLICT',
                        'This request identifier belongs to another purchase.'
                    );
                }

                return $this->snapshot((int)$existing['id']);
            }

            // The shared ESP32/Firebase command channel must finish recovery before
            // a new browser or a cleared localStorage can open another purchase.
            $machine = $this->one('SELECT id FROM machines WHERE machine_code=? FOR UPDATE',[$this->machineCode]);
            if($this->machineIssueReviewPending())throw new KioskError('DISPENSING_UNRESOLVED','A physical dispensing or inventory safety review is still unresolved.');
            if ($machine && $this->one("SELECT dr.id FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id WHERE dr.machine_id=? AND t.dispensing_status='dispensing' LIMIT 1 FOR UPDATE",[$machine['id']])) {
                throw new KioskError('DISPENSING_UNRESOLVED','The previous dispensing attempt needs staff recovery before a new purchase can start.');
            }

            $r = $this->one(
                'SELECT
                    m.*,
                    i.quantity,
                    i.reserved_quantity,
                    c.is_active category_active,
                    (m.expiry_date<CURDATE()) AS is_expired
                FROM medicines m
                JOIN inventory i ON i.medicine_id=m.id
                JOIN medicine_categories c ON c.id=m.category_id
                WHERE m.id=?
                FOR UPDATE',
                [$medicineId]
            );

            if (
                !$r ||
                !$r['is_enabled'] ||
                !$r['category_active'] ||
                $r['is_expired']
            ) {
                throw new KioskError(
                    'MEDICINE_UNAVAILABLE',
                    'This medicine is unavailable.'
                );
            }

            $slot = $this->one(
                "SELECT s.*, ma.is_enabled
                FROM machine_slots s
                JOIN machines ma ON ma.id=s.machine_id
                WHERE s.medicine_id=?
                AND ma.machine_code=?
                AND ma.is_enabled=1
                AND s.slot_status IN ('ready','low')
                ORDER BY s.id
                LIMIT 1
                FOR UPDATE",
                [$medicineId, $this->machineCode]
            );

            if (!$slot) {
                throw new KioskError(
                    'SLOT_UNAVAILABLE',
                    'No active vending slot is assigned.'
                );
            }

            if (
                (int)$r['quantity'] -
                (int)$r['reserved_quantity'] <
                $qty
            ) {
                throw new KioskError(
                    'OUT_OF_STOCK',
                    'Not enough medicine is available. Please review the quantity.'
                );
            }

            $total = self::money(
                self::cents($r['unit_price']) * $qty
            );

            $code = 'TXN-' . strtoupper(
                bin2hex(random_bytes(12))
            );

            $this->exec(
                "INSERT INTO transactions(
                    transaction_code,
                    machine_id,
                    subtotal,
                    total_amount,
                    checkout_key,
                    access_token_hash,
                    expires_at
                )
                VALUES(
                    ?,?,?,?,?,?,
                    NULL
                )",
                [
                    $code,
                    $slot['machine_id'],
                    $total,
                    $total,
                    $key,
                    hash('sha256', $token)
                ]
            );

            $id = (int)$this->db->lastInsertId();

            $this->exec(
                'INSERT INTO transaction_items(
                    transaction_id,
                    medicine_id,
                    slot_id,
                    medicine_name_snapshot,
                    unit_price_snapshot,
                    quantity,
                    subtotal
                )
                VALUES(?,?,?,?,?,?,?)',
                [
                    $id,
                    $medicineId,
                    $slot['id'],
                    $r['name'],
                    $r['unit_price'],
                    $qty,
                    $total
                ]
            );

            $this->exec(
                'INSERT INTO payments(
                    transaction_id,
                    amount_due
                )
                VALUES(?,?)',
                [$id, $total]
            );

            $this->exec(
                'UPDATE inventory
                SET reserved_quantity=reserved_quantity+?
                WHERE medicine_id=?',
                [$qty, $medicineId]
            );

            if (self::cents($total) === 0) {
                $this->exec(
                    "UPDATE transactions
                    SET payment_status='successful',
                        expires_at=NULL
                    WHERE id=?",
                    [$id]
                );

                $this->exec(
                    "UPDATE payments
                    SET status='successful',
                        verified_at=NOW()
                    WHERE transaction_id=?",
                    [$id]
                );

                $this->queue(
                    $this->transaction($id)
                );
            }

            // Reservation is not an inventory deduction.
            // Physical quantity is unchanged until dispensing is confirmed.
            return $this->snapshot($id);
        });
    }
    public function get(int $id,string $token): array {
        $this->expireUnpaid(); $t=$this->transaction($id); $this->authorize($t,$token);
        if($this->controlledDemoExpiration && $t['payment_status']==='pending' && $t['dispensing_status']==='pending') {
            try { return $this->expirePayment($id,$token); }
            catch(KioskError $e) {
                if(!in_array($e->errorCode,['PAYMENT_NOT_EXPIRED','PAYMENT_IN_PROGRESS','PAYMENT_RECONCILIATION_REQUIRED','HARDWARE_ISOLATION_REQUIRED','TRANSACTION_PROTECTED'],true))throw $e;
            }
        }
        $this->recordDispensingTimeout($id); return $this->snapshot($id);
    }
    public function recover(string $key,string $token): array {
        $t=$this->one('SELECT id FROM transactions WHERE checkout_key=?',[$key]);
        if(!$t) throw new KioskError('TRANSACTION_NOT_FOUND','Purchase not found.',404);
        return $this->get((int)$t['id'],$token);
    }
    private function cancelLocked(array $t, string $reason='Customer cancelled purchase'): void {
        $item=$this->item((int)$t['id']);
        $this->exec('UPDATE inventory SET reserved_quantity=reserved_quantity-? WHERE medicine_id=? AND reserved_quantity>=?',[$item['quantity'],$item['medicine_id'],$item['quantity']]);
        $this->exec("UPDATE transactions SET payment_status='cancelled',dispensing_status='cancelled' WHERE id=?",[$t['id']]);
        $this->exec("UPDATE payments SET status='cancelled' WHERE transaction_id=?",[$t['id']]);
        $this->exec("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('system','transaction_cancelled',?,?)",[$reason,json_encode(['transaction_id'=>(int)$t['id'],'medicine_name'=>$item['medicine_name_snapshot'],'quantity'=>(int)$item['quantity'],'source'=>'customer_kiosk','reason'=>$reason])]);
    }
    public function cancel(int $id,string $token): array {
        return $this->atomic(function() use($id,$token) {
            $t=$this->transaction($id,true); $this->authorize($t,$token);
            if($t['payment_status']==='cancelled') return $this->snapshot($id);
            if($t['payment_status']!=='pending'||self::cents($t['amount_paid'])>0||$t['dispensing_status']!=='pending') throw new KioskError('PAYMENT_IN_PROGRESS','Inserted coins cannot be returned. Contact assistance.');
            $this->cancelLocked($t); return $this->snapshot($id);
        });
    }

    public function expirePayment(int $id, string $token): array {
        return $this->atomic(function()use($id,$token) {
            $t=$this->transaction($id,true); $this->authorize($t,$token);
            $expired=$this->one("SELECT id FROM activity_logs WHERE action='payment_session_expired' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? LIMIT 1",[(string)$id]);
            if($expired && $t['payment_status']==='cancelled') return $this->snapshot($id);
            if(in_array($id,$this->protectedTransactionIds,true))throw new KioskError('TRANSACTION_PROTECTED','This purchase requires explicit staff approval before automatic expiration.',409,['expirationBlockers'=>['TRANSACTION_REQUIRES_EXPLICIT_STAFF_APPROVAL']]);
            if($t['payment_status']!=='pending' || $t['dispensing_status']!=='pending' || self::cents($t['amount_paid'])!==0)
                throw new KioskError('PAYMENT_IN_PROGRESS','Payment or dispensing is active. Preserve this purchase and ask for assistance.');
            $due=$this->one('SELECT (NOW()>=DATE_ADD(created_at,INTERVAL 5 MINUTE)) due FROM transactions WHERE id=?',[$id]);
            if(!(bool)$due['due']) throw new KioskError('PAYMENT_NOT_EXPIRED','The server payment deadline has not been reached.');
            $payments=$this->one('SELECT * FROM payments WHERE transaction_id=? FOR UPDATE',[$id]);
            if(!$payments || $payments['status']!=='pending' || self::cents($payments['amount_inserted'])!==0 ||
                $this->one('SELECT id FROM payment_events WHERE transaction_id=? LIMIT 1',[$id]) ||
                $this->one('SELECT id FROM dispensing_requests WHERE transaction_id=? LIMIT 1',[$id]))
                throw new KioskError('PAYMENT_RECONCILIATION_REQUIRED','Payment state needs reconciliation. This purchase has not been cancelled.');
            $item=$this->item($id);
            $inventory=$this->one('SELECT reserved_quantity FROM inventory WHERE medicine_id=? FOR UPDATE',[$item['medicine_id']]);
            if(!$inventory || (int)$inventory['reserved_quantity']<(int)$item['quantity'])
                throw new KioskError('PAYMENT_RECONCILIATION_REQUIRED','Stock reservation needs reconciliation. This purchase has not been cancelled.');
            $isolated=$this->paymentIsolation && $this->paymentIsolation->isSafelyIsolated((int)$t['machine_id'],$id);
            $blockers=$this->controlledDemoExpiration && !$isolated ? $this->demoExpirationBlockers($id,true) : [];
            $demo=$this->controlledDemoExpiration && !$isolated && !$blockers;
            if(!$isolated && !$demo)
                throw new KioskError('HARDWARE_ISOLATION_REQUIRED',$this->controlledDemoExpiration?'Demo expiration blocked: '.implode(', ',$blockers).'. Do not insert coins; ask staff to check the controller.':'The ESP32 cannot confirm coin input is isolated and all pending pulses are reconciled. Do not insert coins; ask staff for assistance.',409,['expirationBlockers'=>$blockers]);
            $this->cancelLocked($t,$demo?'Controlled demonstration payment window expired; no late coins assumed':'Payment window expired after verified hardware isolation');
            $this->exec("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('system','payment_session_expired',?,?)",[$demo?'Controlled demonstration unpaid purchase expired; physical isolation is not verified.':'Unpaid purchase safely expired after hardware isolation confirmation.',json_encode(['transaction_id'=>$id,'hardware_isolation_verified'=>(bool)$isolated,'controlled_demonstration'=>$demo])]);
            return $this->snapshot($id);
        });
    }

    public function demoExpirationBlockers(int $id, bool $forExpiration=false): array {
        if(in_array($id,$this->protectedTransactionIds,true))return ['TRANSACTION_REQUIRES_EXPLICIT_STAFF_APPROVAL'];
        // Telemetry is NOT physical inhibition. Only permitted by explicit supervised demo policy.
        $devices=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();
        if(!$devices)return ['CONTROLLER_DIAGNOSTICS_MISSING'];
        if(count($devices)!==1)return ['MULTIPLE_CONTROLLER_REPORTS'];
        $d=$devices[0];
        $checks=[
            'CONTROLLER_DIAGNOSTICS_STALE'=>($d['fresh']??false),
            'CONTROLLER_SESSION_MISMATCH'=>($d['bound_transaction_id']??0)===$id,
            'BACKEND_SESSION_UNVERIFIED'=>($d['backend_session_verified']??false),
            'PAYMENT_STORAGE_UNHEALTHY'=>($d['storage_healthy']??false),
            'UNCONFIRMED_PAYMENT_EVENTS'=>($d['pending_events']??-1)===0 && ($d['durable_events']??-1)===0,
            'COIN_QUEUE_OVERFLOW'=>($d['overflow_events']??-1)===0 && ($d['overflow_pulses']??-1)===0,
            'INCOMPLETE_COIN_PULSES'=>($d['incomplete_pulses']??true)===false,
            'PAYMENT_RECONCILIATION_REQUIRED'=>($d['reconciliation_required']??true)===false,
            'CONTROLLER_BOOT_REVIEW_REQUIRED'=>($d['boot_review_required']??true)===false,
            'CONTROLLER_BINDING_REVIEW_REQUIRED'=>($d['binding_review_required']??true)===false && ($d['binding_phase']??-1)===0,
        ];
        if($this->controlledDemoAutoBinding) {
            $checks['FIRMWARE_DEMO_MODE_UNCONFIRMED']=($d['controlled_demo_autobind']??false)===true;
            $checks['AUTOMATIC_BINDING_BLOCKED']=($d['automatic_binding_blocker']??'UNKNOWN')==='NONE';
            if($forExpiration)$checks['CONTROLLER_EXPIRATION_DRAIN_UNCONFIRMED']=($d['expiration_check_ready']??false)===true;
        }
        return array_keys(array_filter($checks,fn($passed)=>!$passed));
    }

    public function hardwarePaymentSession(int $boundTransactionId=0, string $sessionCheck=''): array
    {
        if($sessionCheck!=='' && !preg_match('/^[a-fA-F0-9]{16}$/D',$sessionCheck))throw new KioskError('INVALID_SESSION_CHECK','Invalid session freshness check.',422);
        $policy=['controlled_demo_autobind'=>$this->controlledDemoExpiration && $this->controlledDemoAutoBinding,'session_check'=>$sessionCheck];
        if($this->machineIssueReviewPending())return $policy+['active'=>false,'previous_session_closed'=>false,'automatic_handoff_safe'=>false,'recovery_review_required'=>true];
        $this->expireUnpaid();

        $previousClosed=$boundTransactionId===0;
        if($boundTransactionId>0) {
            $previous=$this->one('SELECT t.* FROM transactions t JOIN machines m ON m.id=t.machine_id WHERE t.id=? AND m.machine_code=?',[$boundTransactionId,$this->machineCode]);
            // This is a lifecycle fact only, never evidence of physical coin isolation.
            $previousClosed=$previous && ($previous['payment_status']==='cancelled' || $previous['dispensing_status']==='dispensed' ||
                ($previous['dispensing_status']==='failed' && $this->adminRecovered($boundTransactionId)));
        }

        $t = $this->one(
            "SELECT
                t.id,
                t.transaction_code,
                t.total_amount,
                t.amount_paid,
                t.payment_status,
                t.dispensing_status,
                t.expires_at
            FROM transactions t
            JOIN machines m ON m.id = t.machine_id
            WHERE m.machine_code = ?
            AND t.checkout_key IS NOT NULL
            AND t.payment_status = 'pending'
            AND t.dispensing_status = 'pending'
            ORDER BY t.created_at ASC
            LIMIT 1",
            [$this->machineCode]
        );

        if($t && in_array((int)$t['id'],$this->protectedTransactionIds,true)) {
            return $policy+['active'=>false,'previous_session_closed'=>(bool)$previousClosed,'automatic_handoff_safe'=>false,'binding_blocker'=>'TRANSACTION_REQUIRES_EXPLICIT_STAFF_APPROVAL'];
        }
        if (!$t || ($boundTransactionId>0 && (int)$t['id']!==$boundTransactionId && !$previousClosed)) {
            return $policy + [
                'active' => false, 'previous_session_closed'=>(bool)$previousClosed, 'automatic_handoff_safe'=>false
            ];
        }

        $total = self::cents($t['total_amount']);
        $paid = self::cents($t['amount_paid']);
        $remaining = max(0, $total - $paid);
        $sessionClock=$this->one('SELECT UNIX_TIMESTAMP(NOW(3))*1000 server_now_ms, UNIX_TIMESTAMP(DATE_ADD(created_at,INTERVAL 5 MINUTE))*1000 deadline_ms FROM transactions WHERE id=?',[(int)$t['id']]);

        return $policy + [
            'active' => true,
            'previous_session_closed'=>(bool)$previousClosed,
            'automatic_handoff_safe'=>false,
            'transaction_id' => (int)$t['id'],
            'server_now_ms'=>(float)$sessionClock['server_now_ms'],
            'payment_deadline_ms'=>(float)$sessionClock['deadline_ms'],
            'transaction_code' => $t['transaction_code'],
            'transaction_reference' => $t['transaction_code'],
            'total_amount' => self::money($total),
            'amount_paid' => self::money($paid),
            'remaining_amount' => self::money($remaining),
            'payment_status' => $t['payment_status']
        ];
    }

    /** Only a trusted hardware caller may enter this boundary. Amount is a coin delta. */
    public function verifyCoin(int $id,string $eventId,mixed $amount): array {
        $result=$this->coin($id,$eventId,$amount);
        $event=$this->one('SELECT amount FROM payment_events WHERE transaction_id=? AND event_id=?',[$id,$eventId]);
        if(!$event)throw new KioskError('PAYMENT_UNCONFIRMED','Payment event needs reconciliation.');
        $result['paymentEvent']=['recorded'=>true,'transactionId'=>$id,'eventId'=>$eventId,'amount'=>(float)$event['amount']];
        return $result;
    }

    public function coin(int $id,string $eventId,mixed $amount): array {
        $delta=self::cents($amount);
        if($delta<1||!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D',$eventId)) throw new KioskError('INVALID_COIN_EVENT','A positive coin amount and stable event ID are required.',422);
        return $this->atomic(function() use($id,$eventId,$delta) {
            $t=$this->transaction($id,true);
            if(!$t['checkout_key']) throw new KioskError('LEGACY_TRANSACTION','Legacy purchases require staff reconciliation.');
            $event=$this->one('SELECT amount FROM payment_events WHERE transaction_id=? AND event_id=?',[$id,$eventId]);
            if($event) { if(self::cents($event['amount'])!==$delta) throw new KioskError('EVENT_CONFLICT','Coin event already recorded with a different amount.'); return $this->snapshot($id); }
            if($t['payment_status']==='cancelled') throw new KioskError('PAYMENT_CLOSED','This coin session is closed. Contact assistance.');
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
        $payload=['transaction_id'=>(int)$t['id'],'transaction_reference'=>$t['transaction_code'],'slot_id'=>(int)$slot['id'],'slot_number'=>(int)$slot['slot_number'],'motor_id'=>$slot['motor_id'],'sensor_id'=>$slot['sensor_id'],'requested_quantity'=>(int)$item['quantity'],'next_unit_number'=>1];
        $this->exec('INSERT INTO dispensing_requests(transaction_id,machine_id,slot_id,quantity,command_reference,command_payload) VALUES(?,?,?,?,?,?)',[$t['id'],$slot['machine_id'],$slot['id'],$item['quantity'],'DISP-'.bin2hex(random_bytes(16)),json_encode($payload)]);
        $this->exec("UPDATE transactions SET dispensing_status='dispensing' WHERE id=?",[$t['id']]);
    }

    public function hardwarePendingDispense(): array
    {
        $request = $this->one(
            "SELECT
                dr.id AS request_id,
                dr.transaction_id,
                dr.quantity,
                dr.request_status,
                dr.sent_at,
                ms.slot_number,
                ms.motor_id,
                ms.sensor_id
            FROM dispensing_requests dr
            JOIN transactions t
                ON t.id = dr.transaction_id
            JOIN machine_slots ms
                ON ms.id = dr.slot_id
            JOIN machines m
                ON m.id = dr.machine_id
            WHERE m.machine_code = ?
            AND t.payment_status = 'successful'
            AND t.dispensing_status = 'dispensing'
            AND dr.request_status = 'queued'
            AND dr.sent_at IS NULL
            ORDER BY dr.id ASC
            LIMIT 1",
            [$this->machineCode]
        );

        if (!$request) {
            return [
                'active' => false
            ];
        }

        return [
            'active' => true,
            'request_id' => (int)$request['request_id'],
            'transaction_id' => (int)$request['transaction_id'],
            'slot_number' => (int)$request['slot_number'],
            'motor_id' => $request['motor_id'],
            'sensor_id' => $request['sensor_id'],
            'quantity' => (int)$request['quantity']
        ];
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

            $slotState = $this->one('SELECT slot_status FROM machine_slots WHERE id=? FOR UPDATE',[$request['slot_id']]);
            if (!$slotState || !in_array($slotState['slot_status'],['ready','low'],true)) throw new KioskError('DISPENSE_NOT_ALLOWED','Slot is blocked; reconcile physical stock before dispensing.');

            // Serialize command dispatch with admin recovery on the transaction lock.
            // Never retry a transaction containing a hardware command.
            if((int)$mapping['transaction_id']!==(int)$t['id'] || (int)$request['transaction_id']!==(int)$t['id'] ||
                (isset($mapping['transaction_reference']) && $mapping['transaction_reference']!==$t['transaction_code']))
                throw new KioskError('TRANSACTION_MISMATCH','Dispense request identity requires investigation.');
            if($this->firebase instanceof TransactionReferenceGateway)
                $this->firebase->sendReferencedDispenseCommand($requestId,(int)$mapping['slot_number'],(int)$mapping['requested_quantity'],(int)$t['id'],$t['transaction_code']);
            else $this->firebase->sendDispenseCommand($requestId, (int)$mapping['slot_number'], (int)$mapping['requested_quantity']);
            return [
                'dispensing_request_id' => $requestId,
                'command_reference' => $request['command_reference'],
                'unit_number' => (int)$request['dispensed_quantity'] + 1,
                'mapping' => $mapping,
            ];
        }, false);

        return $result;
    }
    public function sensor(int $requestId,int $unit,bool $success): array {
        $request=$this->one('SELECT * FROM dispensing_requests WHERE id=?',[$requestId]);
        if(!$request) throw new KioskError('DISPENSE_NOT_ALLOWED','Dispensing request not found.',404);
        return $this->atomic(function() use($request,$requestId,$unit,$success) {
            $id=(int)$request['transaction_id']; $t=$this->transaction($id,true);
            $r=$this->one('SELECT * FROM dispensing_requests WHERE id=? FOR UPDATE',[$requestId]);
            if ($this->adminRecovered($id)) throw new KioskError('DISPENSE_FINALIZED','This dispense was finalized by admin recovery. Late hardware results require reconciliation.');
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
            $this->exec("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('hardware',?,?,?)",[$success?'medicine_dispensed':'dispensing_failed',$item['medicine_name_snapshot'].($success?' tablet confirmed by sensor.':' dispensing failed.'),json_encode(['transaction_id'=>$id,'request_id'=>$requestId,'medicine_id'=>(int)$item['medicine_id'],'medicine_name'=>$item['medicine_name_snapshot'],'unit_number'=>$unit,'confirmed_quantity'=>$success?$unit:(int)$r['dispensed_quantity'],'requested_quantity'=>(int)$r['quantity']])]);
            return $this->snapshot($id);
        });
    }
    public function recoverStoppedDispense(int $id, array $body, array $actor): array {
        if (!in_array($actor['role_code'] ?? '', ['admin','super_admin'], true)) throw new KioskError('FORBIDDEN','Admin access required.',403);
        $reason = is_string($body['reason'] ?? null) ? trim($body['reason']) : '';
        if (($body['motor_stopped'] ?? null) !== true || ($body['controller_disconnected'] ?? null) !== true || strlen($reason) < 5 || strlen($reason) > 500) {
            throw new KioskError('CONFIRMATION_REQUIRED','Confirm the motor is stopped and ESP32 is disconnected, and enter a reason (5–500 characters).',422);
        }
        $this->recordDispensingTimeout($id);
        return $this->atomic(function () use ($id, $body, $actor, $reason) {
            $t = $this->transaction($id, true);
            if (($body['transaction_code'] ?? '') !== $t['transaction_code']) throw new KioskError('TRANSACTION_MISMATCH','Transaction confirmation does not match.',422);
            if($this->issueReview($id))throw new KioskError('USE_OUTCOME_REVIEW','Use Resolve Dispensing Issue to continue this physical outcome review.');
            if ($this->adminRecovered($id)) {
                if (array_key_exists('physical_stock',$body)) $this->reconcileRecoveredStock($id,$body['physical_stock'],$actor,$reason);
                return $this->snapshot($id);
            }
            if ($t['payment_status'] !== 'successful' || $t['dispensing_status'] !== 'dispensing') throw new KioskError('RECOVERY_NOT_ALLOWED','Only an unresolved paid dispensing transaction can be recovered.');
            $r = $this->one('SELECT * FROM dispensing_requests WHERE transaction_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[$id]);
            if (!$r) throw new KioskError('RECOVERY_NOT_ALLOWED','No dispensing request found.');
            $item = $this->item($id);
            $stock = $this->one('SELECT * FROM inventory WHERE medicine_id=? FOR UPDATE',[$item['medicine_id']]);
            $remaining = (int)$r['quantity'] - (int)$r['dispensed_quantity'];
            if (!$stock || $remaining < 1 || (int)$stock['reserved_quantity'] < $remaining) throw new KioskError('STOCK_RECONCILIATION_REQUIRED','Reservation mismatch; manual inventory review required.');
            $this->exec("UPDATE machine_slots SET slot_status='blocked' WHERE id=?",[$r['slot_id']]);
            $this->exec('UPDATE inventory SET reserved_quantity=reserved_quantity-? WHERE medicine_id=?',[$remaining,$item['medicine_id']]);
            $this->exec("UPDATE dispensing_requests SET request_status='failed',completed_at=NOW() WHERE id=?",[$r['id']]);
            $this->exec("UPDATE transactions SET dispensing_status='failed' WHERE id=?",[$id]);
            $this->exec("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'admin_dispense_recovered',?,?)",[(int)$actor['id'],'Stopped dispensing recovered; physical stock and payment require reconciliation. '. $reason,json_encode(['transaction_id'=>$id,'request_id'=>(int)$r['id'],'medicine_name'=>$item['medicine_name_snapshot'],'confirmed_quantity'=>(int)$r['dispensed_quantity'],'released_reservation'=>$remaining,'reason'=>$reason,'hardware_confirmation_source'=>'authenticated_admin_attestation','motor_stopped'=>true,'controller_disconnected'=>true,'slot_blocked'=>true])]);
            // Failure rolls back all DB changes. A retired command can safely be retired again.
            $this->firebase->retireDispenseCommand((int)$r['id']);
            if (array_key_exists('physical_stock',$body)) $this->reconcileRecoveredStock($id,$body['physical_stock'],$actor,$reason);
            return $this->snapshot($id);
        }, false);
    }
    /** Admin-observed count, not an inferred dispense or a second purchase deduction. */
    private function reconcileRecoveredStock(int $id, mixed $count, array $actor, string $reason): void {
        if (!is_int($count) || $count < 0 || $count > 10) throw new KioskError('INVALID_STOCK','Physical stock must be a whole number from 0 to 10.',422);
        if ($this->one("SELECT id FROM activity_logs WHERE action='dispense_stock_reconciled' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? LIMIT 1",[(string)$id])) return;
        $item=$this->item($id);
        $stock=$this->one('SELECT * FROM inventory WHERE medicine_id=? FOR UPDATE',[$item['medicine_id']]);
        $slot=$this->one('SELECT * FROM machine_slots WHERE id=? FOR UPDATE',[$item['slot_id']]);
        if (!$slot || (int)$slot['medicine_id'] !== (int)$item['medicine_id']) throw new KioskError('SLOT_CHANGED','The slot assignment changed. Reconcile it from inventory management.');
        if ($this->one("SELECT dr.id FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id WHERE dr.slot_id=? AND t.dispensing_status='dispensing' LIMIT 1 FOR UPDATE",[$slot['id']])) throw new KioskError('OTHER_UNRESOLVED','Recover the other unresolved purchases for this slot first, then reconcile its physical stock.');
        if (!$stock || $count < (int)$stock['reserved_quantity']) throw new KioskError('STOCK_RESERVED','Physical count is below other reserved purchases. Resolve those purchases first.');
        $previous=(int)$stock['quantity'];
        $this->exec('UPDATE inventory SET quantity=?,last_counted_at=NOW() WHERE medicine_id=?',[$count,$item['medicine_id']]);
        if ($count !== $previous) $this->exec("INSERT INTO stock_movements(medicine_id,transaction_id,previous_quantity,new_quantity,change_quantity,change_type,reason,actor_user_id) VALUES(?,?,?,?,?,'adjustment',?,?)",[$item['medicine_id'],$id,$previous,$count,$count-$previous,'Physical recount after dispensing recovery #'.$id,(int)$actor['id']]);
        // Readiness reflects reconciliation; zero stock is independently unavailable.
        $this->exec("UPDATE machine_slots SET slot_status='ready' WHERE id=?",[$slot['id']]);
        $this->exec("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'dispense_stock_reconciled',?,?)",[(int)$actor['id'],'Physical stock checked after dispensing recovery. '.$reason,json_encode(['transaction_id'=>$id,'slot_id'=>(int)$slot['id'],'medicine_id'=>(int)$item['medicine_id'],'previous_quantity'=>$previous,'physical_stock'=>$count,'reason'=>$reason])]);
    }
    private function adminRecovered(int $id): bool {
        if($this->issueReview($id))return true;
        return $this->one("SELECT id FROM activity_logs WHERE action='admin_dispense_recovered' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? LIMIT 1",[(string)$id]) !== null;
    }
    /** Observation only: no motor command, stock movement, or terminal status change. */
    private function recordDispensingTimeout(int $id): void {
        $this->atomic(function () use ($id) {
            $t = $this->transaction($id, true);
            if ($t['payment_status'] !== 'successful' || $t['dispensing_status'] !== 'dispensing') return;
            $r = $this->one('SELECT id,TIMESTAMPDIFF(SECOND,COALESCE(sent_at,requested_at),NOW()) elapsed FROM dispensing_requests WHERE transaction_id=? ORDER BY id DESC LIMIT 1',[$id]);
            if (!$r || (int)$r['elapsed'] < 120) return;
            if ($this->one("SELECT id FROM activity_logs WHERE action='dispensing_confirmation_timeout' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.request_id'))=? LIMIT 1",[(string)$r['id']])) return;
            $this->exec("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('system','dispensing_confirmation_timeout',?,?)",['No final ESP32 confirmation within 120 seconds. Hardware state unknown; recovery required.',json_encode(['transaction_id'=>$id,'request_id'=>(int)$r['id'],'reason'=>'confirmation_deadline_exceeded','timeout_seconds'=>120,'observed_elapsed_seconds'=>(int)$r['elapsed'],'hardware_stopped_verified'=>false])]);
        });
    }
    public function transactionRecordDetails(int $id,array $actor): array {
        if(!in_array($actor['role_code']??'', ['admin','super_admin','staff'],true))throw new KioskError('FORBIDDEN','Transaction access required.',403);
        $transaction=$this->snapshot($id);
        $q=$this->db->prepare("SELECT id,actor_user_id,action,description,metadata,created_at FROM activity_logs WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? OR JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.request_id')) IN (SELECT CAST(id AS CHAR) FROM dispensing_requests WHERE transaction_id=?) ORDER BY id DESC LIMIT 200");$q->execute([(string)$id,$id]);
        $admin=in_array($actor['role_code'],['admin','super_admin'],true);$history=[];$reason=null;
        foreach($q->fetchAll() as $row){
            $metadata=json_decode($row['metadata']??'null',true)??[];
            $allowed=['reason','outcome','verifiedQuantity','sensorConfirmedQuantity','obligationStatus','confirmed_quantity','requested_quantity','quantity'];
            if($admin)$allowed=array_merge($allowed,['notes','obligationReference']);
            $safe=array_intersect_key($metadata,array_flip($allowed));
            if(!$reason&&in_array($row['action'],['transaction_cancelled','payment_session_expired','dispensing_failed','dispensing_confirmation_timeout'],true))$reason=$metadata['reason']??$row['description'];
            $description=$row['description'];
            if(!$admin&&in_array($row['action'],['admin_dispense_recovered','dispense_stock_reconciled'],true))$description='Admin physical recovery recorded.';
            $history[]=['id'=>(int)$row['id'],'actorId'=>$row['actor_user_id']?(int)$row['actor_user_id']:null,'action'=>$row['action'],'description'=>$description,'createdAt'=>$row['created_at'],'details'=>$safe];
        }
        return ['transaction'=>$transaction,'reason'=>$reason,'history'=>$history];
    }
    public function snapshot(int $id): array {
        $t=$this->transaction($id); $item=$this->item($id);
        $r=$this->one('SELECT dr.*, UNIX_TIMESTAMP(dr.completed_at)*1000 AS completed_ms, GREATEST(0,TIMESTAMPDIFF(SECOND,COALESCE(dr.sent_at,dr.requested_at),NOW())) AS wait_seconds FROM dispensing_requests dr WHERE transaction_id=? ORDER BY id DESC LIMIT 1',[$id]);
        $slot=$this->one('SELECT slot_number FROM machine_slots WHERE id=?',[$item['slot_id']]);
        $stmt=$this->db->prepare('SELECT * FROM transaction_items WHERE transaction_id=? ORDER BY id');
        $stmt->execute([$id]);
        $allItems=array_map(fn($line)=>['medicineId'=>(int)$line['medicine_id'],'medicineName'=>$line['medicine_name_snapshot'],'quantity'=>(int)$line['quantity'],'unitPrice'=>(float)$line['unit_price_snapshot'],'subtotal'=>(float)$line['subtotal']],$stmt->fetchAll());
        $inserted=(float)$t['amount_paid']; $total=(float)$t['total_amount'];
        $recovered = $t['dispensing_status'] === 'failed' && $this->adminRecovered($id);
        $issue=$this->issueReview($id);
        $issueSummary=$issue?array_intersect_key($issue,array_flip(['revision','outcome','verifiedQuantity','sensorConfirmedQuantity','requestedQuantity','reviewRequired','inspectionComplete','stockVerified','returnRequested','obligationStatus']))+['machineReuseReady'=>$this->issueReturnReady($id,$issue)]:null;
        if($issueSummary)$issueSummary+=['machineReviewRequired'=>$this->issueMachinePending($issue),'customerObligationPending'=>$this->issueCustomerPending($issue)];
        $stockReconciled = $recovered && $this->one("SELECT id FROM activity_logs WHERE action='dispense_stock_reconciled' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? LIMIT 1",[(string)$id]) !== null;
        if($issue)$stockReconciled=$issue['stockVerified']&&!$this->issueMachinePending($issue);
        // MySQL evaluates both timestamps in the same time zone; no browser date parsing.
        // Persisted creation time anchors the advisory window across recovery/refresh.
        $clock=$this->one('SELECT UNIX_TIMESTAMP(NOW(3))*1000 server_now_ms, UNIX_TIMESTAMP(DATE_ADD(created_at,INTERVAL 5 MINUTE))*1000 deadline_ms FROM transactions WHERE id=?',[$id]);
        $expiry=$this->one("SELECT UNIX_TIMESTAMP(DATE_ADD(created_at,INTERVAL 3 SECOND))*1000 return_at_ms FROM activity_logs WHERE action='payment_session_expired' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? ORDER BY id LIMIT 1",[(string)$id]);
        $demoHandoff=false;
        if($this->controlledDemoExpiration && $this->controlledDemoAutoBinding && $t['payment_status']==='successful' && $t['dispensing_status']==='dispensed' && self::cents($inserted)===self::cents($total) && $r && (int)$r['dispensed_quantity']===(int)$item['quantity'] && !$this->demoExpirationBlockers($id)) {
            $reports=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();
            $demoHandoff=count($reports)===1 && $r['completed_ms']!==null && (float)$reports[0]['reportedAtMs']>=(float)$r['completed_ms'];
        }
        $paymentWindow=['serverNowMs'=>(float)$clock['server_now_ms'],'deadlineMs'=>(float)$clock['deadline_ms'],'automaticExpirationEnabled'=>$this->paymentIsolation!==null||$this->controlledDemoExpiration,'controlledDemonstration'=>$this->controlledDemoExpiration,'controlledDemoAutoBinding'=>$this->controlledDemoExpiration && $this->controlledDemoAutoBinding,'hardwarePauseSupported'=>false,
            'expirationBlockers'=>$this->controlledDemoExpiration && $t['payment_status']==='pending' ? $this->demoExpirationBlockers($id,true) : []];
        $paymentExpiry=$expiry && $t['payment_status']==='cancelled' ? ['confirmed'=>true,'returnAtMs'=>(float)$expiry['return_at_ms']] : null;
        $receipt=TransactionReceipt::evaluate($t,$this->one('SELECT * FROM payments WHERE transaction_id=?',[$id]),$r,$allItems,$issue,!$issue&&$t['dispensing_status']==='dispensed'&&$this->adminRecovered($id));
        return ['currency'=>$t['currency']??'PHP','receipt'=>$receipt,'customerHandoffSafe'=>$demoHandoff,'customerHandoffMode'=>$demoHandoff?'controlled_demo_assumption':'unverified','customerHandoffBlocker'=>$demoHandoff?null:'COIN_ACCEPTANCE_CONTROL_UNVERIFIED','paymentExpiry'=>$paymentExpiry,'paymentWindow'=>$paymentWindow,'dispensingWaitSeconds'=>$r?(int)$r['wait_seconds']:0,'issueRecovery'=>$issueSummary,'sensorConfirmedQuantity'=>$r?(int)$r['dispensed_quantity']:0,'adminRecovered'=>$recovered,'stockReconciled'=>$stockReconciled,'id'=>$t['transaction_code'],'databaseId'=>$id,'items'=>$allItems,'total'=>$total,'amountPaid'=>$inserted,'insertedAmount'=>$inserted,'remainingAmount'=>max(0,round($total-$inserted,2)),'overpaymentAmount'=>max(0,round($inserted-$total,2)),'change'=>0,'paymentStatus'=>$t['payment_status'],'coinStatus'=>$inserted>$total?'OVERPAYMENT':($t['payment_status']==='successful'?'PAID':($inserted>0?'PARTIAL':'WAITING_FOR_COINS')),'dispensingStatus'=>$t['dispensing_status'],'requestedQuantity'=>(int)$item['quantity'],'dispensedQuantity'=>$issue?(int)$issue['verifiedQuantity']:($r?(int)$r['dispensed_quantity']:0),'dispensingRequestId'=>$r?(int)$r['id']:null,'createdAt'=>$t['created_at'],'slotNumber'=>$slot?(int)$slot['slot_number']:null,'expiresAt'=>$t['expires_at']];
    }
}
