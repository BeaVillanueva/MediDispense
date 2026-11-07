<?php
// Copy to ignored local.php only if Apache environment variables are unavailable.
// Never put this server configuration in VITE_* variables.
// Email credentials belong in smtp.local.php; see smtp.local.example.php.
return [
    'database' => ['host'=>'127.0.0.1','port'=>'3306','name'=>'medidispense','user'=>'root','password'=>''],
    'cors_origins' => ['http://localhost:3000','http://localhost:3001','http://localhost:5173'],
    'machine_code' => 'MD-001',
    'firebase' => ['web_api_key'=>''], // Existing Firebase Web API key for PHP password verification.
    'hardware' => ['api_key'=>''], // Empty disables trusted hardware endpoints.
];
