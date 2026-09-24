<?php
declare(strict_types=1);

return [
    'app_env' => getenv('APP_ENV') ?: 'development',
    'app_url' => getenv('APP_URL') ?: 'http://localhost:5173',
    'cors_origins' => array_filter(array_map('trim', explode(',', getenv('CORS_ORIGINS') ?: 'http://localhost:5173,http://localhost:3000'))),
    'database' => [
        'host' => getenv('DB_HOST') ?: '127.0.0.1',
        'port' => getenv('DB_PORT') ?: '3306',
        'name' => getenv('DB_NAME') ?: 'medidispense',
        'user' => getenv('DB_USER') ?: 'root',
        'password' => getenv('DB_PASSWORD') ?: '',
    ],
    'firebase' => [
        'project_id' => getenv('FIREBASE_PROJECT_ID') ?: 'medidispense-e4883',
        'initial_super_admin_email' => strtolower(trim(getenv('FIREBASE_INITIAL_SUPER_ADMIN_EMAIL') ?: 'beatrez.villanueva@cvsu.edu.ph')),
    ],
    'hardware' => [
        'api_key' => getenv('HARDWARE_API_KEY') ?: 'replace-this-hardware-key',
    ],
];
