<?php
declare(strict_types=1);
// Local HTTP fixture only; never contacts the configured Firebase database.
if (PHP_SAPI === 'cli-server') {
    $mode=explode('/',trim($_SERVER['REQUEST_URI'],'/'))[0];
    header('Content-Type: application/json');
    if ($_SERVER['REQUEST_METHOD']==='GET') {
        header('ETag: "test-version"');
        echo json_encode($mode==='empty' ? null : ['request_id'=>str_starts_with($mode,'other')?99:45,'slot'=>1,'quantity'=>2,'dispensed'=>1,'status'=>$mode==='other'?'pending':($mode==='other_running'?'dispensing':'failed')]);
    } else {
        $body=json_decode(file_get_contents('php://input'),true);
        $isResult=str_contains($_SERVER['REQUEST_URI'],'/dispense_results/45.json');
        $valid=$isResult
            ? in_array($mode,['matching','empty','other_finished'],true) && $body===['request_id'=>45,'status'=>'failed','source'=>'admin_recovery','hardware_disabled_confirmed'=>true]
            : in_array($mode,['matching','result_failure'],true) && ($_SERVER['HTTP_IF_MATCH']??'')==='"test-version"' && $body===['request_id'=>45,'slot'=>0,'quantity'=>0,'dispensed'=>1,'status'=>'failed'];
        http_response_code($valid?200:412);
        echo json_encode($body);
    }
    exit;
}
if (PHP_SAPI!=='cli') exit;
require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$socket=stream_socket_server('tcp://127.0.0.1:0',$errno,$error);
$address=stream_socket_get_name($socket,false); fclose($socket);
$log=tempnam(sys_get_temp_dir(),'firebase-recovery-');
$process=proc_open([PHP_BINARY,'-S',$address,__FILE__],[0=>['pipe','r'],1=>['file',$log,'a'],2=>['file',$log,'a']],$pipes);
try {
    for($i=0;$i<50;$i++) { $ready=@stream_socket_client('tcp://'.$address,$errno,$error,0.1); if($ready) { fclose($ready); break; } usleep(20000); }
    foreach(['matching','empty','other_finished'] as $mode) {
        (new FirebaseRealtimeDatabase('http://'.$address.'/'.$mode))->retireDispenseCommand(45);
        echo "PASS $mode command safely retired or absent\n";
    }
    foreach(['other','other_running','stale','result_failure'] as $mode) {
        $failed=false;
        try { (new FirebaseRealtimeDatabase('http://'.$address.'/'.$mode))->retireDispenseCommand(45); } catch(RuntimeException $e) { $failed=true; }
        if(!$failed) throw new RuntimeException('Expected safe refusal: '.$mode);
        echo "PASS $mode command refused\n";
    }
} finally {
    fclose($pipes[0]); proc_terminate($process); proc_close($process); unlink($log);
}
