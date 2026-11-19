<?php
declare(strict_types=1);

/**
 * Stores PHP sessions in MySQL so admin logins survive container restarts and
 * redeploys (hosted deployments have no persistent session directory).
 * Local XAMPP development keeps PHP's default file sessions.
 */
final class DatabaseSessionHandler implements SessionHandlerInterface, SessionUpdateTimestampHandlerInterface
{
    private static bool $tableReady = false;

    public function __construct(private PDO $db)
    {
        if (!self::$tableReady) {
            $this->db->exec('CREATE TABLE IF NOT EXISTS php_sessions (
                id VARCHAR(128) NOT NULL PRIMARY KEY,
                data MEDIUMBLOB NOT NULL,
                updated_at INT UNSIGNED NOT NULL,
                KEY php_sessions_updated (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin');
            self::$tableReady = true;
        }
    }

    public function open(string $path, string $name): bool { return true; }

    public function close(): bool { return true; }

    public function read(string $id): string|false
    {
        $q = $this->db->prepare('SELECT data FROM php_sessions WHERE id=?');
        $q->execute([$id]);
        $data = $q->fetchColumn();
        return $data === false ? '' : (string)$data;
    }

    public function write(string $id, string $data): bool
    {
        $q = $this->db->prepare('INSERT INTO php_sessions(id,data,updated_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated_at=VALUES(updated_at)');
        return $q->execute([$id, $data, time()]);
    }

    public function destroy(string $id): bool
    {
        return $this->db->prepare('DELETE FROM php_sessions WHERE id=?')->execute([$id]);
    }

    public function gc(int $max_lifetime): int|false
    {
        $q = $this->db->prepare('DELETE FROM php_sessions WHERE updated_at < ?');
        $q->execute([time() - $max_lifetime]);
        return $q->rowCount();
    }

    /** Strict mode: only IDs this server issued are accepted. */
    public function validateId(string $id): bool
    {
        $q = $this->db->prepare('SELECT 1 FROM php_sessions WHERE id=?');
        $q->execute([$id]);
        return $q->fetchColumn() !== false;
    }

    public function updateTimestamp(string $id, string $data): bool
    {
        return $this->db->prepare('UPDATE php_sessions SET updated_at=? WHERE id=?')->execute([time(), $id]);
    }
}
