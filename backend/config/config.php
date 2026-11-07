<?php
declare(strict_types=1);

$config = [
    'machine_code' => getenv('KIOSK_MACHINE_CODE') ?: 'MD-001',
    'app_env' => getenv('APP_ENV') ?: 'development',
    'app_url' => getenv('APP_URL') ?: 'http://localhost:5173',
    'cors_origins' => array_filter(array_map('trim', explode(',', getenv('CORS_ORIGINS') ?: 'http://localhost:5173,http://localhost:3000,http://localhost:3001'))),
    'database' => [
        'host' => getenv('DB_HOST') ?: '127.0.0.1',
        'port' => getenv('DB_PORT') ?: '3306',
        'name' => getenv('DB_NAME') ?: 'medidispense',
        'user' => getenv('DB_USER') ?: 'root',
        'password' => getenv('DB_PASSWORD') ?: '',
    ],
    'firebase' => [
        'web_api_key' => getenv('FIREBASE_WEB_API_KEY') ?: '',
        'project_id' => getenv('FIREBASE_PROJECT_ID') ?: 'medidispense-e4883',
    ],
    'hardware' => [
        'api_key' => getenv('HARDWARE_API_KEY') ?: '',
    ],
    'alerts' => ['timeout_seconds'=>max(10,(int)(getenv('ALERT_DISPENSE_TIMEOUT_SECONDS')?:120))],
];

$local = __DIR__ . '/local.php';
$config = is_file($local) ? array_replace_recursive($config, require $local) : $config;
$config['smtp'] = (require __DIR__.'/smtp.php')($config['smtp'] ?? []);
return $config;
