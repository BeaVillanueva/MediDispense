<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli') exit;
require __DIR__.'/../src/Database.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
$db->exec(file_get_contents(__DIR__.'/../../database/migrations/2026_11_07_alert_delivery.sql'));
$db->exec(file_get_contents(__DIR__.'/../../database/migrations/2026_11_08_notification_dismissals.sql'));
if(in_array('--seed-admin-recipients',$argv,true)) {
    // Registered addresses remain in users; never hardcode recipient addresses.
    $db->exec("INSERT IGNORE INTO alert_recipients(user_id,low_stock,dispensing_failure,updated_by) SELECT u.id,1,1,u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code IN ('super_admin','admin') AND u.is_active=1 AND u.email_verified_at IS NOT NULL");
}
echo "Additive alert tables ready. Existing inventory, payments and transactions unchanged.\n";
