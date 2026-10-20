<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/../src/Auth/AdminSecurity.php';
// Disposable fixture, never the configured application database.
$db=new PDO('mysql:host=127.0.0.1;port=33317;charset=utf8mb4','root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$name='medidispense_auth_test_'.bin2hex(random_bytes(5));
$db->exec(str_replace('medidispense',$name,file_get_contents(__DIR__.'/../../database/schema.sql')));
$db->exec(file_get_contents(__DIR__.'/../../database/migrations/2026_10_08_admin_security.sql'));
$checks=0;
function check(bool $ok,string $label):void { global $checks; if(!$ok)throw new RuntimeException($label); $checks++; echo "PASS $label\n"; }
function denied(callable $fn,int $status,string $text):void { try{$fn();throw new RuntimeException('Expected rejection');}catch(AdminSecurityError $e){check($e->status===$status && str_contains($e->getMessage(),$text),$text);} }
try {
    $db->exec("INSERT INTO users(employee_id,firebase_uid,email,display_name,role_id) SELECT 'ADM','uid-admin','admin@example.test','Admin',id FROM roles WHERE code='admin'");
    $db->exec("INSERT INTO users(employee_id,firebase_uid,email,display_name,role_id) SELECT 'OWN','uid-owner','owner@example.test','Owner',id FROM roles WHERE code='super_admin'");
    $service=new AdminSecurity($db);
    $admin=$db->query("SELECT u.*,r.code AS role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE email='admin@example.test'")->fetch();
    $owner=$db->query("SELECT u.*,r.code AS role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE email='owner@example.test'")->fetch();
    $fail=fn()=>null;
    for($i=1;$i<5;$i++) denied(fn()=>$service->login(' ADMIN@example.test ','wrong',$fail),401,(5-$i).' attempts remaining');
    denied(fn()=>$service->login('admin@example.test','wrong',$fail),429,'temporarily locked');
    denied(fn()=>$service->login('admin@example.test','correct',fn()=>throw new RuntimeException('Verifier must not be called during lockout')),429,'temporarily locked');
    check((int)$db->query('SELECT TIMESTAMPDIFF(SECOND,NOW(),locked_until) FROM admin_login_security')->fetchColumn()>=1798,'30 minute deadline stored');
    $session=['admin_auth'=>['uid'=>'uid-admin','last_activity'=>1000]];
    denied(function()use($service,$admin,&$session){$service->check($admin,$session,false,1001);},429,'temporarily locked');
    check(!isset($session['admin_auth']),'locked account session invalidated');
    denied(fn()=>$service->unlock($admin,(int)$admin['id']),403,'not authorized');
    denied(fn()=>$service->unlock($owner,(int)$owner['id']),403,'not authorized');
    $service->unlock($owner,(int)$admin['id']);
    check((int)$db->query('SELECT failed_attempts FROM admin_login_security')->fetchColumn()===0,'manual unlock resets counter');
    check($service->login('admin@example.test','correct',fn()=>'uid-admin')==='uid-admin','successful verified login');
    denied(fn()=>$service->login('admin@example.test','wrong',$fail),401,'4 attempts remaining');
    $service->login('admin@example.test','correct',fn()=>'uid-admin');
    check((int)$db->query('SELECT failed_attempts FROM admin_login_security')->fetchColumn()===0,'success clears previous failures');
    $db->exec('UPDATE admin_login_security SET failed_attempts=5,locked_until=DATE_SUB(NOW(),INTERVAL 1 SECOND)');
    denied(fn()=>$service->login('admin@example.test','wrong',$fail),401,'4 attempts remaining');
    check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='account_lockout_expired'")->fetchColumn()===1,'automatic expiry audited');
    denied(fn()=>$service->login('missing@example.test','wrong',$fail),401,'4 attempts remaining');
    $session=[];
    denied(function()use($service,$admin,&$session){$service->check($admin,$session);},401,'Please log in again');
    $session=['admin_auth'=>['uid'=>'uid-admin','last_activity'=>1000]];
    $service->check($admin,$session,false,1299);
    check($session['admin_auth']['last_activity']===1000,'polling does not extend session');
    denied(function()use($service,$admin,&$session){$service->check($admin,$session,true,1300);},401,'inactivity');
    check(!isset($session['admin_auth']),'expiry removes authorization');
    denied(function()use($service,$admin,&$session){$service->check($admin,$session,true,1301);},401,'Please log in again');
    $session=['admin_auth'=>['uid'=>'uid-admin','last_activity'=>1000]];
    $service->check($admin,$session,true,1200);
    check($session['admin_auth']['last_activity']===1200,'explicit activity extends live session');
    $staff=$admin; $staff['role_code']='staff'; $session=[];
    $service->check($staff,$session,false,9999); check($session===[],'staff timeout unaffected');
    check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='admin_account_unlocked'")->fetchColumn()===1,'manual unlock audited');
    $db->exec("INSERT INTO users(employee_id,firebase_uid,email,display_name,role_id) SELECT 'STF','uid-staff','staff@example.test','Staff',id FROM roles WHERE code='staff'");
    $staffId=(int)$db->lastInsertId();
    for($i=1;$i<=5;$i++) denied(fn()=>$service->login('staff@example.test','wrong',$fail),$i===5?429:401,$i===5?'temporarily locked':'attempts remaining');
    denied(fn()=>$service->unlock($admin,$staffId),403,'not authorized');
    denied(fn()=>$service->unlock($staff,$staffId),403,'not authorized');
    $service->unlock($owner,$staffId);
    check($service->login('staff@example.test','correct',fn()=>'uid-staff')==='uid-staff','Super Admin can unlock Staff');
    check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='admin_account_unlocked'")->fetchColumn()===2,'Staff unlock audited');
    echo "$checks checks passed.\n";
} finally { $db->exec('DROP DATABASE `'.$name.'`'); }
