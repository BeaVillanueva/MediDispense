<?php
declare(strict_types=1);

function allowsDevelopmentOrigin(string $origin, array $config, array $server): bool {
    if (($config['app_env'] ?? '') !== 'development') return false;
    $parts=parse_url($origin);
    if (!$parts || ($parts['scheme'] ?? '') !== 'http' || isset($parts['user']) || isset($parts['pass']) || isset($parts['path']) || isset($parts['query']) || isset($parts['fragment']) || !in_array($parts['port'] ?? 80,[...range(3000,3019),5173],true)) return false;
    $host=$parts['host'] ?? '';
    $requestHost=parse_url('http://'.($server['HTTP_HOST'] ?? ''),PHP_URL_HOST);
    if ($host !== $requestHost) return false;
    if (in_array($host,['localhost','127.0.0.1','[::1]'],true)) return true;
    // Only the actual PHP server's private IPv4 address, not arbitrary LAN sites.
    return $host === ($server['SERVER_ADDR'] ?? '') && filter_var($host,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4) !== false && preg_match('/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/',$host) === 1;
}
