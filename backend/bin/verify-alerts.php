<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../vendor/autoload.php';
require_once __DIR__.'/../src/Database.php';
require_once __DIR__.'/../src/KioskService.php';
require_once __DIR__.'/../src/AlertService.php';
require_once __DIR__.'/../src/AlertEmail.php';
$config=require __DIR__.'/../config/config.php';
$db=Database::connect($config);
$options=getopt('',['create','run:','finish','resume-unsent-test','reset-test-status','user-id:']);
$alerts=new AlertService($db);
$user=(int)($options['user-id']??1);
$q=$db->prepare("SELECT u.id,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.is_active=1 AND u.email_verified_at IS NOT NULL AND r.code IN ('super_admin','admin')");$q->execute([$user]);$actor=$q->fetch();
if(!$actor)throw new RuntimeException('An active verified administrator is required.');
$critical=['inventory','transactions','transaction_items','payments','dispensing_requests','dispensing_logs','stock_movements','machine_slots','machine_status'];
$hashes=static function()use($db,$critical):array{$result=[];foreach($critical as $table)$result[$table]=hash('sha256',json_encode($db->query("SELECT * FROM $table ORDER BY 1")->fetchAll()));return $result;};
$root=realpath(__DIR__.'/../..');
if(isset($options['create'])) {
    if(!(new SmtpAlertTransport($config['smtp']))->configured())throw new RuntimeException('SMTP must be configured before the end-to-end test.');
    $q=$db->prepare('SELECT low_stock,dispensing_failure FROM alert_recipients WHERE user_id=?');$q->execute([$user]);$subscription=$q->fetch();
    if(!$subscription || !$subscription['low_stock'] || !$subscription['dispensing_failure'])throw new RuntimeException('Administrator must already be subscribed to both categories.');
    $run='MDTEST-'.strtoupper(bin2hex(random_bytes(5)));
    $baseline=$hashes();
    $r=$db->query('SELECT m.*,s.id slot_id,s.slot_number,s.machine_id FROM medicines m JOIN machine_slots s ON s.medicine_id=m.id ORDER BY s.slot_number LIMIT 1')->fetch();
    if(!$r)throw new RuntimeException('An existing medicine/slot label is needed for the fixture.');
    // Separate connection: temporary fixtures cannot modify application rows.
    $c=$config['database'];
    $fixture=new PDO(sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',$c['host'],$c['port'],$c['name']),$c['user'],$c['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
    foreach(['users','roles','medicine_categories','medicines','inventory','machines','machine_slots','machine_status','transactions','transaction_items','dispensing_requests','dispensing_logs','notifications','activity_logs','system_settings','alert_incidents','alert_recipients','notification_reads','notification_dismissals','alert_email_jobs','alert_email_attempts'] as $table) {
        $ddl=$db->query("SHOW CREATE TABLE $table")->fetch(PDO::FETCH_NUM)[1];
        $ddl=preg_replace('/^\s*CONSTRAINT[^\n]+\n/m','',$ddl);$ddl=preg_replace('/,\n\)/',"\n)",$ddl);
        $fixture->exec(str_replace('CREATE TABLE','CREATE TEMPORARY TABLE',$ddl));
    }
    $insert=static function(string $table,array $row)use($fixture):void{$columns=implode(',',array_map(fn($s)=>'`'.$s.'`',array_keys($row)));$q=$fixture->prepare("INSERT INTO $table ($columns) VALUES (".implode(',',array_fill(0,count($row),'?')).')');$q->execute(array_values($row));};
    $insert('system_settings',['setting_key'=>'alert_monitor_started_at','setting_value'=>date('Y-m-d H:i:s',strtotime('-1 day'))]);
    $insert('medicine_categories',['id'=>$r['category_id'],'name'=>'TEST category']);
    $name='[TEST] '.$r['name'];$threshold=max(1,(int)$r['minimum_stock_level']);$quantity=max(0,$threshold-1);
    $insert('medicines',['id'=>$r['id'],'category_id'=>$r['category_id'],'name'=>$name,'generic_name'=>$r['generic_name'],'description'=>'Isolated alert fixture','dosage_information'=>'Not medical advice','usage_instructions'=>'Test only','unit_price'=>$r['unit_price'],'expiry_date'=>$r['expiry_date'],'minimum_stock_level'=>$threshold]);
    $insert('inventory',['medicine_id'=>$r['id'],'quantity'=>$quantity,'reserved_quantity'=>0]);
    $insert('machines',['id'=>$r['machine_id'],'machine_code'=>'TEST-ALERT','name'=>'Isolated test']);
    $insert('machine_slots',['id'=>$r['slot_id'],'machine_id'=>$r['machine_id'],'slot_number'=>$r['slot_number'],'medicine_id'=>$r['id'],'motor_id'=>'TEST','sensor_id'=>'TEST','slot_status'=>'ready']);
    $insert('transactions',['id'=>1,'transaction_code'=>$run,'machine_id'=>$r['machine_id'],'payment_status'=>'successful','dispensing_status'=>'dispensing','total_amount'=>10,'amount_paid'=>10]);
    $insert('transaction_items',['transaction_id'=>1,'medicine_id'=>$r['id'],'slot_id'=>$r['slot_id'],'medicine_name_snapshot'=>$name,'unit_price_snapshot'=>10,'quantity'=>1,'subtotal'=>10]);
    $insert('dispensing_requests',['id'=>1,'transaction_id'=>1,'machine_id'=>$r['machine_id'],'slot_id'=>$r['slot_id'],'quantity'=>1,'dispensed_quantity'=>0,'request_status'=>'sent','command_reference'=>$run,'command_payload'=>'{}','sent_at'=>date('Y-m-d H:i:s',strtotime('-1 day'))]);
    $detector=new AlertService($fixture,120,'medidispense_isolated_e2e');$detector->scan();$detector->scan();
    $incidents=$fixture->query('SELECT a.*,n.title,n.message,n.severity FROM alert_incidents a JOIN notifications n ON n.id=a.notification_id ORDER BY a.id')->fetchAll();
    if(count($incidents)!==2)throw new RuntimeException('Expected one detected fixture incident per category.');
    $db->beginTransaction();
    try {
        foreach($incidents as $i) {
            $d=json_decode($i['details'],true,512,JSON_THROW_ON_ERROR);$d['is_test']=true;$d['test_run_id']=$run;
            $d['action']='TEST ONLY: verify this notification and email. No restocking, motor operation, payment, or physical dispensing is requested.';
            $title='[TEST] '.$i['title'];$message='[TEST '.$run.'] '.$i['message'].' No action on the physical machine is required.';
            $q=$db->prepare('INSERT INTO notifications(notification_type,title,message,severity,medicine_id,transaction_id) VALUES(?,?,?,?,?,NULL)');$q->execute([$i['kind'],$title,$message,$i['severity'],$r['id']]);$notice=(int)$db->lastInsertId();
            $key='test:'.$run.':'.$i['kind'];
            $q=$db->prepare('INSERT INTO alert_incidents(incident_key,active_key,notification_id,kind,medicine_id,slot_id,request_id,details) VALUES(?,?,?,?,?,?,NULL,?)');$q->execute([$key,$key,$notice,$i['kind'],$r['id'],$r['slot_id'],json_encode($d)]);
        }
        $alerts->queueEmails();$alerts->queueEmails();
        $db->prepare("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('system','alert_e2e_created','Authorized isolated alert delivery test; no operational rows changed.',?)")->execute([json_encode(['test_run_id'=>$run,'administrator_id'=>$user])]);
        $db->commit();
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
    $dir=$root.'/tmp';if(!is_dir($dir))mkdir($dir,0777,true);
    file_put_contents($dir.'/alert-e2e-'.$run.'.json',json_encode(['run'=>$run,'baseline'=>$baseline,'expected'=>['medicine_name'=>$name,'slot_number'=>(int)$r['slot_number'],'available_stock'=>$quantity,'threshold'=>$threshold,'transaction_reference'=>$run]],JSON_PRETTY_PRINT));
}else $run=(string)($options['run']??'');
if(!preg_match('/^MDTEST-[A-F0-9]{10}$/D',$run))throw new RuntimeException('Provide --create or --run=MDTEST-XXXXXXXXXX.');
$report=json_decode(file_get_contents($root.'/tmp/alert-e2e-'.$run.'.json'),true,512,JSON_THROW_ON_ERROR);
$q=$db->prepare("SELECT * FROM alert_incidents WHERE JSON_UNQUOTE(JSON_EXTRACT(details,'$.test_run_id'))=? ORDER BY kind");$q->execute([$run]);$rows=$q->fetchAll();
$output=['run'=>$run,'expected_details'=>$report['expected'],'worker_last_seen'=>$db->query("SELECT setting_value FROM system_settings WHERE setting_key='alert_worker_last_seen'")->fetchColumn(),'results'=>[]];
foreach($rows as $i) {
    $d=json_decode($i['details'],true);
    if(isset($options['resume-unsent-test']) && ($d['is_test']??false)===true && $i['resolved_at']!==null) {
        // Repair only a test that was cancelled before even starting an SMTP attempt.
        $db->beginTransaction();
        try {
            $q=$db->prepare("SELECT j.id FROM alert_email_jobs j WHERE j.incident_id=? AND j.status='cancelled' AND j.attempts=0 AND NOT EXISTS(SELECT 1 FROM alert_email_attempts e WHERE e.job_id=j.id) FOR UPDATE");$q->execute([$i['id']]);$unsent=$q->fetchAll();
            if(!$unsent)throw new RuntimeException('Only a never-attempted cancelled TEST delivery can be resumed.');
            $db->prepare('UPDATE alert_incidents SET resolved_at=NULL,resolved_by=NULL,resolution_note=NULL,active_key=incident_key WHERE id=?')->execute([$i['id']]);
            foreach($unsent as $j)$db->prepare("UPDATE alert_email_jobs SET status='pending',next_attempt_at=NOW(),last_error=NULL WHERE id=? AND attempts=0")->execute([$j['id']]);
            $db->prepare("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('system','alert_e2e_unsent_resumed','Never-attempted isolated test email resumed after test-mode fix.',?)")->execute([json_encode(['incident_id'=>(int)$i['id'],'run'=>$run])]);
            $db->commit();
        }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
    }
    $q=$db->prepare('SELECT id,user_id,status,attempts,sent_at,last_error,message_id FROM alert_email_jobs WHERE incident_id=? ORDER BY id');$q->execute([$i['id']]);$jobs=$q->fetchAll();
    foreach($jobs as &$j){$q=$db->prepare('SELECT outcome,attempted_at,detail FROM alert_email_attempts WHERE job_id=? ORDER BY id');$q->execute([$j['id']]);$j['history']=$q->fetchAll();}unset($j);
    if(isset($options['reset-test-status']) && ($d['is_test']??false)===true && $i['resolved_at']!==null) {
        if(!$jobs || count(array_filter($jobs,fn($j)=>$j['status']!=='sent'))>0)throw new RuntimeException('Test status may be reopened only after delivery; email jobs are never reset.');
        $db->prepare('UPDATE alert_incidents SET resolved_at=NULL,resolved_by=NULL,resolution_note=NULL,active_key=incident_key WHERE id=?')->execute([$i['id']]);
        $db->prepare("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('system','alert_e2e_status_reopened','TEST incident status reopened for lifecycle verification; email jobs unchanged.',?)")->execute([json_encode(['incident_id'=>(int)$i['id'],'run'=>$run])]);
    }
    $notice=array_values(array_filter($alerts->notifications($user,true),fn($n)=>(int)$n['id']===(int)$i['notification_id']));
    [$subject,$html,$text]=AlertEmailTemplate::render($i);
    $detailsCorrect=$d['medicine_name']===$report['expected']['medicine_name'] && (int)$d['slot_number']===$report['expected']['slot_number'] && ($i['kind']==='low_stock'?((int)$d['available_stock']===$report['expected']['available_stock']&&(int)$d['threshold']===$report['expected']['threshold']):($d['transaction_reference']===$run && $d['issue_type']==='confirmation_timeout' && $d['confirmed_units']===0 && $d['requested_units']===1));
    if(isset($options['finish'])) {
        if(!$jobs || count(array_filter($jobs,fn($j)=>$j['status']!=='sent'))>0)throw new RuntimeException('Do not finish until every test delivery is accepted or safely reviewed.');
        $check=$db->prepare('SELECT resolved_at FROM alert_incidents WHERE id=?');$check->execute([$i['id']]);$priorResolved=$check->fetchColumn();
        $alerts->manage((int)$i['notification_id'],'read',$actor);
        $alerts->manage((int)$i['notification_id'],'acknowledge',$actor);
        $check=$db->prepare('SELECT resolved_at FROM alert_incidents WHERE id=?');$check->execute([$i['id']]);
        if($check->fetchColumn()!==$priorResolved)throw new RuntimeException('Acknowledging unexpectedly changed incident resolution.');
        if($priorResolved===null)$alerts->manage((int)$i['notification_id'],'resolve',$actor,'Isolated email and dashboard end-to-end checks complete; no physical incident.');
    }
    $q=$db->prepare('SELECT acknowledged_at,resolved_at,resolution_note FROM alert_incidents WHERE id=?');$q->execute([$i['id']]);$state=$q->fetch();
    $q=$db->prepare('SELECT COUNT(*) FROM notification_reads WHERE notification_id=? AND user_id=?');$q->execute([$i['notification_id'],$user]);$state['read']=(bool)$q->fetchColumn();
    $productionIds=array_map(fn($n)=>(int)$n['id'],$alerts->notifications($user));
    $output['results'][]=['kind'=>$i['kind'],'incident_id'=>(int)$i['id'],'notification_id'=>(int)$i['notification_id'],'visible_in_audit_listing'=>count($notice)===1,'hidden_from_production_dropdown'=>!in_array((int)$i['notification_id'],$productionIds,true),'details_correct'=>$detailsCorrect,'subject'=>$subject,'jobs'=>$jobs,'notification_status'=>$state,'finished'=>isset($options['finish'])];
}
$after=$hashes();$output['operational_tables_unchanged']=array_map(fn($table)=>['table'=>$table,'unchanged'=>$after[$table]===$report['baseline'][$table]],$critical);
echo json_encode($output,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE).PHP_EOL;
