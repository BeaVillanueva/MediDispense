<?php
declare(strict_types=1);

final class Response
{
    public static function json(mixed $payload, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['data' => $payload], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function error(string $message, int $status = 400, array $details = []): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => ['message' => $message, 'code' => $details['code'] ?? 'REQUEST_FAILED', 'details' => $details]], JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function csv(string $filename, string $contents): never
    {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        echo $contents;
        exit;
    }
}

function requestBody(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $payload = json_decode($raw, true);
    if (!is_array($payload)) Response::error('Request body must be valid JSON.');
    return $payload;
}

function pathParam(string $pattern, string $path): ?string
{
    if (!preg_match($pattern, $path, $matches)) return null;
    return $matches[1] ?? null;
}
