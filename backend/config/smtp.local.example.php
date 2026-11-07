<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

// Copy to smtp.local.php. Never commit credentials or paste the App Password in chat.
return [
    'enabled'=>false, // Set true when ready to test, with the worker stopped.
    'username'=>'',   // Your Gmail sending address; also used as the From address.
    'password'=>'',   // Gmail App Password, without the display spaces.
];
