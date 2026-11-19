<?php
declare(strict_types=1);
// NOT an additional runnable worker. Canonical entrypoint must replace the legacy
// script only after separate authorization and verified legacy process exit.
if(realpath($_SERVER['SCRIPT_FILENAME']??'')===__FILE__){fwrite(STDERR,"Candidate is not activated.\n");exit(2);}
require_once __DIR__.'/../src/ReferenceWorkerControl.php';
require_once __DIR__.'/../src/ReferenceWorkerRunner.php';
$control=null;
try {
    $canonical=__DIR__.'/sync-transaction-references.php';
    $control=new ReferenceWorkerControl('C:\\MediDispensePrivateWorkerControl\\reference-sync',$canonical,ReferenceWorkerControl::windowsSecurity(...));
    $request=array_search('--request-stop',$argv,true);
    if($request!==false){
        if(count($argv)!==3||$request!==1)throw new RuntimeException('Exact instance required.');
        $control->request($argv[2]);echo "Stop published; exit verification still required.\n";exit(0);
    }
    foreach(array_slice($argv,1) as $arg)if(!in_array($arg,['--watch','--initialize'],true))throw new RuntimeException('Unknown option.');
    $out=[];$status=1;
    exec('powershell.exe -NoProfile -NonInteractive -Command "(Get-Process -Id '.getmypid().').StartTime.ToUniversalTime().ToString(\'o\')" 2>NUL',$out,$status);
    $started=trim(implode('', $out));
    if($status!==0||!preg_match('/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/D',$started))throw new RuntimeException('Process start identity unverified.');
    $control->start($started);
    require_once __DIR__.'/../src/Database.php';
    require_once __DIR__.'/../src/FirebaseRealtimeDatabase.php';
    require_once __DIR__.'/../src/TransactionReferenceSync.php';
    $config=require __DIR__.'/../config/config.php';
    $code=ReferenceWorkerRunner::run($control,in_array('--watch',$argv,true),in_array('--initialize',$argv,true),
        static fn()=>Database::connect($config),
        static fn($db)=>new TransactionReferenceSync($db,new FirebaseRealtimeDatabase((string)$config['firebase']['database_url'])),
        static fn()=>Database::resetConnection(),static fn(int $us)=>usleep($us),
        static fn(string $message)=>fwrite(STDERR,$message.PHP_EOL));
    unset($control);exit($code);
}catch(Throwable $e){fwrite(STDERR,"Control unavailable; clean startup/exit NOT confirmed.\n");unset($control);exit(2);}
