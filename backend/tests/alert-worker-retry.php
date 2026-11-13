<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
$source=file_get_contents(__DIR__.'/../bin/alert-worker.php');
$source=str_replace('__DIR__',var_export(realpath(__DIR__.'/../bin'),true),$source);
$source=str_replace('if (PHP_SAPI',"defined('STDERR') || define('STDERR',fopen('php://stderr','w'));\nif (PHP_SAPI",$source);
$source=preg_replace('/\$config=require[^;]+;/',"\$config=['database'=>['host'=>'127.0.0.1','port'=>1,'name'=>'worker_retry_fixture','user'=>'fixture','password'=>''],'smtp'=>[]];",$source,1);
$source=str_replace('$watch=in_array',"\$argv=['fixture','--watch'];\n\$watch=in_array",$source);
$errorFile=tempnam(sys_get_temp_dir(),'md-worker-retry-');
$process=proc_open([PHP_BINARY],[0=>['pipe','r'],1=>['file','NUL','w'],2=>['file',$errorFile,'w']],$pipes);
if(!is_resource($process))throw new RuntimeException('Cannot launch isolated worker fixture.');
try {
    fwrite($pipes[0],$source);fclose($pipes[0]);
    $errors='';$deadline=microtime(true)+12;
    do {
        usleep(100000);$errors=file_get_contents($errorFile);$status=proc_get_status($process);
        if(!$status['running'])throw new RuntimeException('Watch worker exited during database unavailability: '.$errors);
        if(substr_count($errors,'Alert worker unavailable; queued alerts retained.')>=2)break;
    }while(microtime(true)<$deadline);
    if(substr_count($errors,'Alert worker unavailable; queued alerts retained.')<2)throw new RuntimeException('Database retry was not observed.');
    echo "PASS Watch worker survives unavailable MySQL at startup.\nPASS Watch worker retries instead of exhausting scheduled-task restarts.\nNo application database, SMTP, inventory or hardware used.\n";
} finally {
    proc_terminate($process);
    foreach($pipes as $pipe)if(is_resource($pipe))fclose($pipe);
    proc_close($process);
    unlink($errorFile);
}
