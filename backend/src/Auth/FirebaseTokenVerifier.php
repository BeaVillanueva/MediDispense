<?php
declare(strict_types=1);

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

final class FirebaseTokenVerifier
{
    private static array $certificates = [];
    private static int $certificatesFetchedAt = 0;

    public function __construct(private readonly string $projectId) {}

    public function verify(string $token): array
    {
        if ($this->projectId === '') throw new RuntimeException('FIREBASE_PROJECT_ID is not configured.');
        $parts = explode('.', $token);
        if (count($parts) !== 3) throw new RuntimeException('Malformed Firebase ID token.');
        $header = json_decode($this->base64UrlDecode($parts[0]), true);
        $claims = json_decode($this->base64UrlDecode($parts[1]), true);
        if (!is_array($header) || !is_array($claims) || empty($header['kid'])) throw new RuntimeException('Invalid Firebase token header.');
        $this->loadCertificates();
        $certificate = self::$certificates[$header['kid']] ?? null;
        if (!$certificate) throw new RuntimeException('Firebase signing key is unavailable.');
        JWT::decode($token, new Key($certificate, 'RS256'));
        $now = time();
        if (($claims['aud'] ?? null) !== $this->projectId) throw new RuntimeException('Firebase token audience mismatch.');
        if (($claims['iss'] ?? null) !== 'https://securetoken.google.com/' . $this->projectId) throw new RuntimeException('Firebase token issuer mismatch.');
        if (empty($claims['sub']) || ($claims['exp'] ?? 0) < $now || ($claims['iat'] ?? 0) > $now + 60) throw new RuntimeException('Firebase token is expired or not yet valid.');
        return $claims;
    }

    private function loadCertificates(): void
    {
        if (self::$certificates && time() - self::$certificatesFetchedAt < 3600) return;
        $json = @file_get_contents('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
        if (!$json) throw new RuntimeException('Unable to retrieve Firebase signing certificates.');
        $certificates = json_decode($json, true);
        if (!is_array($certificates)) throw new RuntimeException('Invalid Firebase signing certificate response.');
        self::$certificates = $certificates;
        self::$certificatesFetchedAt = time();
    }

    private function base64UrlDecode(string $value): string
    {
        return base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4)) ?: '';
    }
}
