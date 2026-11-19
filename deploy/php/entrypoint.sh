#!/bin/sh
# Generates the gitignored local config files from Railway environment variables,
# then runs the service command (Apache by default, or a worker script).
set -eu

CONFIG_DIR=/var/www/html/backend/config
PHOTO_DIR=/var/www/html/backend/public/manus-storage/profile-photos
export PORT="${PORT:-8080}"

# Listen on every interface (IPv4 + IPv6: Railway private networking uses IPv6).
echo "Listen ${PORT}" > /etc/apache2/ports.conf

# Values are passed through var_export, never interpolated into PHP source.
php -r '
$dir = $argv[1];
$bool = static fn(string $name): bool => in_array(strtolower((string)getenv($name)), ["1","true","yes","on"], true);
$smtp = ["enabled" => $bool("SMTP_ENABLED"), "username" => (string)getenv("SMTP_USERNAME"), "password" => (string)getenv("SMTP_PASSWORD")];
file_put_contents("$dir/smtp.local.php", "<?php\nreturn " . var_export($smtp, true) . ";\n");
$ids = array_values(array_filter(array_map("intval", preg_split("/[\\s,]+/", (string)getenv("DEMO_PROTECTED_TRANSACTION_IDS"), -1, PREG_SPLIT_NO_EMPTY)), fn(int $id) => $id > 0));
$demo = [
    "controlled_expiration" => $bool("DEMO_CONTROLLED_EXPIRATION"),
    "no_late_coins_assumption_acknowledged" => $bool("DEMO_NO_LATE_COINS_ACK"),
    "automatic_session_binding" => $bool("DEMO_AUTOMATIC_SESSION_BINDING"),
    "protected_transaction_ids" => $ids,
];
file_put_contents("$dir/payment-demo.local.php", "<?php\nreturn " . var_export($demo, true) . ";\n");
' "$CONFIG_DIR"
chown www-data:www-data "$CONFIG_DIR/smtp.local.php" "$CONFIG_DIR/payment-demo.local.php"
chmod 640 "$CONFIG_DIR/smtp.local.php" "$CONFIG_DIR/payment-demo.local.php"

# Profile photos live on a Railway volume mounted here (it may start empty or root-owned).
mkdir -p "$PHOTO_DIR"
chown www-data:www-data "$PHOTO_DIR" 2>/dev/null || true

exec "$@"
