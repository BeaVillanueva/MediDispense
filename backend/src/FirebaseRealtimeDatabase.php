<?php
declare(strict_types=1);

interface DispenseCommandGateway
{
    public function sendDispenseCommand(int $requestId, int $slot, int $quantity): array;
    public function retireDispenseCommand(int $requestId): void;
}

final class FirebaseRealtimeDatabase implements DispenseCommandGateway
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

    /** Retire only the selected command. Never write a pending command here. */
    public function retireDispenseCommand(int $requestId): void
    {
        $etag = null;
        $ch = curl_init($this->databaseUrl . '/dispense.json');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_HTTPHEADER => ['X-Firebase-ETag: true'],
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$etag): int {
                if (stripos($line, 'ETag:') === 0) $etag = trim(substr($line, 5));
                return strlen($line);
            },
        ]);
        $response = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($response === false || $code !== 200 || !$etag) {
            throw new RuntimeException('Cannot verify Firebase command. Recovery was not completed; keep the controller disconnected.');
        }
        $command = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
        if ($command !== null && !is_array($command)) throw new RuntimeException('Invalid Firebase command; recovery stopped.');
        if ($command !== null && (int)($command['request_id'] ?? 0) !== $requestId) {
            // Do not overwrite another request, including one currently pending.
            if (in_array($command['status'] ?? '', ['pending','dispensing'], true)) throw new RuntimeException('Another Firebase command is active. Keep the controller disconnected and reconcile that request first.');
        }
        if ($command !== null && (int)($command['request_id'] ?? 0) === $requestId) {
            $command['status'] = 'failed';
            $command['slot'] = 0;
            $command['quantity'] = 0;
            // Keep request_id and reported dispensed count for investigation.
            $this->put('/dispense', $command, ['if-match: ' . $etag]);
        }
        // Retain a request-specific terminal result even after /dispense is reused.
        // A failed write prevents the caller from committing or unlocking the kiosk.
        $this->put('/dispense_results/' . $requestId, [
            'request_id' => $requestId, 'status' => 'failed',
            'source' => 'admin_recovery', 'hardware_disabled_confirmed' => true,
        ]);
    }

    private function put(string $path, array $data, array $headers = []): array
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
            CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers),
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
