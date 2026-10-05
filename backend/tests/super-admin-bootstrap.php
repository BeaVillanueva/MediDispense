<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
// Uses only the isolated local test server; never the configured application DB.
if (is_file(__DIR__ . '/../config/local.php')) throw new RuntimeException('Test requires no local.php override.');
$db = new PDO('mysql:host=127.0.0.1;port=33317;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$name = 'medidispense_auth_test_' . bin2hex(random_bytes(5));
$db->exec(str_replace('medidispense', $name, file_get_contents(__DIR__ . '/../../database/schema.sql')));
putenv('DB_HOST=127.0.0.1'); putenv('DB_PORT=33317'); putenv('DB_NAME=' . $name); putenv('DB_USER=root'); putenv('DB_PASSWORD=');
$checks = 0;
function runBootstrap(int $expected, string $message): void {
    global $checks;
    $process = proc_open([PHP_BINARY, __DIR__ . '/../src/Auth/bootstrap-super-admin.php', '--development', 'owner@example.test'], [1=>['pipe','w'], 2=>['pipe','w']], $pipes);
    $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    foreach ($pipes as $pipe) fclose($pipe);
    if (proc_close($process) !== $expected || !str_contains($output, $message)) throw new RuntimeException('Unexpected bootstrap result: ' . $output);
    $checks++;
}
try {
    putenv('APP_ENV=production'); runBootstrap(1, 'APP_ENV must be development');
    putenv('APP_ENV=development'); runBootstrap(1, 'Sign in to MediDispense');
    $db->exec("INSERT INTO users(employee_id,firebase_uid,email,display_name,role_id) SELECT 'TEST-OWNER','test-uid','owner@example.test','Test Owner',id FROM roles WHERE code='staff'");
    runBootstrap(1, 'Verify the account email');
    $db->exec('UPDATE users SET email_verified_at=NOW(),is_active=0');
    runBootstrap(1, 'inactive or archived');
    $db->exec('UPDATE users SET is_active=1');
    runBootstrap(0, 'One development Super Admin assigned');
    runBootstrap(1, 'A Super Admin already exists');
    $db->exec('UPDATE users SET is_active=0');
    runBootstrap(1, 'A Super Admin already exists');
    if ((int)$db->query("SELECT COUNT(*) FROM users u JOIN roles r ON u.role_id=r.id WHERE r.code='super_admin'")->fetchColumn() !== 1) throw new RuntimeException('Expected exactly one owner.');
    if ((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='development_super_admin_bootstrap'")->fetchColumn() !== 1) throw new RuntimeException('Expected one audit entry.');
    echo ($checks + 2) . " bootstrap checks passed on isolated MySQL.\n";
} finally {
    $db->exec('DROP DATABASE `' . $name . '`');
}
