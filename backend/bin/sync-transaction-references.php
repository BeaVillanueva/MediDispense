<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/Database.php';
require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
require __DIR__.'/../src/TransactionReferenceSync.php';
$config=require __DIR__.'/../config/config.php';
$watch=in_array('--watch',$argv,true);
$initialize=in_array('--initialize',$argv,true);
do {
    try {
        $db=Database::connect($config);
        if(!(int)$db->query("SELECT GET_LOCK('medidispense_reference_sync',0)")->fetchColumn())exit(0);
        $sync=new TransactionReferenceSync($db,new FirebaseRealtimeDatabase((string)$config['firebase']['database_url']));
        if($initialize){$sync->initialize();echo "New-record baselines initialized; no Firebase writes or historical backfill.\n";exit;}
        $results=$sync->run();if($results)echo json_encode($results).PHP_EOL;
        $db->prepare("INSERT INTO system_settings(setting_key,setting_value) VALUES('txn_ref_worker_last_seen',NOW()) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)")->execute();
        $db->query("SELECT RELEASE_LOCK('medidispense_reference_sync')");
    } catch(Throwable $e) {
        fwrite(STDERR,"Transaction reference sync unavailable; no operational records modified.\n");
        $sync=null;$db=null;Database::resetConnection();unset($e);
        if(!$watch)exit(1);
    }
    if($watch)sleep(5);
}while($watch);
