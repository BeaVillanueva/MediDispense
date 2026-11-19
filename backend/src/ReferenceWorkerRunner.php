<?php
declare(strict_types=1);

/** Injectable orchestration. No configuration, connections or network created here. */
final class ReferenceWorkerRunner {
    public static function run(object $control,bool $watch,bool $initialize,Closure $connect,Closure $factory,Closure $reset,Closure $pause,Closure $output):int {
        $cleanup='not_connected';$reason='completed';$code=0;
        try {
            do {
                if($control->blocked()){$reason='maintenance_stop';break;}
                $db=null;$sync=null;$locked=false;$retry=false;
                try {
                    $db=$connect();
                    if($control->blocked()){$reason='maintenance_stop';break;}
                    if($db->inTransaction())throw new RuntimeException('Unexpected pre-existing transaction.');
                    $locked=(int)$db->query("SELECT GET_LOCK('medidispense_reference_sync',0)")->fetchColumn()===1;
                    if(!$locked){$reason='lease_unavailable';break;}
                    if($control->blocked()){$reason='maintenance_stop';break;}
                    $sync=$factory($db);
                    $stop=fn():bool=>$control->blocked();
                    if($initialize)$sync->initialize($stop);
                    else {$rows=$sync->run($stop);if($rows)$output(json_encode($rows,JSON_THROW_ON_ERROR));}
                    if($control->blocked()){$reason='maintenance_stop';break;}
                    if(!$initialize)$db->prepare("INSERT INTO system_settings(setting_key,setting_value) VALUES('txn_ref_worker_last_seen',NOW()) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)")->execute();
                } catch(Throwable $e) {
                    $output('Reference sync interrupted; earlier metadata writes may have completed.');
                    $retry=$watch&&!$initialize;$reason='operation_error';if(!$retry)$code=1;
                } finally {
                    $cleanup=$db?'connection_closed_release_unconfirmed':'not_connected';
                    try {
                        if($db&&$db->inTransaction())throw new RuntimeException('Unexpected active transaction at cleanup.');
                        if($locked){if((int)$db->query("SELECT RELEASE_LOCK('medidispense_reference_sync')")->fetchColumn()!==1)throw new RuntimeException('Release not confirmed.');$cleanup='release_confirmed_connection_closed';}
                    }catch(Throwable $e){$cleanup='cleanup_uncertain';$code=1;$retry=false;}
                    $sync=null;$db=null;
                    try{$reset();}catch(Throwable $e){$cleanup='cleanup_uncertain';$code=1;$retry=false;}
                }
                if($code||$initialize||!$watch)break;
                if($control->blocked()){$reason='maintenance_stop';break;}
                for($n=0;$n<20;$n++) {if($control->blocked()){$reason='maintenance_stop';break 2;}$pause(250000);}
                if($retry)$reason='retrying';
            }while($watch);
        }catch(Throwable $e){$reason='control_error';$code=1;}
        try{$control->receipt($reason,$cleanup,$code);}catch(Throwable $e){$output('Exit receipt unavailable; clean exit NOT confirmed.');return 2;}
        return $code;
    }
}
