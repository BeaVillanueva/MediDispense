<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

/** Shared by Apache, the alert worker and the CLI test. No Windows SMTP env vars. */
return static function (array $legacy = [], ?string $credentialsFile = null): array {
    $credentialsFile ??= __DIR__.'/smtp.local.php';
    $credentials = is_file($credentialsFile) ? require $credentialsFile : [];
    if (!is_array($credentials)) throw new RuntimeException('SMTP local configuration must return an array.');
    // Preserve any existing PHP credentials until explicitly replaced locally.
    $values = array_replace(['enabled'=>false,'username'=>'','password'=>''],
        array_intersect_key($legacy, array_flip(['enabled','username','password'])),
        $credentials);
    $username = trim((string)$values['username']);
    return [
        'enabled'=>$values['enabled'] === true,
        'host'=>'smtp.gmail.com',
        'port'=>587,
        // PHPMailer uses "tls" to mean STARTTLS on port 587.
        'encryption'=>'tls',
        'username'=>$username,
        'password'=>(string)$values['password'],
        'from_email'=>$username,
    ];
};
