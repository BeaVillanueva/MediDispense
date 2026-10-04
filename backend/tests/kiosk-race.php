<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/../src/KioskService.php';
$name=trim(file_get_contents(__DIR__.'/../../tmp/kiosk-test-database.txt'));
if(!preg_match('/^medidispense_kiosk_test_[a-f0-9]+$/D',$name))exit(1);
$db=new PDO('mysql:host=127.0.0.1;port=33317;dbname='.$name,'root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
if(($argv[1]??'')==='worker') {
    while(microtime(true)<(float)$argv[2])usleep(1000);
    try{(new KioskService($db,'MD-001'))->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],bin2hex(random_bytes(32)));echo 'ACCEPTED';}
    catch(KioskError $e){echo $e->errorCode;}exit;
}
$db->exec('UPDATE inventory SET quantity=1,reserved_quantity=0 WHERE medicine_id=1');
$deadline=(string)(microtime(true)+1);
$workers=[];
for($i=0;$i<2;$i++) {
    $pipes=[];$process=proc_open([PHP_BINARY,__FILE__,'worker',$deadline],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($process))throw new RuntimeException('Worker could not start');
    fclose($pipes[0]);$workers[]=[$process,$pipes];
}
$results=[];
foreach($workers as [$process,$pipes]){$results[]=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($process)!==0)throw new RuntimeException('Worker failed: '.$error);}
sort($results);
if($results!==['ACCEPTED','OUT_OF_STOCK'])throw new RuntimeException('Unexpected concurrent checkout results: '.json_encode($results));
$stock=$db->query('SELECT quantity,reserved_quantity FROM inventory WHERE medicine_id=1')->fetch();
if((int)$stock['quantity']!==1||(int)$stock['reserved_quantity']!==1)throw new RuntimeException('Reservation invariant failed');
echo "PASS: two simultaneous checkouts for the final unit produce one purchase and one OUT_OF_STOCK; physical stock is unchanged.\n";
