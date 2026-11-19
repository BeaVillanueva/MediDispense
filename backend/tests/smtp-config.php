<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
$load = require __DIR__.'/../config/smtp.php';
$path = tempnam(sys_get_temp_dir(),'md-smtp-');
try {
    file_put_contents($path,"<?php return ['enabled'=>true,'username'=>'sender@example.invalid','password'=>'test-only-not-a-real-secret'];");
    putenv('SMTP_HOST=wrong-environment-host.invalid');
    $config = $load([], $path);
    if ($config['host']!=='smtp.gmail.com' || $config['port']!==587 || $config['encryption']!=='tls') throw new RuntimeException('Gmail connection settings changed.');
    if ($config['username']!=='sender@example.invalid' || $config['from_email']!==$config['username'] || !$config['enabled']) throw new RuntimeException('Local credentials not shared with sender.');
    $override = $load(['username'=>'legacy@example.invalid','password'=>'old-placeholder'], $path);
    if ($override!==$config) throw new RuntimeException('Dedicated local config must take precedence.');
    file_put_contents($path,"<?php return ['enabled'=>true,'username'=>'relay-login@example.invalid','password'=>'test-only','host'=>'smtp-relay.example.com','port'=>2525,'encryption'=>'tls','from_email'=>'sender@example.com'];");
    $relay = $load([], $path);
    if ($relay['host']!=='smtp-relay.example.com' || $relay['port']!==2525 || $relay['encryption']!=='tls' || $relay['from_email']!=='sender@example.com' || $relay['username']!=='relay-login@example.invalid') throw new RuntimeException('Local relay override not applied.');
    file_put_contents($path,"<?php return ['enabled'=>true,'username'=>'sender@example.invalid','password'=>'x','host'=>'bad host;','port'=>70000,'encryption'=>'none','from_email'=>'not-an-email'];");
    $bad = $load([], $path);
    if ($bad['host']!=='smtp.gmail.com' || $bad['port']!==587 || $bad['encryption']!=='tls' || $bad['from_email']!=='sender@example.invalid') throw new RuntimeException('Invalid relay values must fall back to Gmail defaults.');
    file_put_contents($path,'<?php return [];');
    $empty = $load([], $path);
    if ($empty['enabled'] || $empty['username']!=='' || $empty['password']!=='') throw new RuntimeException('Missing credentials must not enable sending.');
    echo "PASS Gmail STARTTLS settings, local relay override with safe fallback, local credential precedence, shared sender identity, environment independence and disabled defaults. No emails sent.\n";
} finally {
    unlink($path);
    putenv('SMTP_HOST');
}
