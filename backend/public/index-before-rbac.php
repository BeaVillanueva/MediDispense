<?php
declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Http/Response.php';
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

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin === '' || in_array($origin, $config['cors_origins'], true)) {
    header('Access-Control-Allow-Origin: ' . ($origin ?: '*'));
    header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Hardware-Key');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
if ($method === 'OPTIONS') { http_response_code(204); exit; }

try {
    $db = Database::connect($config);
    $verifier = new FirebaseTokenVerifier($config['firebase']['project_id']);
    $claims = null;
    $profile = null;

    $auth = function (array $roles = [], bool $provision = false) use (&$claims, &$profile, $verifier, $db): array {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) Response::error('Firebase ID token required.', 401);
        try { $claims = $verifier->verify(trim($matches[1])); } catch (Throwable $e) { Response::error('Invalid Firebase ID token.', 401); }
        $query = $db->prepare('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.firebase_uid = ? LIMIT 1');
        $query->execute([$claims['sub']]);
        $profile = $query->fetch();
        if (!$profile && $provision) {
            $email = (string)($claims['email'] ?? ('firebase-' . $claims['sub'] . '@local.invalid'));
            $displayName = (string)($claims['name'] ?? $email);
            $create = $db->prepare("INSERT INTO users (firebase_uid,email,display_name,role_id,email_verified_at) SELECT ?,?,?,id,? FROM roles WHERE code='staff' LIMIT 1");
            $create->execute([$claims['sub'], $email, $displayName, !empty($claims['email_verified']) ? date('Y-m-d H:i:s') : null]);
            $query->execute([$claims['sub']]);
            $profile = $query->fetch();
        }
        if (!$profile || !$profile['is_active']) Response::error('User profile is not active.', 403);
        if ($roles && !in_array($profile['role_code'], $roles, true)) Response::error('You are not authorized for this action.', 403);
        return $profile;
    };
    $hardwareAuth = function () use ($config): void {
        $received = $_SERVER['HTTP_X_HARDWARE_KEY'] ?? '';
        if (!hash_equals((string)$config['hardware']['api_key'], (string)$received)) Response::error('Invalid hardware key.', 401);
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
    $medicineQuery = function (bool $available = false) use ($db, $medicineStatus): array {
        $stmt = $db->query('SELECT m.*, c.name AS category_name, COALESCE(i.quantity,0) AS stock_quantity, s.slot_number, s.id AS slot_id FROM medicines m JOIN medicine_categories c ON c.id = m.category_id LEFT JOIN inventory i ON i.medicine_id = m.id LEFT JOIN machine_slots s ON s.medicine_id = m.id ORDER BY m.name');
        $rows = [];
        foreach ($stmt->fetchAll() as $row) {
            $status = $medicineStatus((int)$row['stock_quantity'], (int)$row['minimum_stock_level'], $row['expiry_date']);
            if ($available && (!$row['is_enabled'] || $row['slot_number'] === null || (int)$row['stock_quantity'] <= 0 || $status === 'expired')) continue;
            $rows[] = ['id' => (int)$row['id'], 'name' => $row['name'], 'genericName' => $row['generic_name'], 'category' => $row['category_name'], 'description' => $row['description'], 'dosage' => $row['dosage_information'], 'instructions' => $row['usage_instructions'], 'stockQuantity' => (int)$row['stock_quantity'], 'minimumStockLevel' => (int)$row['minimum_stock_level'], 'price' => (float)$row['unit_price'], 'expiryDate' => $row['expiry_date'], 'imageUrl' => $row['image_url'], 'slotNumber' => $row['slot_number'] ? (int)$row['slot_number'] : null, 'status' => $status, 'enabled' => (bool)$row['is_enabled'], 'dateAdded' => $row['created_at'], 'updatedAt' => $row['updated_at']];
        }
        return $rows;
    };

    if ($path === '/api/health' && $method === 'GET') Response::json(['status' => 'ok', 'service' => 'MediDispense PHP API', 'time' => gmdate('c')]);

    if ($path === '/api/auth/profile' && $method === 'POST') {
        $user = $auth([], true);
        $_SESSION['medidispense_user_id'] = (int)$user['id'];
        $_SESSION['medidispense_role'] = $user['role_code'];
        Response::json(['profile' => $user]);
    }

    if ($path === '/api/auth/logout' && $method === 'POST') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) { $params = session_get_cookie_params(); setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], (bool)$params['secure'], (bool)$params['httponly']); }
        session_destroy();
        Response::json(['success' => true]);
    }

    if ($path === '/api/medicines' && $method === 'GET') Response::json($medicineQuery(($_GET['available'] ?? '0') === '1'));
    if ($path === '/api/dashboard/summary' && $method === 'GET') {
        $auth(['super_admin','admin','staff']);
        $rows = $medicineQuery(false); $today = date('Y-m-d');
        $summary = ['totalMedicines' => count($rows), 'totalStock' => array_sum(array_column($rows, 'stockQuantity')), 'lowStock' => count(array_filter($rows, fn($r) => $r['status'] === 'low_stock')), 'outOfStock' => count(array_filter($rows, fn($r) => $r['status'] === 'out_of_stock')), 'nearExpiry' => count(array_filter($rows, fn($r) => $r['status'] === 'near_expiry')), 'expired' => count(array_filter($rows, fn($r) => $r['status'] === 'expired'))];
        $stmt = $db->prepare("SELECT COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS sales FROM transactions WHERE DATE(created_at)=? AND payment_status='successful' AND dispensing_status='dispensed'"); $stmt->execute([$today]); $sales = $stmt->fetch();
        $summary['todaysTransactions'] = (int)$sales['count']; $summary['todaysSales'] = (float)$sales['sales'];
        $summary['pendingDispensing'] = (int)$db->query("SELECT COUNT(*) FROM transactions WHERE dispensing_status IN ('pending','dispensing')")->fetchColumn();
        $summary['salesTrend'] = [['label'=>'Mon','value'=>820],['label'=>'Tue','value'=>1040],['label'=>'Wed','value'=>760],['label'=>'Thu','value'=>1320],['label'=>'Fri','value'=>1180],['label'=>'Sat','value'=>1640],['label'=>'Sun','value'=>980]];
        Response::json($summary);
    }
    if ($path === '/api/medicines' && $method === 'POST') {
        $actor = $auth(['super_admin','admin']); $body = requestBody();
        foreach (['name','generic_name','category_id','description','dosage_information','usage_instructions','unit_price','expiry_date','minimum_stock_level','stock_quantity'] as $field) if (!array_key_exists($field, $body)) Response::error("Missing field: {$field}");
        $db->beginTransaction();
        $stmt = $db->prepare('INSERT INTO medicines (category_id,name,generic_name,description,dosage_information,usage_instructions,image_url,unit_price,expiry_date,minimum_stock_level,is_enabled,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([(int)$body['category_id'], $body['name'], $body['generic_name'], $body['description'], $body['dosage_information'], $body['usage_instructions'], $body['image_url'] ?? null, $body['unit_price'], $body['expiry_date'], $body['minimum_stock_level'], (int)($body['is_enabled'] ?? 1), $actor['id']]);
        $medicineId = (int)$db->lastInsertId(); $stock = $db->prepare('INSERT INTO inventory (medicine_id,quantity,last_counted_at) VALUES (?,?,NOW())'); $stock->execute([$medicineId, $body['stock_quantity']]); $db->commit(); $log('medicine_created', 'Medicine added to catalog.', (int)$actor['id'], 'user', ['medicine_id' => $medicineId]); Response::json(['id' => $medicineId], 201);
    }

    if ($path === '/api/inventory/adjust' && $method === 'PATCH') {
        $actor = $auth(['super_admin','admin']); $body = requestBody(); $medicineId = (int)($body['medicine_id'] ?? 0); $delta = (int)($body['delta'] ?? 0); if ($medicineId < 1 || $delta === 0) Response::error('medicine_id and a non-zero delta are required.');
        $db->beginTransaction(); $stmt = $db->prepare('SELECT quantity FROM inventory WHERE medicine_id=? FOR UPDATE'); $stmt->execute([$medicineId]); $previous = $stmt->fetchColumn(); if ($previous === false) Response::error('Inventory record not found.', 404); $new = max(0, (int)$previous + $delta); $db->prepare('UPDATE inventory SET quantity=?,last_counted_at=NOW() WHERE medicine_id=?')->execute([$new, $medicineId]); $db->prepare("INSERT INTO stock_movements (medicine_id,previous_quantity,new_quantity,change_quantity,change_type,reason,actor_user_id) VALUES (?,?,?,?,?,?,?)")->execute([$medicineId,$previous,$new,$delta,$delta > 0 ? 'manual_addition' : 'adjustment',$body['reason'] ?? 'Manual adjustment',$actor['id']]); $db->commit(); $log('stock_adjusted', 'Inventory adjusted.', (int)$actor['id'], 'user', ['medicine_id'=>$medicineId,'previous'=>$previous,'new'=>$new]); Response::json(['medicine_id'=>$medicineId,'previous_quantity'=>(int)$previous,'new_quantity'=>$new]);
    }

    if ($path === '/api/transactions/checkout' && $method === 'POST') {
        $body = requestBody(); $items = $body['items'] ?? []; if (!is_array($items) || count($items) < 1) Response::error('At least one item is required.');
        $db->beginTransaction(); $subtotal = 0; $resolved = [];
        foreach ($items as $item) { $stmt = $db->prepare('SELECT m.id,m.name,m.unit_price,m.is_enabled,m.expiry_date,COALESCE(i.quantity,0) AS quantity,s.id AS slot_id,s.slot_number FROM medicines m LEFT JOIN inventory i ON i.medicine_id=m.id LEFT JOIN machine_slots s ON s.medicine_id=m.id WHERE m.id=? FOR UPDATE'); $stmt->execute([(int)$item['medicine_id']]); $medicine = $stmt->fetch(); $qty = (int)($item['quantity'] ?? 1); if (!$medicine || !$medicine['is_enabled'] || $qty < 1 || (int)$medicine['quantity'] < $qty || $medicine['expiry_date'] < date('Y-m-d')) { $db->rollBack(); Response::error(($medicine['name'] ?? 'Medicine') . ' is no longer available.', 409); } $line = (float)$medicine['unit_price'] * $qty; $subtotal += $line; $resolved[] = [$medicine,$qty,$line]; }
        $code = 'TXN-' . strtoupper(bin2hex(random_bytes(3))); $stmt = $db->prepare("INSERT INTO transactions (transaction_code,currency,subtotal,total_amount,payment_status,dispensing_status) VALUES (?, 'PHP', ?, ?, 'pending', 'pending')"); $stmt->execute([$code,$subtotal,$subtotal]); $transactionId = (int)$db->lastInsertId();
        foreach ($resolved as [$medicine,$qty,$line]) { $db->prepare('INSERT INTO transaction_items (transaction_id,medicine_id,slot_id,medicine_name_snapshot,unit_price_snapshot,quantity,subtotal) VALUES (?,?,?,?,?,?,?)')->execute([$transactionId,$medicine['id'],$medicine['slot_id'],$medicine['name'],$medicine['unit_price'],$qty,$line]); }
        $db->prepare("INSERT INTO payments (transaction_id,amount_due,status) VALUES (?,?,'pending')")->execute([$transactionId,$subtotal]); $db->commit(); Response::json(['transaction_id'=>$transactionId,'transaction_code'=>$code,'total'=>$subtotal,'payment_status'=>'pending','dispensing_status'=>'pending'], 201);
    }

    if ($path === '/api/payments/verify' && $method === 'POST') {
        $body = requestBody(); $transactionId = (int)($body['transaction_id'] ?? 0); $amount = (float)($body['amount_inserted'] ?? 0); if ($transactionId < 1) Response::error('transaction_id is required.');
        $db->beginTransaction(); $stmt = $db->prepare('SELECT * FROM transactions WHERE id=? FOR UPDATE'); $stmt->execute([$transactionId]); $transaction = $stmt->fetch(); if (!$transaction) Response::error('Transaction not found.',404); if ($amount < (float)$transaction['total_amount']) Response::error('Payment is insufficient.',409);
        $db->prepare("UPDATE payments SET amount_inserted=?,status='successful',verified_at=NOW() WHERE transaction_id=?")->execute([$amount,$transactionId]); $db->prepare("UPDATE transactions SET amount_paid=?,change_amount=?,payment_status='successful',dispensing_status='pending' WHERE id=?")->execute([$amount,$amount-(float)$transaction['total_amount'],$transactionId]); $items = $db->prepare('SELECT ti.*,s.machine_id,s.id AS slot_id,s.slot_number FROM transaction_items ti LEFT JOIN machine_slots s ON s.id=ti.slot_id WHERE ti.transaction_id=?'); $items->execute([$transactionId]); $first = $items->fetch(); if (!$first || !$first['machine_id'] || !$first['slot_id']) Response::error('No configured machine slot is assigned.',409); $command = 'DISP-' . strtoupper(bin2hex(random_bytes(4))); $payload = json_encode(['transaction_id'=>$transactionId,'slot_number'=>(int)$first['slot_number'],'motor_id'=>'MOTOR-'.$first['slot_number'],'quantity'=>(int)$first['quantity']]); $db->prepare("INSERT INTO dispensing_requests (transaction_id,machine_id,slot_id,quantity,request_status,command_reference,command_payload) VALUES (?,?,?,?,'queued',?,?)")->execute([$transactionId,$first['machine_id'],$first['slot_id'],$first['quantity'],$command,$payload]); $requestId=(int)$db->lastInsertId(); $db->prepare("UPDATE transactions SET dispensing_status='dispensing' WHERE id=?")->execute([$transactionId]); $db->commit(); Response::json(['transaction_id'=>$transactionId,'dispensing_request_id'=>$requestId,'command_reference'=>$command,'payment_status'=>'successful','amount_paid'=>$amount,'change'=>$amount-(float)$transaction['total_amount']]);
    }

    if (preg_match('#^/api/dispense/(\d+)$#', $path, $matches) && $method === 'POST') {
        $body = requestBody(); $hardware = $_SERVER['HTTP_X_HARDWARE_KEY'] ?? ''; if ($hardware === '') $auth(['super_admin','admin','staff']); else $hardwareAuth(); $requestId=(int)$matches[1]; $db->prepare("UPDATE dispensing_requests SET request_status='sent',sent_at=NOW() WHERE id=? AND request_status IN ('queued','sent')")->execute([$requestId]); $log('dispense_command_sent','Dispense command sent to ESP32.',null,$hardware !== '' ? 'hardware' : 'user',['request_id'=>$requestId]); Response::json(['dispensing_request_id'=>$requestId,'status'=>'sent']);
    }
    if (preg_match('#^/api/dispense/(\d+)/sensor$#', $path, $matches) && $method === 'POST') {
        $body = requestBody(); $hardwareAuth(); $requestId=(int)$matches[1]; $success=(bool)($body['success'] ?? false); $db->beginTransaction(); $stmt=$db->prepare('SELECT dr.*,t.transaction_code,ti.medicine_id,ti.quantity,ti.slot_id FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id JOIN transaction_items ti ON ti.transaction_id=t.id WHERE dr.id=? FOR UPDATE'); $stmt->execute([$requestId]); $request=$stmt->fetch(); if (!$request) Response::error('Dispensing request not found.',404); $event=$success?'dispensed_successfully':'dispensing_failed'; $db->prepare("INSERT INTO dispensing_logs (dispensing_request_id,event_type,sensor_confirmed,motor_status,sensor_payload) VALUES (?,?,?,?,?)")->execute([$requestId,$event,$success?1:0,$body['motor_status']??null,json_encode($body)]);
        if ($success) { $stock=$db->prepare('SELECT quantity FROM inventory WHERE medicine_id=? FOR UPDATE'); $stock->execute([$request['medicine_id']]); $previous=(int)$stock->fetchColumn(); $new=max(0,$previous-(int)$request['quantity']); if ($previous < (int)$request['quantity']) { $db->rollBack(); Response::error('Inventory changed before sensor confirmation.',409); } $db->prepare('UPDATE inventory SET quantity=?,last_counted_at=NOW() WHERE medicine_id=?')->execute([$new,$request['medicine_id']]); $db->prepare("INSERT INTO stock_movements (medicine_id,transaction_id,dispensing_request_id,previous_quantity,new_quantity,change_quantity,change_type,reason) VALUES (?,?,?,?,?,?,?,?)")->execute([$request['medicine_id'],$request['transaction_id'],$requestId,$previous,$new,-(int)$request['quantity'],'successful_dispensing','Sensor-confirmed dispensing']); $db->prepare("UPDATE dispensing_requests SET request_status='success',completed_at=NOW() WHERE id=?")->execute([$requestId]); $db->prepare("UPDATE transactions SET dispensing_status='dispensed' WHERE id=?")->execute([$request['transaction_id']]); } else { $db->prepare("UPDATE dispensing_requests SET request_status='failed',completed_at=NOW() WHERE id=?")->execute([$requestId]); $db->prepare("UPDATE transactions SET dispensing_status='failed' WHERE id=?")->execute([$request['transaction_id']]); $db->prepare("INSERT INTO notifications (notification_type,title,message,severity,transaction_id) VALUES ('dispensing_failure','Dispensing failed',?,'danger',?)")->execute(['Transaction '.$request['transaction_code'].' failed sensor verification. Stock was not deducted.',$request['transaction_id']]); }
        $db->commit(); Response::json(['dispensing_request_id'=>$requestId,'transaction_code'=>$request['transaction_code'],'sensor_confirmed'=>$success,'inventory_deducted'=>$success,'status'=>$success?'dispensed':'failed']);
    }

    if ($path === '/api/machine/heartbeat' && $method === 'POST') { $hardwareAuth(); $body=requestBody(); $machineId=(int)($body['machine_id'] ?? 1); $stmt=$db->prepare("UPDATE machine_status SET connection_status='online',esp32_status=?,motor_status=?,sensor_status=?,coin_acceptor_status=?,last_communication_at=NOW(),last_payload=? WHERE machine_id=?"); $stmt->execute([$body['esp32_status']??'Ready',$body['motor_status']??'Idle',$body['sensor_status']??'Monitoring',$body['coin_acceptor_status']??'Ready',json_encode($body),$machineId]); Response::json(['machine_id'=>$machineId,'online'=>true,'last_communication_at'=>gmdate('c')]); }
    if ($path === '/api/machine/status' && $method === 'GET') { $auth(['super_admin','admin','staff']); $machine=$db->query('SELECT m.*,ms.* FROM machines m LEFT JOIN machine_status ms ON ms.machine_id=m.id ORDER BY m.id LIMIT 1')->fetch(); $slots=$db->query('SELECT s.*,m.name AS medicine_name,COALESCE(i.quantity,0) AS quantity FROM machine_slots s LEFT JOIN medicines m ON m.id=s.medicine_id LEFT JOIN inventory i ON i.medicine_id=s.medicine_id ORDER BY s.slot_number')->fetchAll(); Response::json(['machine'=>$machine,'slots'=>$slots]); }
    if ($path === '/api/transactions' && $method === 'GET') { $auth(['super_admin','admin','staff']); $rows=$db->query('SELECT t.*,GROUP_CONCAT(ti.medicine_name_snapshot SEPARATOR ", ") AS medicines FROM transactions t LEFT JOIN transaction_items ti ON ti.transaction_id=t.id GROUP BY t.id ORDER BY t.created_at DESC LIMIT 250')->fetchAll(); Response::json($rows); }
    if ($path === '/api/notifications' && $method === 'GET') { $auth(['super_admin','admin','staff']); Response::json($db->query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100')->fetchAll()); }
    if ($path === '/api/logs' && $method === 'GET') { $auth(['super_admin','admin']); Response::json($db->query('SELECT al.*,u.display_name FROM activity_logs al LEFT JOIN users u ON u.id=al.actor_user_id ORDER BY al.created_at DESC LIMIT 250')->fetchAll()); }
    if ($path === '/api/reports/inventory.csv' && $method === 'GET') { $auth(['super_admin','admin','staff']); $rows=$medicineQuery(false); $stream=fopen('php://temp','r+'); fputcsv($stream,['Medicine','Category','Quantity','Price','Expiry','Status','Slot']); foreach($rows as $row) fputcsv($stream,[$row['name'],$row['category'],$row['stockQuantity'],number_format($row['price'],2),$row['expiryDate'],$row['status'],$row['slotNumber'] ?? 'Unassigned']); rewind($stream); Response::csv('medidispense-inventory-report.csv',stream_get_contents($stream)); }

    Response::error('Route not found.', 404);
} catch (Throwable $e) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) $db->rollBack();
    error_log($e->getMessage());
    Response::error($config['app_env'] === 'development' ? $e->getMessage() : 'Internal server error.', 500);
}
