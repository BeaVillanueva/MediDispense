<?php
declare(strict_types=1);
if (PHP_SAPI!=='cli') exit;
require __DIR__.'/../vendor/autoload.php';
require_once __DIR__.'/../src/Database.php';
require_once __DIR__.'/../src/AlertService.php';
require_once __DIR__.'/../src/AlertEmail.php';
$config=require __DIR__.'/../config/config.php';
$watch=in_array('--watch',$argv,true);
$status=in_array('--status',$argv,true);
$relay=new AppsScriptAlertTransport((string)($config['alert_mail_relay']['url']??''),(string)($config['alert_mail_relay']['secret']??''));
$transport=$relay->configured() ? $relay : new SmtpAlertTransport($config['smtp']??[]);
if(!$status) fwrite(STDERR,'Alert email transport: '.($relay->configured()?'Google Apps Script relay (HTTPS)':'SMTP')."\n");
$reportedDisabled=false;
$db=null;$alerts=null;
do {
    try {
        // Login can happen before XAMPP/MySQL starts. Retry bootstrap in watch mode
        // instead of exiting and exhausting Task Scheduler's five restart attempts.
        if (!$db) {
            $db=Database::connect($config);
            $alerts=new AlertService($db,(int)($config['alerts']['timeout_seconds']??120));
            if (!$alerts->installed()) throw new RuntimeException('Apply the alert delivery migration first.');
            if ($status) {
                echo json_encode(['smtp_configured'=>$transport->configured(),'worker_last_seen'=>$db->query("SELECT setting_value FROM system_settings WHERE setting_key='alert_worker_last_seen'")->fetchColumn(),'queue'=>$db->query('SELECT status,COUNT(*) count FROM alert_email_jobs GROUP BY status')->fetchAll(),'recipients'=>$alerts->recipients()],JSON_PRETTY_PRINT).PHP_EOL;
                exit;
            }
            if ($watch && !(int)$db->query("SELECT GET_LOCK('medidispense_alert_daemon',0)")->fetchColumn()) {
                // During a rolling redeploy the previous instance still holds the lease.
                // Wait for it instead of exiting, so the host does not crash-loop this service.
                // Only the lease holder ever scans or sends, so this stays single-sender.
                fwrite(STDERR,"Another alert daemon owns the worker lease. Waiting for it to be released; nothing is sent meanwhile.\n");
                while (!(int)$db->query("SELECT GET_LOCK('medidispense_alert_daemon',30)")->fetchColumn()) {}
                fwrite(STDERR,"Alert worker lease acquired.\n");
            }
        }
        $alerts->scan();
        if($transport->configured()) (new AlertEmailWorker($db,$transport))->run();
        elseif(!$reportedDisabled) { fwrite(STDERR,"SMTP disabled or incomplete. Incidents and email queue retained; no email sent.\n"); $reportedDisabled=true; }
        $db->prepare("INSERT INTO system_settings(setting_key,setting_value) VALUES('alert_worker_last_seen',NOW()) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)")->execute();
    } catch(Throwable $e) {
        fwrite(STDERR,"Alert worker unavailable; queued alerts retained. ".get_class($e)." (code ".$e->getCode().").\n");
        // Release stale PDO references and re-acquire the singleton lease on reconnect.
        $alerts=null;$db=null;Database::resetConnection();unset($e);
        if(!$watch || $status) exit(1);
    }
    if($watch) sleep(5);
} while($watch);
