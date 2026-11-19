<?php
declare(strict_types=1);

final class Database
{
    private static ?PDO $connection = null;

    /** Long-running CLI workers must reconnect after MySQL restarts. */
    public static function resetConnection(): void { self::$connection = null; }

    public static function connect(array $config): PDO
    {
        if (self::$connection) return self::$connection;
        $db = $config['database'];
        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $db['host'], $db['port'], $db['name']);
        $connection = new PDO($dsn, $db['user'], $db['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        // All stored DATETIMEs are Philippine local time; hosted MySQL defaults to UTC.
        // Pin the session zone so NOW()/CURDATE() match existing rows everywhere.
        $timeZone = getenv('DB_TIMEZONE') ?: '+08:00';
        if (preg_match('/^[+-](0\d|1[0-4]):[0-5]\d$/', $timeZone) === 1) {
            $connection->exec("SET time_zone = '{$timeZone}'");
        }
        // The app was built and tested on MariaDB's non-strict mode. Hosted MySQL 8
        // defaults to STRICT + ONLY_FULL_GROUP_BY, which changes query behaviour.
        $sqlMode = getenv('DB_SQL_MODE') ?: 'NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION';
        if (preg_match('/^[A-Z_]+(,[A-Z_]+)*$/', $sqlMode) === 1) {
            $connection->exec("SET SESSION sql_mode = '{$sqlMode}'");
        }
        return self::$connection = $connection;
    }
}
