<?php
declare(strict_types=1);

/** Three fixed physical slots. This service never sends commands or changes a purchase. */
final class SlotInventoryService {
    public function __construct(private PDO $db,private string $machineCode,private ?Closure $commandState=null){}
    private function q(string $sql,array $args=[]):PDOStatement{$q=$this->db->prepare($sql);$q->execute($args);return $q;}
    private function key():string{return 'inventory_maintenance:'.$this->machineCode;}
    private function actor(array $a):void{if(!in_array($a['role_code']??'', ['super_admin','admin'],true)||(int)($a['id']??0)<1)throw new KioskError('FORBIDDEN','Administrator access required.',403);}
    private function atomic(Closure $fn):mixed{$this->db->beginTransaction();try{$result=$fn();$this->db->commit();return $result;}catch(Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}}
    private function log(string $action,array $actor,array $data):void{$this->q("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,?,?,?)",[$actor['id'],$action,str_replace('_',' ',ucfirst($action)).'; physical slot inventory recorded.',json_encode($data,JSON_THROW_ON_ERROR)]);}
    public function operation():?array{$value=$this->q('SELECT setting_value FROM system_settings WHERE setting_key=?',[$this->key()])->fetchColumn();return $value?json_decode($value,true,512,JSON_THROW_ON_ERROR):null;}
    private function store(array $op):void{$this->q('INSERT INTO system_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',[$this->key(),json_encode($op,JSON_THROW_ON_ERROR)]);}
    private function machine():array {
        $m=$this->q('SELECT * FROM machines WHERE machine_code=? FOR UPDATE',[$this->machineCode])->fetch();
        if(!$m||!(int)$m['is_enabled'])throw new KioskError('MACHINE_UNAVAILABLE','The configured machine is unavailable.');
        $slots=$this->q('SELECT * FROM machine_slots WHERE machine_id=? ORDER BY slot_number FOR UPDATE',[$m['id']])->fetchAll();
        if(array_map(fn($s)=>(int)$s['slot_number'],$slots)!==[1,2,3])throw new KioskError('SLOT_CONFIGURATION','Exactly slots 1, 2 and 3 must be configured. Maintenance must verify the slot map.');
        $assigned=array_filter(array_column($slots,'medicine_id'),fn($id)=>$id!==null);
        if(count($assigned)!==count(array_unique($assigned)))throw new KioskError('SLOT_CONFIGURATION','A medicine has conflicting slot assignments.');
        return [$m,$slots];
    }
    private function safe(array $machine,int $slotId,bool $fresh):array {
        // Serialize telemetry writers while the database safety decision is committed.
        $this->q('SELECT setting_key FROM system_settings WHERE setting_key LIKE ? FOR UPDATE',['coin_diag:'.$machine['id'].':%'])->fetchAll();
        if($this->q("SELECT id FROM transactions WHERE machine_id=? AND (payment_status='pending' OR dispensing_status IN ('dispensing') OR (payment_status='successful' AND dispensing_status='pending')) LIMIT 1 FOR UPDATE",[$machine['id']])->fetchColumn())throw new KioskError('ACTIVE_PURCHASE','Finish the active or partially paid purchase before changing physical stock.');
        if($this->q("SELECT id FROM dispensing_requests WHERE machine_id=? AND request_status IN ('queued','sent','dispensing') LIMIT 1 FOR UPDATE",[$machine['id']])->fetchColumn())throw new KioskError('ACTIVE_DISPENSING','A medicine delivery is waiting or running. Complete its recovery first.');
        if($this->q('SELECT i.medicine_id FROM inventory i JOIN machine_slots s ON s.medicine_id=i.medicine_id WHERE s.machine_id=? AND i.reserved_quantity>0 LIMIT 1 FOR UPDATE',[$machine['id']])->fetchColumn())throw new KioskError('STOCK_RESERVED','Stock is reserved for a purchase. Resolve that purchase first.');
        $failures=$this->q("SELECT dr.id,dr.transaction_id FROM dispensing_requests dr WHERE dr.slot_id=? AND dr.request_status IN ('failed','timeout')",[$slotId])->fetchAll();
        foreach($failures as $failure){
            $review=$this->q("SELECT metadata FROM activity_logs WHERE action='admin_dispense_issue_reviewed' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? ORDER BY id DESC LIMIT 1",[(string)$failure['transaction_id']])->fetchColumn();
            $v=$review?json_decode($review,true):null;
            $legacy=$this->q("SELECT id FROM activity_logs WHERE action='dispense_stock_reconciled' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? LIMIT 1",[(string)$failure['transaction_id']])->fetchColumn();
            if(!$legacy&&(!$v||empty($v['stockVerified'])||empty($v['inspectionComplete'])||empty($v['firebaseRetired'])||empty($v['motorStopped'])||empty($v['controllerDisconnected'])))throw new KioskError('DISPENSING_REVIEW','Transaction #'.(int)$failure['transaction_id'].' had a failed delivery from this slot that still needs its delivery check. Open Transactions, select #'.(int)$failure['transaction_id'].', complete Check Medicine Delivery, then try again.',409,['transaction_id'=>(int)$failure['transaction_id']]);
        }
        $reports=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();
        if(count($reports)!==1||($fresh&&!$reports[0]['fresh']))throw new KioskError('CONTROLLER_UNVERIFIED','Get a fresh connection check from the installed controller before starting maintenance.');
        $d=$reports[0];
        foreach(['pending_events','durable_events','overflow_events','overflow_pulses','binding_phase'] as $key)if(($d[$key]??-1)!==0)throw new KioskError('COIN_REVIEW','Unconfirmed coin or controller events need staff reconciliation first.');
        foreach(['incomplete_pulses','reconciliation_required','boot_review_required','binding_review_required'] as $key)if(($d[$key]??true)!==false)throw new KioskError('COIN_REVIEW','Unconfirmed coin or controller events need staff reconciliation first.');
        if(!($d['storage_healthy']??false)||!($d['backend_session_verified']??false))throw new KioskError('CONTROLLER_UNVERIFIED','Controller payment storage and session must be verified.');
        if((int)$d['bound_transaction_id']>0){$t=$this->q('SELECT payment_status,dispensing_status FROM transactions WHERE id=? AND machine_id=?',[$d['bound_transaction_id'],$machine['id']])->fetch();if(!$t||$t['payment_status']==='pending'||($t['payment_status']==='successful'&&$t['dispensing_status']!=='dispensed'))throw new KioskError('CONTROLLER_BOUND','The controller still belongs to an unresolved purchase. Complete recovery first.');}
        $motor=$this->q('SELECT motor_status FROM machine_status WHERE machine_id=? AND last_communication_at>=DATE_SUB(NOW(),INTERVAL 30 SECOND)',[$machine['id']])->fetchColumn();
        if(in_array(strtolower(trim((string)$motor)),['running','active','moving','dispensing'],true))throw new KioskError('MOTOR_ACTIVE','The machine reports a running dispenser.');
        try{$state=$this->commandState?($this->commandState)():'unverified';}catch(Throwable){$state='unverified';}
        if($state!=='idle')throw new KioskError('COMMAND_UNVERIFIED','The delivery command is active or cannot be verified. Check the connection and resolve any delivery issue.');
        return $d;
    }
    public function overview():array {
        $op=$this->operation();
        $rows=$this->q('SELECT s.id,s.slot_number,s.medicine_id,s.slot_status,m.name,m.is_enabled,COALESCE(i.quantity,0) quantity,COALESCE(i.reserved_quantity,0) reserved_quantity,m.minimum_stock_level FROM machine_slots s JOIN machines ma ON ma.id=s.machine_id LEFT JOIN medicines m ON m.id=s.medicine_id LEFT JOIN inventory i ON i.medicine_id=m.id WHERE ma.machine_code=? ORDER BY s.slot_number',[$this->machineCode])->fetchAll();
        if(array_map(fn($s)=>(int)$s['slot_number'],$rows)!==[1,2,3])throw new KioskError('SLOT_CONFIGURATION','Exactly three physical slots must be configured. Ask authorized maintenance to inspect the slot map.');
        foreach($rows as &$r){$r['assignment_status']=($op['status']??'')==='active'||$r['slot_status']==='blocked'?'BLOCKED':($r['medicine_id']===null?'AVAILABLE':(!(int)$r['is_enabled']?'DISABLED':'OCCUPIED'));}unset($r);
        return ['slots'=>$rows,'operation'=>($op['status']??'')==='active'?$op:null];
    }
    public function begin(array $b,array $actor):array {
        $this->actor($actor);$key=$b['request_key']??'';$slot=$b['slot_number']??0;$kind=$b['action']??'';
        if(!is_string($key)||!preg_match('/^[a-f0-9]{32}$/D',$key)||!is_int($slot)||$slot<1||$slot>3||!in_array($kind,['add','remove','replace','restock'],true))throw new KioskError('INVALID_MAINTENANCE','Choose a valid physical slot and operation.',422);
        return $this->atomic(function()use($b,$actor,$key,$slot,$kind){
            [$m,$slots]=$this->machine();$existing=$this->operation();
            if(($existing['request_key']??'')===$key){if($existing['slot_number']!==$slot||$existing['action']!==$kind)throw new KioskError('EVENT_CONFLICT','This request key belongs to another operation.');return $existing;}
            if(($existing['status']??'')==='active')throw new KioskError('MAINTENANCE_ACTIVE','Resume the unfinished stock change before starting another.');
            if($this->q("SELECT id FROM activity_logs WHERE action='inventory_maintenance_started' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.request_key'))=? LIMIT 1",[$key])->fetchColumn())throw new KioskError('REQUEST_ALREADY_USED','This maintenance request was already processed. Refresh the slot overview.');
            $s=$slots[$slot-1];
            if($s['slot_status']==='blocked')throw new KioskError('SLOT_BLOCKED','This slot needs recovery before its medicine can change.');
            if($kind==='add'&&$s['medicine_id']!==null)throw new KioskError('SLOT_OCCUPIED',count(array_filter($slots,fn($v)=>$v['medicine_id']!==null))===3?'All three dispensing slots are currently occupied. Remove or replace an existing medicine before assigning a new one.':'This slot is occupied. Choose an available slot, or remove or replace its medicine.');
            if($kind!=='add'&&$s['medicine_id']===null)throw new KioskError('SLOT_EMPTY','Select an occupied slot.');
            $d=$this->safe($m,(int)$s['id'],true);
            $stock=$s['medicine_id']?$this->q('SELECT m.name,m.is_enabled,m.expiry_date,i.quantity FROM medicines m JOIN inventory i ON i.medicine_id=m.id WHERE m.id=? FOR UPDATE',[$s['medicine_id']])->fetch():null;
            if($kind==='restock'&&(!$stock||!$stock['is_enabled']||$stock['expiry_date']<$this->db->query('SELECT CURDATE()')->fetchColumn()))throw new KioskError('MEDICINE_UNAVAILABLE','Remove or replace an inactive or expired medicine instead of restocking it.');
            if($kind==='restock'&&(int)$stock['quantity']>=10)throw new KioskError('STOCK_CAPACITY','Stock is already full.',422);
            $op=['request_key'=>$key,'status'=>'active','action'=>$kind,'slot_id'=>(int)$s['id'],'slot_number'=>$slot,'old_medicine_id'=>$s['medicine_id']===null?null:(int)$s['medicine_id'],'old_name'=>$stock['name']??null,'old_quantity'=>(int)($stock['quantity']??0),'actor_id'=>(int)$actor['id'],'controller'=>$d['device_id'],'started_at'=>date('c')];
            $this->q("UPDATE machine_slots SET slot_status='blocked' WHERE id=?",[$s['id']]);$this->store($op);$this->log('inventory_maintenance_started',$actor,$op);return $op;
        });
    }
    private function validateProduct(array $b):array {
        foreach(['name','generic_name','description','dosage_information','usage_instructions'] as $field){if(!is_string($b[$field]??null)||mb_strlen(trim($b[$field]))<2||mb_strlen($b[$field])>($field==='name'||$field==='generic_name'?180:5000))throw new KioskError('INVALID_MEDICINE','Enter all required, administrator-approved medicine information.',422);$b[$field]=trim($b[$field]);}
        $price=$b['unit_price']??null;
        if(!is_numeric($price)||!is_finite((float)$price)||(float)$price<=0||(float)$price>99999999.99||abs((float)$price*100-round((float)$price*100))>0.00001)throw new KioskError('INVALID_PRICE','Enter a positive price with at most two decimal places.',422);
        if(!is_int($b['stock_quantity']??null)||$b['stock_quantity']<0||$b['stock_quantity']>10)throw new KioskError('INVALID_STOCK','Initial stock must be a whole number from 0 to 10.',422);
        $date=is_string($b['expiry_date']??null)?DateTimeImmutable::createFromFormat('!Y-m-d',$b['expiry_date']):false;
        if(!$date||$date->format('Y-m-d')!==$b['expiry_date']||$b['expiry_date']<$this->db->query('SELECT CURDATE()')->fetchColumn())throw new KioskError('INVALID_EXPIRY','Choose a valid, unexpired medicine date.',422);
        if(!is_string($b['category_name']??null))throw new KioskError('INVALID_CATEGORY','Choose an active category.',422);
        $category=$this->q('SELECT id FROM medicine_categories WHERE name=? AND is_active=1',[$b['category_name']])->fetchColumn();if(!$category)throw new KioskError('INVALID_CATEGORY','Choose an active category.',422);$b['category_id']=(int)$category;
        if($this->q('SELECT id FROM medicines WHERE LOWER(TRIM(name))=LOWER(?) AND is_enabled=1 LIMIT 1',[$b['name']])->fetchColumn())throw new KioskError('DUPLICATE_MEDICINE','An active medicine already uses this name. Do not rename an existing product to replace it.');
        $image=$b['image_url']??'';if(!is_string($image)||strlen($image)>500||($image!==''&&!str_starts_with($image,'/')&&!filter_var($image,FILTER_VALIDATE_URL)))throw new KioskError('INVALID_MEDICINE','Enter a valid medicine image path.',422);
        return $b;
    }
    public function complete(array $b,array $actor):array {
        $this->actor($actor);
        return $this->atomic(function()use($b,$actor){
            [$m,$slots]=$this->machine();$op=$this->operation();
            if(!$op||!is_string($b['request_key']??null)||!hash_equals($op['request_key'],$b['request_key']))throw new KioskError('MAINTENANCE_MISSING','Start or resume the physical slot change first.');
            if($op['action']==='restock')throw new KioskError('RESTOCK_REQUIRED','Resume Add Stock to complete this maintenance operation.');
            $fingerprint=hash('sha256',json_encode($b,JSON_THROW_ON_ERROR));
            if($op['status']==='completed'){if(($op['fingerprint']??'')!==$fingerprint)throw new KioskError('EVENT_CONFLICT','This maintenance request already saved another decision. Refresh the inventory.');return $op;}
            foreach(['machine_powered_off','motors_stopped','no_unrecorded_coins','information_approved'] as $field)if(($b[$field]??false)!==true)throw new KioskError('PHYSICAL_CONFIRMATION','Confirm the machine is powered off, motors stopped, no unrecorded coins, and the entered information was checked.',422);
            if($op['old_medicine_id']&&($b['old_stock_removed']??false)!==true)throw new KioskError('PHYSICAL_CONFIRMATION','Confirm all remaining old medicine was physically removed.',422);
            if($op['old_medicine_id']&&(!is_int($b['old_stock_count']??null)||$b['old_stock_count']!==$op['old_quantity']))throw new KioskError('STOCK_COUNT_MISMATCH','Enter the physically removed count. If it differs from recorded stock, stop and investigate the inventory discrepancy before finishing.');
            if($op['action']!=='remove'&&($b['new_stock_loaded']??false)!==true)throw new KioskError('PHYSICAL_CONFIRMATION','Confirm the new medicine and counted stock are loaded in the selected slot.',422);
            $reason=is_string($b['reason']??null)?trim($b['reason']):'';if(strlen($reason)<5||strlen($reason)>200)throw new KioskError('REASON_REQUIRED','Enter a reason (5–200 characters).',422);
            $d=$this->safe($m,$op['slot_id'],false);if($d['device_id']!==$op['controller'])throw new KioskError('CONTROLLER_CHANGED','The controller changed during maintenance. Staff investigation is required.');
            $s=$slots[$op['slot_number']-1];if((int)$s['medicine_id']!==(int)$op['old_medicine_id']||$s['slot_status']!=='blocked')throw new KioskError('SLOT_CHANGED','The slot changed during maintenance.');
            if($op['action']!=='remove'&&!is_array($b['medicine']??null))throw new KioskError('INVALID_MEDICINE','Enter the replacement medicine information.',422);
            $product=$op['action']==='remove'?null:$this->validateProduct($b['medicine']??[]);
            if($op['old_medicine_id']){
                $stock=$this->q('SELECT * FROM inventory WHERE medicine_id=? FOR UPDATE',[$op['old_medicine_id']])->fetch();
                if((int)$stock['quantity']!==$op['old_quantity']||(int)$stock['reserved_quantity']!==0)throw new KioskError('STOCK_CHANGED','Recorded stock changed. Inspect and reconcile before continuing.');
                $this->q('UPDATE inventory SET quantity=0,last_counted_at=NOW() WHERE medicine_id=?',[$op['old_medicine_id']]);
                $this->q('UPDATE medicines SET is_enabled=0 WHERE id=?',[$op['old_medicine_id']]);
                if($op['old_quantity']>0)$this->movement($op['old_medicine_id'],$op['old_quantity'],0,$reason,$actor);
            }
            $new=null;
            if($product){$p=$product;
                $this->q('INSERT INTO medicines(category_id,name,generic_name,description,dosage_information,usage_instructions,image_url,unit_price,expiry_date,minimum_stock_level,is_enabled,created_by) VALUES(?,?,?,?,?,?,?,?,?,3,1,?)',[$p['category_id'],$p['name'],$p['generic_name'],$p['description'],$p['dosage_information'],$p['usage_instructions'],$p['image_url']??'',$p['unit_price'],$p['expiry_date'],$actor['id']]);$new=(int)$this->db->lastInsertId();
                $this->q('INSERT INTO inventory(medicine_id,quantity,last_counted_at) VALUES(?,?,NOW())',[$new,$p['stock_quantity']]);if($p['stock_quantity']>0)$this->movement($new,0,$p['stock_quantity'],'Initial load: '.$reason,$actor);
                $this->log('medicine_created',$actor,['medicine_id'=>$new,'medicine_name'=>$p['name'],'slot_number'=>$op['slot_number'],'initial_stock'=>$p['stock_quantity']]);
            }
            $this->q("UPDATE machine_slots SET medicine_id=?,slot_status=? WHERE id=?",[$new,$new?'ready':'empty',$op['slot_id']]);
            $op+=['new_medicine_id'=>$new,'new_medicine_name'=>$product['name']??null,'new_quantity'=>$product['stock_quantity']??0,'physically_removed_count'=>$b['old_stock_count']??0,'reason'=>$reason,'fingerprint'=>$fingerprint,'physical_checks'=>array_intersect_key($b,array_flip(['machine_powered_off','motors_stopped','no_unrecorded_coins','information_approved','old_stock_removed','new_stock_loaded']))];$op['status']='completed';$op['completed_by']=(int)$actor['id'];$op['completed_at']=date('c');
            $this->store($op);$this->log($op['action']==='replace'?'medicine_replaced':($op['action']==='remove'?'medicine_removed':'slot_assignment_changed'),$actor,$op);
            return $op;
        });
    }
    private function movement(int $id,int $previous,int $next,string $reason,array $actor):void{$this->q("INSERT INTO stock_movements(medicine_id,previous_quantity,new_quantity,change_quantity,change_type,reason,actor_user_id) VALUES(?,?,?,?,'adjustment',?,?)",[$id,$previous,$next,$next-$previous,$reason,$actor['id']]);}
    public function restock(int $id,array $b,array $actor):array {
        $this->actor($actor);$delta=$b['delta']??null;
        if(!is_int($delta)||$delta<1||$delta>10||($b['physically_loaded']??false)!==true||($b['same_expiry']??false)!==true)throw new KioskError('INVALID_STOCK','Confirm physically loaded stock with the same expiry date and enter a positive whole quantity (1–10).',422);
        $key=$b['request_key']??'';if(!is_string($key)||!preg_match('/^[a-f0-9]{32}$/D',$key))throw new KioskError('INVALID_REQUEST','A stable restock request key is required.',422);
        return $this->atomic(function()use($id,$b,$actor,$delta){
            [$m,$slots]=$this->machine();
            $retry=$this->q("SELECT metadata FROM activity_logs WHERE action='stock_adjusted' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.request_key'))=? LIMIT 1",[$b['request_key']])->fetchColumn();
            if($retry){$v=json_decode($retry,true);if((int)$v['medicine_id']!==$id||(int)$v['change']!==$delta||$v['reason']!==trim((string)($b['reason']??'')))throw new KioskError('EVENT_CONFLICT','This restock key belongs to a different adjustment.');return ['medicine_id'=>$id,'previous_quantity'=>$v['previous'],'new_quantity'=>$v['new']];}
            $op=$this->operation();
            if(($op['status']??'')!=='active'||$op['action']!=='restock'||(int)$op['old_medicine_id']!==$id||$op['request_key']!==$b['request_key'])throw new KioskError('MAINTENANCE_REQUIRED','Start or resume Add Stock safety checks before loading tablets.');
            foreach(['machine_powered_off','motors_stopped','no_unrecorded_coins'] as $field)if(($b[$field]??false)!==true)throw new KioskError('PHYSICAL_CONFIRMATION','Confirm the entire machine is powered off, dispensers stopped, and no coins remain unrecorded.',422);
            $s=null;foreach($slots as $candidate)if((int)$candidate['medicine_id']===$id)$s=$candidate;
            if(!$s||$s['slot_status']!=='blocked'||(int)$s['id']!==$op['slot_id'])throw new KioskError('SLOT_BLOCKED','The assigned slot no longer matches this stock check.');
            $d=$this->safe($m,(int)$s['id'],false);
            if($d['device_id']!==$op['controller'])throw new KioskError('CONTROLLER_CHANGED','The controller changed during restocking. Staff investigation is required.');
            $stock=$this->q('SELECT i.*,m.is_enabled,m.name,m.expiry_date FROM inventory i JOIN medicines m ON m.id=i.medicine_id WHERE medicine_id=? FOR UPDATE',[$id])->fetch();
            if(!$stock||!$stock['is_enabled']||$stock['expiry_date']<$this->db->query('SELECT CURDATE()')->fetchColumn())throw new KioskError('MEDICINE_UNAVAILABLE','Only an active, unexpired medicine can be restocked.');
            if((int)$stock['quantity']!==$op['old_quantity'])throw new KioskError('STOCK_CHANGED','Recorded stock changed during loading. Inspect the slot before continuing.');
            $next=(int)$stock['quantity']+$delta;if($next>10)throw new KioskError('STOCK_CAPACITY','Recorded stock must not exceed 10 tablets.',422);
            $reason=trim((string)($b['reason']??'Restock'));if(strlen($reason)<5||strlen($reason)>200)throw new KioskError('REASON_REQUIRED','Enter a stock adjustment reason (5–200 characters).',422);
            $this->q('UPDATE inventory SET quantity=?,last_counted_at=NOW() WHERE medicine_id=?',[$next,$id]);$this->movement($id,(int)$stock['quantity'],$next,$reason,$actor);
            $this->q("UPDATE machine_slots SET slot_status='ready' WHERE id=?",[$s['id']]);
            $op['status']='completed';$op['new_quantity']=$next;$op['completed_by']=(int)$actor['id'];$op['completed_at']=date('c');$this->store($op);
            $this->q("INSERT INTO notifications(notification_type,title,message,severity,medicine_id) VALUES('stock_added','Stock added',?,'info',?)",[$stock['name'].': +'.$delta.' tablets. Current stock: '.$next.'.',$id]);
            $this->log('stock_adjusted',$actor,['request_key'=>$b['request_key'],'medicine_id'=>$id,'medicine_name'=>$stock['name'],'slot_number'=>(int)$s['slot_number'],'previous'=>(int)$stock['quantity'],'change'=>$delta,'new'=>$next,'reason'=>$reason,'physically_loaded'=>true,'same_expiry'=>true]);return ['medicine_id'=>$id,'previous_quantity'=>(int)$stock['quantity'],'new_quantity'=>$next];
        });
    }
}
