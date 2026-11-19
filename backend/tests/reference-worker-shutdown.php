<?php
declare(strict_types=1);
// Synthetic only: do not include application config or autoloader.
require __DIR__.'/../src/ReferenceWorkerControl.php';
require __DIR__.'/../src/ReferenceWorkerRunner.php';
interface TransactionReferenceGateway{public function syncTransactionReference(string $kind,int $transactionId,string $reference,?int $requestId=null):void;}
require __DIR__.'/../src/TransactionReferenceSync.php';
$checks=0;
function checkWorker(bool $ok,string $name):void{global $checks;if(!$ok)throw new RuntimeException($name);$checks++;echo "PASS $name\n";}
function fails(callable $f):bool{try{$f();return false;}catch(Throwable $e){return true;}}
final class WorkerFakeStatement extends PDOStatement{
    public function __construct(private WorkerFakeDB $db,private string $sql){}
    public function execute(?array $params=null):bool{$this->db->writes[]=[$this->sql,$params??[]];return true;}
    public function fetchColumn(int $column=0):mixed{return str_contains($this->sql,'GET_LOCK')?$this->db->lock:(str_contains($this->sql,'RELEASE_LOCK')?$this->db->release:0);}
    public function fetchAll(int $mode=PDO::FETCH_DEFAULT,mixed ...$args):array{return [['transaction_id'=>900001,'transaction_code'=>'TXN-SYNTHETIC1','request_id'=>null,'entity_id'=>900001],['transaction_id'=>900002,'transaction_code'=>'TXN-SYNTHETIC2','request_id'=>null,'entity_id'=>900002]];}
}
final class WorkerFakeDB extends PDO{
    public array $queries=[],$writes=[];public int $lock=1,$release=1;
    public function __construct(){}
    public function query(string $query,?int $fetchMode=null,mixed ...$args):PDOStatement|false{$this->queries[]=$query;return new WorkerFakeStatement($this,$query);}
    public function prepare(string $query,array $options=[]):PDOStatement|false{return new WorkerFakeStatement($this,$query);}
    public function inTransaction():bool{return false;}
}
final class WorkerFakeControl{
    public bool $stop=false,$bad=false,$cut=false;public array $receipts=[];
    public function blocked():bool{if($this->bad)throw new RuntimeException('bad request');return $this->stop;}
    public function receipt(string $reason,string $cleanup,int $code):void{if($this->cut)throw new RuntimeException('cut');$this->receipts[]=[$reason,$cleanup,$code];}
}
function workerFixture(WorkerFakeControl $c,WorkerFakeDB $db,?Closure $action=null,bool $resetFail=false):array{
    $connections=0;$sleeps=0;
    $gateway=new class($c,$action) implements TransactionReferenceGateway{
        public int $calls=0;
        public function __construct(private WorkerFakeControl $c,private ?Closure $action){}
        public function syncTransactionReference(string $kind,int $transactionId,string $reference,?int $requestId=null):void{$this->calls++;if($this->action)($this->action)($this->c);}
    };
    $code=ReferenceWorkerRunner::run($c,true,false,function()use(&$connections,$db){$connections++;return $db;},fn($d)=>new TransactionReferenceSync($d,$gateway),function()use($resetFail){if($resetFail)throw new RuntimeException('cleanup');},function()use($c,&$sleeps){$sleeps++;$c->stop=true;},static function($message){});
    foreach($db->writes as [$sql])if(!preg_match('/^(SELECT |INSERT IGNORE INTO system_settings|INSERT INTO system_settings|DELETE FROM system_settings)/',$sql))throw new RuntimeException('Unexpected SQL mutation');
    return compact('code','connections','gateway','sleeps');
}
$c=new WorkerFakeControl;$c->stop=true;$db=new WorkerFakeDB;$r=workerFixture($c,$db);checkWorker(!$r['connections']&&$r['code']===0,'stop before start without database');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$r=workerFixture($c,$db,fn($c)=>$c->stop=true);
checkWorker($r['gateway']->calls===1&&$r['code']===0,'finish current item and stop before next');
checkWorker(count(array_filter($db->writes,fn($w)=>str_starts_with((string)($w[1][0]??''),'txn_ref_done_')))===1,'current item marker committed in fake store');
checkWorker($c->receipts[0][1]==='release_confirmed_connection_closed','finally confirms lease cleanup');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$r=workerFixture($c,$db);checkWorker($r['sleeps']===1&&$r['connections']===1,'stop during sleep prevents next pass');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$db->lock=0;$r=workerFixture($c,$db);checkWorker(!$r['gateway']->calls&&$c->receipts[0][0]==='lease_unavailable','lock denied without sync');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$db->release=0;$r=workerFixture($c,$db);checkWorker($r['code']===1&&$c->receipts[0][1]==='cleanup_uncertain','release failure not clean');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$r=workerFixture($c,$db,null,true);checkWorker($r['code']===1,'reset failure not clean');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$r=workerFixture($c,$db,function($c){$c->stop=true;throw new RuntimeException('network');});checkWorker($r['gateway']->calls===1&&count(array_filter($db->writes,fn($w)=>str_starts_with((string)($w[1][0]??''),'txn_ref_error_')))===1,'network failure preserves retry marker before stop');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$c->bad=true;$r=workerFixture($c,$db);checkWorker($r['code']===1&&!$r['connections'],'malformed request before DB');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;$c->stop=true;$c->cut=true;$r=workerFixture($c,$db);checkWorker($r['code']===2,'failed exit receipt not success');
$c=new WorkerFakeControl;$attempts=0;
$code=ReferenceWorkerRunner::run($c,true,false,function()use(&$attempts){$attempts++;throw new RuntimeException('fake connection failed');},static fn($db)=>throw new RuntimeException('must not create gateway'),static function(){},function()use($c){$c->stop=true;},static function($s){});
checkWorker($code===0&&$attempts===1,'stop after connection failure prevents another connection');
$c=new WorkerFakeControl;$db=new WorkerFakeDB;
$code=ReferenceWorkerRunner::run($c,false,true,fn()=>$db,fn($d)=>new TransactionReferenceSync($d,new class implements TransactionReferenceGateway{public function syncTransactionReference(string $kind,int $transactionId,string $reference,?int $requestId=null):void{throw new RuntimeException('initialize must not contact gateway');}}),static function(){},static function($us){},static function($s){});
checkWorker($code===0&&in_array("SELECT RELEASE_LOCK('medidispense_reference_sync')",$db->queries,true),'initialize-only path also releases named lock');
$base=sys_get_temp_dir().DIRECTORY_SEPARATOR.'md-worker-'.bin2hex(random_bytes(8));mkdir($base,0700);
$security=static function($p){if(!is_dir($p))throw new RuntimeException('missing');};$a=null;$b=null;
try{
 $a=new ReferenceWorkerControl($base,__FILE__,$security);$id=$a->start('SYNTHETIC-START');
 $b=new ReferenceWorkerControl($base,__FILE__,$security);checkWorker(fails(fn()=>$b->start('OTHER')),'local lease prevents second instance');unset($b);
 $a->request($id['instance']);checkWorker($a->blocked(),'atomic exact stop request');$a->request($id['instance']);checkWorker($a->blocked(),'duplicate stop idempotent');
 $a->receipt('maintenance_stop','release_confirmed_connection_closed',0);checkWorker(fails(fn()=>$a->request($id['instance'])),'exited target rejected');unset($a);
 $b=new ReferenceWorkerControl($base,__FILE__,$security);checkWorker(fails(fn()=>$b->start('RESTART')),'restart blocked by sticky maintenance request');unset($b);
 file_put_contents($base.'/maintenance.json','{}');$b=new ReferenceWorkerControl($base,__FILE__,$security);checkWorker(fails(fn()=>$b->blocked()),'malformed file fails closed');checkWorker(fails(fn()=>$b->request(str_repeat('0',32))),'unknown instance rejected');unset($b);
 unlink($base.'/maintenance.json');
 $cut=static function($p,$s){throw new RuntimeException('interrupted write');};$b=new ReferenceWorkerControl($base,__FILE__,$security,$cut);checkWorker(fails(fn()=>$b->start('CUT')),'interrupted descriptor publication blocks startup');unset($b);
 $a=new ReferenceWorkerControl($base,__FILE__,$security);$id=$a->start('NEXT');$bad=$id;$bad['pid']++;
 file_put_contents($base.'/maintenance.json',json_encode(['version'=>1,'action'=>'stop','target'=>$bad]));checkWorker(fails(fn()=>$a->blocked()),'stale PID binding rejected');
 $bad=$id;$bad['process_started']='STALE';file_put_contents($base.'/maintenance.json',json_encode(['version'=>1,'action'=>'stop','target'=>$bad]));checkWorker(fails(fn()=>$a->blocked()),'stale process start binding rejected');
 unset($a);unlink($base.'/maintenance.json');
 $partial=static function($p,$s){if(str_ends_with($p,'.exit.json')){file_put_contents($p.'.tmp','partial');throw new RuntimeException('cut receipt');}file_put_contents($p,$s);};
 $a=new ReferenceWorkerControl($base,__FILE__,$security,$partial);$id=$a->start('RECEIPT-CUT');
 checkWorker(fails(fn()=>$a->receipt('maintenance_stop','not_connected',0))&&!file_exists($base.'/'.$id['instance'].'.exit.json'),'interrupted filesystem receipt never appears complete');
 unset($a);
 $a=new ReferenceWorkerControl($base,__FILE__,$security);$id=$a->start('APPROVED-NO-HOLD-RESTART');checkWorker(!$a->blocked(),'fresh instance can start when no maintenance hold exists');
}finally{unset($a,$b);foreach(glob($base.DIRECTORY_SEPARATOR.'*') as $p)unlink($p);rmdir($base);}
echo "SUMMARY checks=$checks failed=0 live_services=NOT_ACCESSED\n";
