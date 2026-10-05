<?php
declare(strict_types=1);

final class FirebaseRealtimeDatabase
{
    private string $databaseUrl;

    public function __construct(string $databaseUrl)
    {
        $databaseUrl = rtrim(trim($databaseUrl), '/');

        if ($databaseUrl === '') {
            throw new RuntimeException(
                'Firebase Realtime Database URL is not configured.'
            );
        }

        $this->databaseUrl = $databaseUrl;
    }

    /**
     * Send one complete dispensing command to Firebase.
     *
     * Slot: 1, 2, or 3
     * Quantity: 1, 2, or 3
     */
    public function sendDispenseCommand(int $requestId, int $slot, int $quantity): array
    {
        if ($requestId < 1) {
            throw new InvalidArgumentException('Request ID must be a positive integer.');
        }

        if ($slot < 1 || $slot > 3) {
            throw new InvalidArgumentException(
                'Slot must be between 1 and 3.'
            );
        }

        if ($quantity < 1 || $quantity > 3) {
            throw new InvalidArgumentException(
                'Quantity must be between 1 and 3.'
            );
        }

        $payload = [
            'request_id' => $requestId,
            'slot' => $slot,
            'quantity' => $quantity,
            'dispensed' => 0,
            'status' => 'pending',
        ];

        return $this->put('/dispense', $payload);
    }

    private function put(string $path, array $data): array
    {
        $url = $this->databaseUrl
            . '/'
            . ltrim($path, '/')
            . '.json';

        $json = json_encode(
            $data,
            JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );

        $ch = curl_init($url);

        if ($ch === false) {
            throw new RuntimeException(
                'Could not initialize Firebase connection.'
            );
        }

        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'PUT',
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
        ]);

        $response = curl_exec($ch);

        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);

            throw new RuntimeException(
                'Firebase request failed: ' . $error
            );
        }

        $statusCode = (int) curl_getinfo(
            $ch,
            CURLINFO_HTTP_CODE
        );

        curl_close($ch);

        if ($statusCode < 200 || $statusCode >= 300) {
            throw new RuntimeException(
                'Firebase returned HTTP ' . $statusCode . '.'
            );
        }

        $decoded = json_decode($response, true);

        return is_array($decoded) ? $decoded : $data;
    }
}
