<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../vendor/autoload.php';
require_once __DIR__.'/../src/Database.php';
require_once __DIR__.'/../src/AlertEmail.php';
$config=require __DIR__.'/../config/config.php';
$mail=new SmtpAlertTransport($config['smtp']??[]);
if(!$mail->configured()) { fwrite(STDERR,"SMTP is disabled or missing credentials. No email sent.\n");exit(1); }
$options=getopt('',['user-id:','send']);
if(empty($options['user-id'])||!array_key_exists('send',$options)) { fwrite(STDERR,"Usage: php backend/bin/test-alert-email.php --user-id=ID --send\nSends one clearly labeled TEST email to an existing verified staff account only.\n");exit(1); }
$db=Database::connect($config);
$q=$db->prepare("SELECT u.email FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.is_active=1 AND u.email_verified_at IS NOT NULL AND r.code IN ('super_admin','admin','staff')");$q->execute([(int)$options['user-id']]);$recipient=$q->fetchColumn();
if(!$recipient)throw new RuntimeException('Eligible verified staff account not found.');
$outcome='failed';
try {
    $mail->send($recipient,'[MediDispense] TEST — SMTP configuration check','<h2>MediDispense SMTP Test</h2><p>This is a configuration test, not a stock or dispensing incident. No inventory, payment, motor, or dispensing action was triggered.</p>','MediDispense SMTP configuration test. No inventory, payment or hardware action triggered.','<medidispense-test-'.bin2hex(random_bytes(12)).'@alerts.medidispense.local>');
    $outcome='smtp_accepted';echo "SMTP accepted the TEST message. Verify receipt in the recipient inbox/spam folder before considering email delivery tested.\n";
} finally {
    $db->prepare("INSERT INTO activity_logs(actor_type,action,description,metadata) VALUES('system','alert_smtp_test',?,?)")->execute(['Explicit CLI SMTP test: '.$outcome,json_encode(['recipient_user_id'=>(int)$options['user-id'],'outcome'=>$outcome])]);
}
