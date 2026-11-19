<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

/**
 * Shared by Apache, the alert worker and the CLI test. No Windows SMTP env vars.
 * Defaults to Gmail STARTTLS. smtp.local.php may override the relay (host, port,
 * encryption, from_email), e.g. a port-2525 relay where 25/465/587 are blocked.
 */
return static function (array $legacy = [], ?string $credentialsFile = null): array {
    $credentialsFile ??= __DIR__.'/smtp.local.php';
    $credentials = is_file($credentialsFile) ? require $credentialsFile : [];
    if (!is_array($credentials)) throw new RuntimeException('SMTP local configuration must return an array.');
    // Preserve any existing PHP credentials until explicitly replaced locally.
    $values = array_replace(['enabled'=>false,'username'=>'','password'=>''],
        array_intersect_key($legacy, array_flip(['enabled','username','password'])),
        $credentials);
    $username = trim((string)$values['username']);
    $host = strtolower(trim((string)($credentials['host'] ?? '')));
    $port = filter_var($credentials['port'] ?? null, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>65535]]);
    $encryption = strtolower(trim((string)($credentials['encryption'] ?? '')));
    $from = trim((string)($credentials['from_email'] ?? ''));
    return [
        'enabled'=>$values['enabled'] === true,
        'host'=>preg_match('/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D', $host) ? $host : 'smtp.gmail.com',
        'port'=>$port === false ? 587 : $port,
        // PHPMailer uses "tls" to mean STARTTLS (587/2525) and "ssl" for implicit TLS (465).
        'encryption'=>in_array($encryption, ['tls','ssl'], true) ? $encryption : 'tls',
        'username'=>$username,
        'password'=>(string)$values['password'],
        'from_email'=>filter_var($from, FILTER_VALIDATE_EMAIL) ? $from : $username,
    ];
};
