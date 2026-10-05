<?php
declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Http/Response.php';
require_once __DIR__ . '/../src/KioskService.php';
require_once __DIR__ . '/../src/FirebaseRealtimeDatabase.php';
require_once __DIR__ . '/../src/Auth/FirebaseTokenVerifier.php';

$config = require __DIR__ . '/../config/config.php';
session_name('medidispense_session');
session_start();
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$apiPosition = strpos($path, '/api/');
if ($apiPosition !== false) { $path = substr($path, $apiPosition); }
$path = preg_replace('#^/index\.php#', '', $path) ?: '/';
$path = rtrim($path, '/') ?: '/';
$validProfileImageUrl = static function (?string $url): bool {
    if ($url === null || preg_match('#^/manus-storage/profile-photos/[A-Za-z0-9._-]{1,180}$#', $url) === 1 || preg_match('#^https://(firebasestorage\.googleapis\.com|storage\.googleapis\.com)/#', $url) === 1) return true;
    $parts = parse_url($url);
    return is_array($parts) && in_array($parts['scheme'] ?? '', ['http','https'], true) && ($parts['host'] ?? '') === ($_SERVER['HTTP_HOST'] ?? '') && preg_match('#/manus-storage/profile-photos/[A-Za-z0-9._-]{1,180}$#', $parts['path'] ?? '') === 1;
};

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin === '' || in_array($origin, $config['cors_origins'], true)) {
    header('Access-Control-Allow-Origin: ' . ($origin ?: '*'));
    header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Hardware-Key, X-MediDispense-RBAC, X-Kiosk-Token');
if ($origin !== '' && !in_array($origin, $config['cors_origins'], true)) Response::error('Origin is not allowed.',403);
header('Cache-Control: no-store');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
if ($method === 'OPTIONS') { http_response_code(204); exit; }

try {
    $db = Database::connect($config);

    $firebase = new FirebaseRealtimeDatabase(
        (string)($config['firebase']['database_url'] ?? '')
    );

    $kiosk = new KioskService(
        $db,
        $config['machine_code'],
        $firebase
    );
    $verifier = new FirebaseTokenVerifier($config['firebase']['project_id']);
    $claims = null;
    $profile = null;

    $auth = function (array $roles = [], bool $provision = false) use (&$claims, &$profile, $verifier, $db, $config): array {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        if ($header === '' && function_exists('getallheaders')) {
            foreach (getallheaders() as $name => $value) if (strcasecmp($name, 'Authorization') === 0) { $header = (string)$value; break; }
        }
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) Response::error('Firebase ID token required.', 401);
        try { $claims = $verifier->verify(trim($matches[1])); } catch (Throwable $e) { Response::error('Invalid Firebase ID token.', 401); }
        $query = $db->prepare('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.firebase_uid = ? LIMIT 1');
        $query->execute([$claims['sub']]);
        $profile = $query->fetch();
        if (!$profile && $provision) {
            $email = (string)($claims['email'] ?? ('firebase-' . $claims['sub'] . '@local.invalid'));
            $byEmail = $db->prepare('SELECT id,is_active FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1');
            $byEmail->execute([$email]);
            $existing = $byEmail->fetch();
            if ($existing !== false && !(int)$existing['is_active']) Response::error('This employee profile is deactivated. Ask a Super Admin to activate the account.', 403);
            if ($existing !== false) {
                Response::error('This email is linked to another identity. Sign in with the original account.', 403);
            }
        }
        if (!$profile && $provision) {
            $email = (string)($claims['email'] ?? ('firebase-' . $claims['sub'] . '@local.invalid'));
            $displayName = (string)($claims['name'] ?? $email);
            $roleCode = 'staff';
            $employeeId = 'EMP-' . strtoupper(substr(hash('sha256', (string)$claims['sub']), 0, 12));
            $create = $db->prepare('INSERT INTO users (firebase_uid,employee_id,email,display_name,role_id,email_verified_at) SELECT ?,?,?,?,id,? FROM roles WHERE code=? LIMIT 1');
            $create->execute([$claims['sub'], $employeeId, $email, $displayName, !empty($claims['email_verified']) ? date('Y-m-d H:i:s') : null, $roleCode]);
            $query->execute([$claims['sub']]);
            $profile = $query->fetch();
        }
        if (!$profile) Response::error('No employee profile is linked to this Firebase account.', 403);
        if (!(int)$profile['is_active']) Response::error('This employee profile is deactivated. Ask a Super Admin to activate the account.', 403);
        if ($profile['role_code'] === 'super_admin' && empty($claims['email_verified'])) Response::error('Verify your email before using Super Admin permissions.', 403);
        if ($provision && !empty($claims['email_verified']) && strcasecmp((string)($claims['email'] ?? ''), (string)$profile['email']) === 0 && empty($profile['email_verified_at'])) {
            $db->prepare('UPDATE users SET email_verified_at=NOW() WHERE id=?')->execute([$profile['id']]);
        }
        if ($roles && !in_array($profile['role_code'], $roles, true)) Response::error('You are not authorized for this action.', 403);
        return $profile;
    };
    $hardwareAuth = function () use ($config): void {
        $received = $_SERVER['HTTP_X_HARDWARE_KEY'] ?? '';
        if (strlen((string)$config['hardware']['api_key']) < 32 || !hash_equals((string)$config['hardware']['api_key'], (string)$received)) Response::error('Invalid hardware key.', 401);
    };
    $log = function (string $action, string $description, ?int $actorId = null, string $actorType = 'system', array $metadata = []) use ($db): void {
        $stmt = $db->prepare('INSERT INTO activity_logs (actor_user_id, actor_type, action, description, ip_address, device_information, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$actorId, $actorType, $action, $description, $_SERVER['REMOTE_ADDR'] ?? null, substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255), $metadata ? json_encode($metadata) : null]);
    };
    $medicineStatus = function (int $quantity, int $minimum, string $expiry): string {
        $today = new DateTimeImmutable('today'); $expires = new DateTimeImmutable($expiry);
        if ($expires < $today) return 'expired';
        if ($expires <= $today->modify('+30 days')) return 'near_expiry';
        if ($quantity === 0) return 'out_of_stock';
        if ($quantity <= $minimum) return 'low_stock';
        return 'in_stock';
    };
    $medicineQuery = fn(bool $available=false): array => $kiosk->medicines($available);

    if ($path === '/api/health' && $method === 'GET') Response::json(['status' => 'ok', 'service' => 'MediDispense PHP API', 'time' => gmdate('c')]);

    if ($path === '/api/auth/profile' && $method === 'POST') {
        $user = $auth([], true);
        if (($_SERVER['HTTP_X_MEDIDISPENSE_RBAC'] ?? '') !== '1') {
            $previousUserId = (int)($_SESSION['medidispense_user_id'] ?? 0);
            $_SESSION['medidispense_user_id'] = (int)$user['id'];
            $_SESSION['medidispense_role'] = $user['role_code'];
            if ($previousUserId !== (int)$user['id']) { $db->prepare('UPDATE users SET last_login_at=NOW() WHERE id=?')->execute([$user['id']]); $log('user_logged_in','Employee authenticated successfully.',(int)$user['id'],'user'); }
        }
        Response::json(['profile' => $user]);
    }

    if ($path === '/api/auth/logout' && $method === 'POST') {
        $user=$auth(['super_admin','admin','staff']); $log('user_logged_out','Employee signed out.',(int)$user['id'],'user');
        $_SESSION = [];
        if (ini_get('session.use_cookies')) { $params = session_get_cookie_params(); setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], (bool)$params['secure'], (bool)$params['httponly']); }
        session_destroy();
        Response::json(['success' => true]);
    }

    if ($path === '/api/profile' && $method === 'GET') {
        $user=$auth(['super_admin','admin','staff']);
        Response::json(['id'=>(int)$user['id'],'employee_id'=>$user['employee_id'],'email'=>$user['email'],'display_name'=>$user['display_name'],'contact_number'=>$user['contact_number'],'profile_image_url'=>$user['profile_image_url'],'role_code'=>$user['role_code'],'is_active'=>(bool)$user['is_active'],'created_at'=>$user['created_at'],'last_login_at'=>$user['last_login_at']]);
    }
    if ($path === '/api/profile' && in_array($method, ['PATCH','PUT'], true)) {
        $user=$auth(['super_admin','admin','staff']); $body=requestBody(); $fields=[]; $values=[];
        if (array_key_exists('display_name',$body)) { $name=trim((string)$body['display_name']); if ($name==='' || !preg_match("/^[\\p{L}]+(?: [\\p{L}]+)*$/u", $name)) Response::error('Name contains unsupported characters.',422); $fields[]='display_name=?'; $values[]=$name; }
        if (array_key_exists('contact_number',$body)) { $contact=trim((string)$body['contact_number']); if ($contact!=='' && !preg_match('/^\\d{11}$/', $contact)) Response::error('Contact number contains unsupported characters.',422); $fields[]='contact_number=?'; $values[]=$contact ?: null; }
        if (!$fields) Response::error('No editable profile fields supplied.',422);
        $changedFields=array_values(array_intersect(['display_name','contact_number'],array_keys($body))); $values[]=$user['id']; $db->prepare('UPDATE users SET '.implode(',',$fields).' WHERE id=?')->execute($values); $log('profile_updated','Employee updated profile fields: '.implode(', ',$changedFields).'.',(int)$user['id'],'user',['fields'=>$changedFields]); Response::json(['success'=>true]);
    }
    if ($path === '/api/profile/photo' && $method === 'POST') {
        $user=$auth(['super_admin','admin','staff']); $body=requestBody();
        if (isset($body['profile_image_url'])) {
            $url=(string)$body['profile_image_url'];
            if (!$validProfileImageUrl($url)) Response::error('Invalid profile photo URL.',422);
        } else {
            $mime=(string)($body['contentType'] ?? ''); $encoded=(string)($body['dataBase64'] ?? '');
            $extensions=['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];
            if (!isset($extensions[$mime])) Response::error('Choose a JPG, PNG, or WebP image.',422);
            $image=base64_decode($encoded,true);
            if ($image===false || $image==='' || strlen($image)>2*1024*1024) Response::error('Profile photos must be no larger than 2 MB.',422);
            $imageInfo=@getimagesizefromstring($image);
            if ($imageInfo===false || ($imageInfo['mime'] ?? '')!==$mime) Response::error('The selected file is not a valid image.',422);
            $directory=__DIR__.'/manus-storage/profile-photos';
            if (!is_dir($directory) && !mkdir($directory,0755,true) && !is_dir($directory)) Response::error('Could not create profile photo storage. Check write permissions for backend/public.',500);
            $filename=bin2hex(random_bytes(18)).'.'.$extensions[$mime];
            if (file_put_contents($directory.'/'.$filename,$image,LOCK_EX)===false) Response::error('Could not save the profile photo. Check write permissions for backend/public.',500);
            $scheme=(!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS']!=='off') ? 'https' : 'http';
            $publicPath=rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php'),'/').'/manus-storage/profile-photos/'.$filename;
            $url=$scheme.'://'.($_SERVER['HTTP_HOST'] ?? 'localhost').$publicPath;
        }
        $db->prepare('UPDATE users SET profile_image_url=? WHERE id=?')->execute([$url,$user['id']]); $log('profile_photo_updated','Employee updated their profile photo.',(int)$user['id'],'user'); Response::json(['success'=>true,'profile_image_url'=>$url]);
    }
    if ($path === '/api/profile/photo' && $method === 'DELETE') {
        $user=$auth(['super_admin','admin','staff']);
        $current=$db->prepare('SELECT profile_image_url FROM users WHERE id=?'); $current->execute([$user['id']]); $oldUrl=$current->fetchColumn();
        $db->prepare('UPDATE users SET profile_image_url=NULL WHERE id=?')->execute([$user['id']]);
        if (is_string($oldUrl)) { $oldPath=parse_url($oldUrl,PHP_URL_PATH); if (is_string($oldPath) && preg_match('#/manus-storage/profile-photos/([A-Za-z0-9._-]{1,180})$#',$oldPath,$matched)) { $file=__DIR__.'/manus-storage/profile-photos/'.$matched[1]; if (is_file($file)) @unlink($file); } }
        $log('profile_photo_removed','Employee removed their profile photo.',(int)$user['id'],'user'); Response::json(['success'=>true]);
    }

    if ($path === '/api/medicines' && $method === 'GET') {
        if (($_GET['available'] ?? '0') !== '1') $auth(['super_admin','admin','staff']);
        Response::json($medicineQuery(($_GET['available'] ?? '0') === '1'));
    }
    if ($path === '/api/dashboard/summary' && $method === 'GET') {
        $auth(['super_admin','admin','staff']);
        $rows = $medicineQuery(false); $today = date('Y-m-d');
        $summary = ['totalMedicines' => count($rows), 'totalStock' => array_sum(array_column($rows, 'stockQuantity')), 'lowStock' => count(array_filter($rows, fn($r) => $r['status'] === 'low_stock')), 'outOfStock' => count(array_filter($rows, fn($r) => $r['status'] === 'out_of_stock')), 'nearExpiry' => count(array_filter($rows, fn($r) => $r['status'] === 'near_expiry')), 'expired' => count(array_filter($rows, fn($r) => $r['status'] === 'expired'))];
        $stmt = $db->prepare("SELECT COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS sales FROM transactions WHERE DATE(created_at)=? AND payment_status='successful' AND dispensing_status='dispensed'"); $stmt->execute([$today]); $sales = $stmt->fetch();
        $summary['todaysTransactions'] = (int)$sales['count']; $summary['todaysSales'] = (float)$sales['sales'];
        $summary['pendingDispensing'] = (int)$db->query("SELECT COUNT(*) FROM transactions WHERE dispensing_status IN ('pending','dispensing')")->fetchColumn();
        $summary['salesTrend']=[];
        $trend=$db->prepare("SELECT COALESCE(SUM(total_amount),0) FROM transactions WHERE DATE(created_at)=? AND payment_status='successful' AND dispensing_status='dispensed'");
        for($day=6;$day>=0;$day--){$date=date('Y-m-d',strtotime('-'.$day.' days'));$trend->execute([$date]);$summary['salesTrend'][]=['label'=>date('D',strtotime($date)),'value'=>(float)$trend->fetchColumn()];}
        $mix=[];foreach($rows as $row) $mix[$row['category']]=($mix[$row['category']]??0)+$row['stockQuantity'];
        $summary['categoryMix']=[];foreach($mix as $label=>$value)$summary['categoryMix'][]=['label'=>$label,'value'=>$value];
        Response::json($summary);
    }
    if ($path === '/api/users' && $method === 'GET') {
        $auth(['super_admin']);
        $rows = $db->query("SELECT u.id,u.employee_id,u.firebase_uid,u.email,u.display_name,u.contact_number,u.profile_image_url,u.is_active,u.archived_at,u.email_verified_at,u.last_login_at,u.created_at,u.updated_at,r.code AS role_code,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at DESC")->fetchAll();
        Response::json($rows);
    }
    if ($path === '/api/users' && $method === 'POST') {
        $actor = $auth(['super_admin']); $body = requestBody();
        foreach (['firebase_uid','email','display_name','employee_id','role_code'] as $field) if (!array_key_exists($field, $body)) Response::error("Missing field: {$field}");
        $employeeId=trim((string)$body['employee_id']); if (!preg_match('/^EMP-[A-Z0-9]{1,19}$/',$employeeId)) Response::error('Employee ID must start with EMP- and be unique.',422);
        if (!preg_match("/^[\\p{L}]+(?: [\\p{L}]+)*$/u", trim((string)$body['display_name']))) Response::error('Name contains unsupported characters.',422);
        if (!empty($body['contact_number']) && !preg_match('/^\\d{11}$/', trim((string)$body['contact_number']))) Response::error('Contact number contains unsupported characters.',422);
        if (!in_array($body['role_code'], ['super_admin','admin','staff'], true)) Response::error('Invalid employee role.', 422);
        $role = $db->prepare('SELECT id FROM roles WHERE code=?'); $role->execute([$body['role_code']]); $roleId = $role->fetchColumn();
        if (!$roleId) Response::error('Role not found.', 422);
        $imageUrl=$body['profile_image_url'] ?? null;
        if (!$validProfileImageUrl($imageUrl)) Response::error('Invalid profile photo URL.',422);
        $stmt = $db->prepare('INSERT INTO users (firebase_uid,employee_id,email,display_name,contact_number,profile_image_url,role_id,is_active,email_verified_at) VALUES (?,?,?,?,?,?,?,1,?)');
        try { $stmt->execute([$body['firebase_uid'],$employeeId,$body['email'],$body['display_name'],$body['contact_number'] ?? null,$imageUrl,$roleId,!empty($body['email_verified']) ? date('Y-m-d H:i:s') : null]); } catch (PDOException $e) { if ((string)$e->getCode()==='23000') Response::error('Employee ID or email already exists.',409); throw $e; }
        $id = (int)$db->lastInsertId(); $log('employee_created','Employee account profile created.',(int)$actor['id'],'user',['employee_id'=>$id,'role'=>$body['role_code']]); Response::json(['id'=>$id],201);
    }
    if (preg_match('#^/api/users/(\d+)$#', $path, $matches) && in_array($method, ['PATCH','PUT'], true)) {
        $actor = $auth(['super_admin']); $body = requestBody(); $userId=(int)$matches[1];
        if ($userId === (int)$actor['id'] && array_key_exists('is_active',$body) && !$body['is_active']) Response::error('You cannot deactivate your own account.',422);
        $target=$db->prepare('SELECT r.code AS role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?'); $target->execute([$userId]); $targetRole=$target->fetchColumn();
        if ($targetRole===false) Response::error('Employee account not found.',404);
        $losesLastSuperAdmin=$targetRole==='super_admin' && ((array_key_exists('is_active',$body) && !$body['is_active']) || (isset($body['role_code']) && $body['role_code']!=='super_admin'));
        if ($losesLastSuperAdmin && (int)$db->query("SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='super_admin' AND u.is_active=1")->fetchColumn() <= 1) Response::error('At least one active Super Admin account is required.',422);
        $fields=[]; $values=[];
        foreach (['display_name','contact_number'] as $field) if (array_key_exists($field,$body)) { $value=trim((string)$body[$field]); if ($field==='display_name' && !preg_match("/^[\\p{L}]+(?: [\\p{L}]+)*$/u", $value)) Response::error('Name contains unsupported characters.',422); if ($field==='contact_number' && $value!=='' && !preg_match('/^\\d{11}$/', $value)) Response::error('Contact number contains unsupported characters.',422); $fields[]="$field=?"; $values[]=$value ?: null; }
        if (array_key_exists('profile_image_url',$body)) { $url=$body['profile_image_url']; if (!$validProfileImageUrl($url)) Response::error('Invalid profile photo URL.',422); $fields[]='profile_image_url=?'; $values[]=$url; }
        if (array_key_exists('is_active',$body)) { $fields[]='is_active=?'; $values[]=$body['is_active'] ? 1 : 0; }
        if (array_key_exists('role_code',$body)) { if (!in_array($body['role_code'],['super_admin','admin','staff'],true)) Response::error('Invalid employee role.',422); $role=$db->prepare('SELECT id FROM roles WHERE code=?'); $role->execute([$body['role_code']]); $fields[]='role_id=?'; $values[]=$role->fetchColumn(); }
        if (!$fields) Response::error('No editable fields supplied.',422); $changedFields=array_keys(array_intersect(['display_name','contact_number','profile_image_url','is_active','role_code'],array_keys($body))); $values[]=$userId; $db->prepare('UPDATE users SET '.implode(',',$fields).' WHERE id=?')->execute($values); $log('employee_updated','Updated employee #'.$userId.' fields: '.implode(', ',$changedFields).'.',(int)$actor['id'],'user',['employee_id'=>$userId,'fields'=>$changedFields,'role_code'=>$body['role_code']??null,'is_active'=>$body['is_active']??null]); Response::json(['success'=>true]);
    }
    if (preg_match('#^/api/users/(\d+)$#', $path, $matches) && $method === 'DELETE') {
        $actor=$auth(['super_admin']); $userId=(int)$matches[1];
        if ($userId === (int)$actor['id']) Response::error('You cannot archive your own account.',422);
        $target=$db->prepare('SELECT r.code AS role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?'); $target->execute([$userId]); $targetRole=$target->fetchColumn();
        if ($targetRole===false) Response::error('Employee account not found.',404);
        if ($targetRole==='super_admin' && (int)$db->query("SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='super_admin' AND u.is_active=1")->fetchColumn() <= 1) Response::error('At least one active Super Admin account is required.',422);
        $db->prepare('UPDATE users SET is_active=0, archived_at=COALESCE(archived_at,NOW()) WHERE id=?')->execute([$userId]); $log('employee_archived','Employee account archived.',(int)$actor['id'],'user',['employee_id'=>$userId]); Response::json(['success'=>true]);
    }
    if ($path === '/api/settings' && $method === 'GET') { $auth(['super_admin']); Response::json($db->query('SELECT setting_key,setting_value,updated_by,updated_at FROM system_settings ORDER BY setting_key')->fetchAll()); }
    if ($path === '/api/settings' && in_array($method, ['POST','PATCH','PUT'], true)) {
        $actor = $auth(['super_admin']); $body=requestBody(); if (!isset($body['setting_key'],$body['setting_value'])) Response::error('setting_key and setting_value are required.');
        $db->prepare('INSERT INTO system_settings (setting_key,setting_value,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)')->execute([$body['setting_key'],(string)$body['setting_value'],$actor['id']]); $log('system_setting_updated','System setting updated.',(int)$actor['id'],'user',['setting_key'=>$body['setting_key']]); Response::json(['success'=>true]);
    }
    if (preg_match('#^/api/medicines/(\d+)$#', $path, $matches) && in_array($method, ['PATCH','PUT','DELETE'], true)) {
        $actor = $auth(['super_admin','admin']); $medicineId=(int)$matches[1];
        if ($method === 'DELETE') { $db->prepare('UPDATE medicines SET is_enabled=0 WHERE id=?')->execute([$medicineId]); $log('medicine_archived','Medicine archived from vending catalog.',(int)$actor['id'],'user',['medicine_id'=>$medicineId]); Response::json(['success'=>true]); }
        $body=requestBody(); if(array_key_exists('unit_price',$body) && (!is_numeric($body['unit_price']) || (float)$body['unit_price']<0)) throw new KioskError('INVALID_PRICE','Price must be non-negative.',422); $allowed=['name'=>'name','generic_name'=>'generic_name','description'=>'description','dosage_information'=>'dosage_information','usage_instructions'=>'usage_instructions','unit_price'=>'unit_price','expiry_date'=>'expiry_date','minimum_stock_level'=>'minimum_stock_level','is_enabled'=>'is_enabled','image_url'=>'image_url']; $fields=[];$values=[]; foreach($allowed as $key=>$column) if(array_key_exists($key,$body)){ $fields[]="$column=?";$values[]=$body[$key]; } if(!$fields) Response::error('No editable medicine fields supplied.',422); $lookup=$db->prepare('SELECT name FROM medicines WHERE id=?'); $lookup->execute([$medicineId]); $medicineName=$lookup->fetchColumn(); if($medicineName===false) Response::error('Medicine record not found.',404); $changedFields=array_keys(array_intersect_key($body,$allowed)); $values[]=$medicineId; $db->prepare('UPDATE medicines SET '.implode(',',$fields).' WHERE id=?')->execute($values); $log('medicine_updated',$medicineName.' updated: '.implode(', ',$changedFields).'.',(int)$actor['id'],'user',['medicine_id'=>$medicineId,'medicine_name'=>$medicineName,'fields'=>$changedFields]); Response::json(['success'=>true]);
    }

    if ($path === '/api/medicines' && $method === 'POST') {
        $actor = $auth(['super_admin','admin']); $body = requestBody();
        if (!isset($body['category_id']) && isset($body['category_name'])) {
            $category=$db->prepare('SELECT id FROM medicine_categories WHERE name=? AND is_active=1');
            $category->execute([$body['category_name']]); $body['category_id']=$category->fetchColumn();
            if (!$body['category_id']) throw new KioskError('INVALID_CATEGORY','Choose an existing active category.',422);
        }
        if (!isset($body['unit_price'],$body['stock_quantity']) || !is_numeric($body['unit_price']) || (float)$body['unit_price']<0 || !is_int($body['stock_quantity']) || $body['stock_quantity']<0) throw new KioskError('INVALID_MEDICINE','Price and stock must be non-negative.',422);
        foreach (['name','generic_name','category_id','description','dosage_information','usage_instructions','unit_price','expiry_date','minimum_stock_level','stock_quantity'] as $field) if (!array_key_exists($field, $body)) Response::error("Missing field: {$field}");
        $db->beginTransaction();
        $stmt = $db->prepare('INSERT INTO medicines (category_id,name,generic_name,description,dosage_information,usage_instructions,image_url,unit_price,expiry_date,minimum_stock_level,is_enabled,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([(int)$body['category_id'], $body['name'], $body['generic_name'], $body['description'], $body['dosage_information'], $body['usage_instructions'], $body['image_url'] ?? null, $body['unit_price'], $body['expiry_date'], $body['minimum_stock_level'], (int)($body['is_enabled'] ?? 1), $actor['id']]);
        $medicineId = (int)$db->lastInsertId(); $stock = $db->prepare('INSERT INTO inventory (medicine_id,quantity,last_counted_at) VALUES (?,?,NOW())'); $stock->execute([$medicineId, $body['stock_quantity']]); if (isset($body['slot_number'])) {
            $slot=$db->prepare('SELECT s.* FROM machine_slots s JOIN machines m ON m.id=s.machine_id WHERE s.slot_number=? AND m.machine_code=? FOR UPDATE');$slot->execute([(int)$body['slot_number'],$config['machine_code']]);$assigned=$slot->fetch();
            if(!$assigned || $assigned['medicine_id']!==null) throw new KioskError('SLOT_UNAVAILABLE','This slot is missing or already assigned.');
            $db->prepare("UPDATE machine_slots SET medicine_id=?,slot_status='ready' WHERE id=?")->execute([$medicineId,$assigned['id']]);
        }
        $db->commit(); $log('medicine_created', 'Added '.$body['name'].' to the catalog with initial stock of '.(int)$body['stock_quantity'].'.', (int)$actor['id'], 'user', ['medicine_id' => $medicineId, 'medicine_name' => $body['name'], 'initial_stock' => (int)$body['stock_quantity']]); Response::json(['id' => $medicineId], 201);
    }

    if ($path === '/api/inventory/adjust' && $method === 'PATCH') {
        $actor = $auth(['super_admin','admin']); $body = requestBody(); $medicineId = (int)($body['medicine_id'] ?? 0); $delta = (int)($body['delta'] ?? 0); if ($medicineId < 1 || $delta === 0) Response::error('medicine_id and a non-zero delta are required.');
        $db->beginTransaction(); $stmt = $db->prepare('SELECT i.quantity,i.reserved_quantity,m.name FROM inventory i JOIN medicines m ON m.id=i.medicine_id WHERE i.medicine_id=? FOR UPDATE'); $stmt->execute([$medicineId]); $stock = $stmt->fetch(); if (!$stock) Response::error('Inventory record not found.', 404); $previous = (int)$stock['quantity']; $new = $previous + $delta; if ($new < (int)$stock['reserved_quantity']) throw new KioskError('STOCK_RESERVED','Stock cannot be reduced below quantities reserved for active purchases.'); $reason = trim((string)($body['reason'] ?? 'Manual adjustment')); $db->prepare('UPDATE inventory SET quantity=?,last_counted_at=NOW() WHERE medicine_id=?')->execute([$new, $medicineId]); $db->prepare("INSERT INTO stock_movements (medicine_id,previous_quantity,new_quantity,change_quantity,change_type,reason,actor_user_id) VALUES (?,?,?,?,?,?,?)")->execute([$medicineId,$previous,$new,$delta,$delta > 0 ? 'manual_addition' : 'adjustment',$reason,$actor['id']]); $db->commit(); $changeVerb = $new >= $previous ? 'increased' : 'decreased'; $log('stock_adjusted', $stock['name'].' stock '.$changeVerb.' from '.$previous.' to '.$new.'. Reason: '.$reason, (int)$actor['id'], 'user', ['medicine_id'=>$medicineId,'medicine_name'=>$stock['name'],'change'=>$delta,'previous'=>$previous,'new'=>$new,'reason'=>$reason]); Response::json(['medicine_id'=>$medicineId,'previous_quantity'=>$previous,'new_quantity'=>$new]);
    }

    $kioskToken = $_SERVER['HTTP_X_KIOSK_TOKEN'] ?? '';
    if ($path === '/api/transactions/checkout' && $method === 'POST') Response::json($kiosk->checkout(requestBody(), $kioskToken),201);
    if ($path === '/api/transactions/recover' && $method === 'GET') Response::json($kiosk->recover((string)($_GET['request_id'] ?? ''),$kioskToken));
    if (preg_match('#^/api/transactions/(\d+)$#',$path,$matches) && $method === 'GET') Response::json($kiosk->get((int)$matches[1],$kioskToken));
    if (preg_match('#^/api/transactions/(\d+)/cancel$#',$path,$matches) && $method === 'POST') Response::json($kiosk->cancel((int)$matches[1],$kioskToken));
    if ($path === '/api/payments/verify' && $method === 'POST') {
        $hardwareAuth(); $body=requestBody();
        Response::json($kiosk->coin((int)($body['transaction_id'] ?? 0),(string)($body['event_id'] ?? ''),$body['coin_amount'] ?? null));
    }
    if (preg_match('#^/api/dispense/(\d+)$#',$path,$matches) && $method === 'POST') { $hardwareAuth(); Response::json($kiosk->sent((int)$matches[1])); }
    if (preg_match('#^/api/dispense/(\d+)/sensor$#',$path,$matches) && $method === 'POST') {
        $hardwareAuth(); $body=requestBody();
        if(!isset($body['unit_number'],$body['success']) || !is_int($body['unit_number']) || !is_bool($body['success'])) throw new KioskError('INVALID_SENSOR_EVENT','A unit number and boolean result are required.',422);
        Response::json($kiosk->sensor((int)$matches[1],$body['unit_number'],$body['success']));
    }

    if ($path === '/api/machine/heartbeat' && $method === 'POST') { $hardwareAuth(); $body=requestBody(); $machineId=(int)($body['machine_id'] ?? 1); $stmt=$db->prepare("UPDATE machine_status SET connection_status='online',esp32_status=?,motor_status=?,sensor_status=?,coin_acceptor_status=?,last_communication_at=NOW(),last_payload=? WHERE machine_id=?"); $stmt->execute([$body['esp32_status']??'Ready',$body['motor_status']??'Idle',$body['sensor_status']??'Monitoring',$body['coin_acceptor_status']??'Ready',json_encode($body),$machineId]); Response::json(['machine_id'=>$machineId,'online'=>true,'last_communication_at'=>gmdate('c')]); }
    if ($path === '/api/machine/status' && $method === 'GET') { $auth(['super_admin','admin','staff']); $machine=$db->query('SELECT m.*,ms.* FROM machines m LEFT JOIN machine_status ms ON ms.machine_id=m.id ORDER BY m.id LIMIT 1')->fetch(); $slots=$db->query('SELECT s.*,m.name AS medicine_name,COALESCE(i.quantity,0) AS quantity FROM machine_slots s LEFT JOIN medicines m ON m.id=s.medicine_id LEFT JOIN inventory i ON i.medicine_id=s.medicine_id ORDER BY s.slot_number')->fetchAll(); Response::json(['machine'=>$machine,'slots'=>$slots]); }
    if ($path === '/api/transactions' && $method === 'GET') { $actor=$auth(['super_admin','admin','staff']); $log('transactions_viewed','Employee viewed transaction records.',(int)$actor['id'],'user'); $rows=$db->query('SELECT t.*,GROUP_CONCAT(ti.medicine_name_snapshot SEPARATOR ", ") AS medicines FROM transactions t LEFT JOIN transaction_items ti ON ti.transaction_id=t.id GROUP BY t.id ORDER BY t.created_at DESC LIMIT 250')->fetchAll(); if(($_GET['format']??'')==='client') $rows=array_map(fn($row)=>$kiosk->snapshot((int)$row['id']),$rows); Response::json($rows); }
    if ($path === '/api/notifications' && $method === 'GET') { $auth(['super_admin','admin','staff']); Response::json($db->query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100')->fetchAll()); }
    if ($path === '/api/logs' && $method === 'GET') { $auth(['super_admin']); Response::json($db->query('SELECT al.*,u.display_name,u.email FROM activity_logs al LEFT JOIN users u ON u.id=al.actor_user_id ORDER BY al.created_at DESC LIMIT 500')->fetchAll()); }
    if ($path === '/api/reports/basic' && $method === 'GET') {
        $actor=$auth(['super_admin','admin','staff']); $rows=$medicineQuery(false); $today=date('Y-m-d');
        $daily=$db->prepare('SELECT t.id,t.transaction_code,t.total_amount,t.payment_status,t.dispensing_status,t.created_at,GROUP_CONCAT(ti.medicine_name_snapshot SEPARATOR ", ") AS medicines FROM transactions t LEFT JOIN transaction_items ti ON ti.transaction_id=t.id WHERE DATE(t.created_at)=? GROUP BY t.id ORDER BY t.created_at DESC LIMIT 100'); $daily->execute([$today]);
        $log('basic_operations_report_viewed','Employee viewed the basic operations report.',(int)$actor['id'],'user');
        Response::json(['date'=>$today,'inventory'=>['medicine_count'=>count($rows),'unit_count'=>array_sum(array_column($rows,'stockQuantity'))],'low_stock'=>array_values(array_filter($rows,fn($row)=>$row['status']==='low_stock')),'out_of_stock'=>array_values(array_filter($rows,fn($row)=>$row['status']==='out_of_stock')),'daily_transactions'=>$daily->fetchAll()]);
    }
    if ($path === '/api/reports/inventory.csv' && $method === 'GET') { $auth(['super_admin','admin']); $rows=$medicineQuery(false); $stream=fopen('php://temp','r+'); fputcsv($stream,['Medicine','Category','Quantity','Price','Expiry','Status','Slot']); foreach($rows as $row) fputcsv($stream,[$row['name'],$row['category'],$row['stockQuantity'],number_format($row['price'],2),$row['expiryDate'],$row['status'],$row['slotNumber'] ?? 'Unassigned']); rewind($stream); Response::csv('medidispense-inventory-report.csv',stream_get_contents($stream)); }

    Response::error('Route not found.', 404);
} catch (KioskError $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    Response::error($e->getMessage(), $e->httpStatus, ['code'=>$e->errorCode]);
} catch (Throwable $e) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) $db->rollBack();
    error_log($e->getMessage());
    Response::error('The service is temporarily unavailable. Please contact assistance.', 500, ['code'=>'SERVICE_UNAVAILABLE']);
}
