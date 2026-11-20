<?php
declare(strict_types=1);

$config = [
    'machine_code' => getenv('KIOSK_MACHINE_CODE') ?: 'MD-001',
    'app_env' => getenv('APP_ENV') ?: 'development',
    'app_url' => getenv('APP_URL') ?: 'http://localhost:5173',
    'cors_origins' => array_filter(array_map('trim', explode(',', getenv('CORS_ORIGINS') ?: 'http://localhost:5173,http://localhost:3000,http://localhost:3001'))),
    'database' => [
        // Trimmed: values pasted into hosting dashboards often carry stray spaces.
        'host' => trim((string)getenv('DB_HOST')) ?: '127.0.0.1',
        'port' => trim((string)getenv('DB_PORT')) ?: '3306',
        'name' => trim((string)getenv('DB_NAME')) ?: 'medidispense',
        'user' => trim((string)getenv('DB_USER')) ?: 'root',
        'password' => trim((string)getenv('DB_PASSWORD')),
    ],
    'firebase' => [
        'web_api_key' => getenv('FIREBASE_WEB_API_KEY') ?: '',
        'project_id' => getenv('FIREBASE_PROJECT_ID') ?: 'medidispense-e4883',
        'database_url' => getenv('FIREBASE_DATABASE_URL') ?: '',
    ],
    'hardware' => [
        'api_key' => getenv('HARDWARE_API_KEY') ?: '',
    ],
    // Optional HTTPS relay (Google Apps Script) for alert emails where SMTP ports are blocked.
    'alert_mail_relay' => ['url' => trim((string)getenv('ALERT_MAIL_RELAY_URL')), 'secret' => trim((string)getenv('ALERT_MAIL_RELAY_SECRET'))],
    'alerts' => ['timeout_seconds'=>max(10,(int)(getenv('ALERT_DISPENSE_TIMEOUT_SECONDS')?:120))],
];

$local = __DIR__ . '/local.php';
$config = is_file($local) ? array_replace_recursive($config, require $local) : $config;
$config['smtp'] = (require __DIR__.'/smtp.php')($config['smtp'] ?? []);
return $config;
