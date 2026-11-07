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
    file_put_contents($path,'<?php return [];');
    $empty = $load([], $path);
    if ($empty['enabled'] || $empty['username']!=='' || $empty['password']!=='') throw new RuntimeException('Missing credentials must not enable sending.');
    echo "PASS Gmail STARTTLS settings, local credential precedence, shared sender identity, environment independence and disabled defaults. No emails sent.\n";
} finally {
    unlink($path);
    putenv('SMTP_HOST');
}
