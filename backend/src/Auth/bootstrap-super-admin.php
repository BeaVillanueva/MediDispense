<?php
declare(strict_types=1);

// Intentionally CLI-only: no HTTP bootstrap endpoint or password handling.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if ($argc !== 3 || $argv[1] !== '--development' || !filter_var(trim($argv[2]), FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Usage: php backend/src/Auth/bootstrap-super-admin.php --development you@example.com\n");
    exit(1);
}
require_once __DIR__ . '/../Database.php';
$config = require __DIR__ . '/../../config/config.php';
if ($config['app_env'] !== 'development') {
    fwrite(STDERR, "Refused: APP_ENV must be development.\n");
    exit(1);
}
$db = null;
try {
    $db = Database::connect($config);
    $db->beginTransaction();
    // Serialize bootstrap attempts even when no owner row exists yet.
    $role = $db->query("SELECT id FROM roles WHERE code='super_admin' FOR UPDATE")->fetchColumn();
    if (!$role) throw new RuntimeException('The existing super_admin role is missing. Check the database setup.');
    if ($db->query("SELECT id FROM users WHERE role_id=" . (int)$role . " LIMIT 1 FOR UPDATE")->fetchColumn()) {
        throw new RuntimeException('A Super Admin already exists (including inactive accounts). No changes made.');
    }
    $query = $db->prepare('SELECT id,is_active,archived_at,email_verified_at FROM users WHERE LOWER(email)=LOWER(?) FOR UPDATE');
    $query->execute([trim($argv[2])]);
    $user = $query->fetch();
    if (!$user) throw new RuntimeException('Sign in to MediDispense with this account first, verify the email, then refresh the page.');
    if (!(int)$user['is_active'] || $user['archived_at'] !== null) throw new RuntimeException('Refused: the employee account is inactive or archived.');
    if (!$user['email_verified_at']) throw new RuntimeException('Verify the account email, then sign in again before running this command.');
    $db->prepare('UPDATE users SET role_id=? WHERE id=?')->execute([$role, $user['id']]);
    $db->prepare("INSERT INTO activity_logs (actor_user_id,actor_type,action,description) VALUES (?,'system','development_super_admin_bootstrap','First Super Admin assigned by local CLI.')")->execute([$user['id']]);
    $db->commit();
    fwrite(STDOUT, "One development Super Admin assigned. Sign out and sign in again.\n");
} catch (Throwable $error) {
    if ($db && $db->inTransaction()) $db->rollBack();
    // Never dump connection credentials, SQL, or stack traces.
    fwrite(STDERR, ($error instanceof PDOException ? 'Database operation failed. Check local MySQL connectivity and existing tables; no changes committed.' : $error->getMessage()) . "\n");
    exit(1);
}
