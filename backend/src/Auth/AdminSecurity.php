<?php
declare(strict_types=1);

final class AdminSecurityError extends RuntimeException {
    public function __construct(string $message, public readonly int $status = 401, public readonly string $errorCode = 'AUTH_REQUIRED') { parent::__construct($message); }
}

final class AdminSecurity {
    public const IDLE_SECONDS = 300;
    public const EXPIRED = 'Your session expired due to inactivity. Please log in again.';
    public const LOCKED = 'This account is temporarily locked due to multiple failed login attempts. Please try again later.';
    public function __construct(private PDO $db) {}
    public static function emailKey(string $email): string { return hash('sha256', strtolower(trim($email))); }

    public function audit(string $action, ?int $userId = null, array $metadata = []): void {
        $q = $this->db->prepare('INSERT INTO activity_logs (actor_user_id,actor_type,action,description,metadata) VALUES (?,\'user\',?,?,?)');
        $q->execute([$userId, $action, str_replace('_', ' ', $action), $metadata ? json_encode($metadata) : null]);
    }

    // Called inside a transaction; locks one normalized email, including unknown accounts.
    private function state(string $email): array {
        $key = self::emailKey($email);
        $this->db->prepare('INSERT IGNORE INTO admin_login_security(email_hash) VALUES (?)')->execute([$key]);
        $q = $this->db->prepare('SELECT *, locked_until > NOW() AS is_locked FROM admin_login_security WHERE email_hash=? FOR UPDATE');
        $q->execute([$key]); $row = $q->fetch(PDO::FETCH_ASSOC);
        if ($row['locked_until'] !== null && !(int)$row['is_locked']) {
            $this->clear($key);
            $this->audit('account_lockout_expired', null, ['account_key'=>$key]);
            $row['failed_attempts'] = 0; $row['locked_until'] = null;
        }
        return $row;
    }
    private function clear(string $key): void {
        $this->db->prepare('UPDATE admin_login_security SET failed_attempts=0,locked_until=NULL WHERE email_hash=?')->execute([$key]);
    }

    // The verifier is server-side Firebase password verification, never client-reported success/failure.
    public function login(string $email, string $password, callable $verify): string {
        $email = strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email)>320 || $password==='' || strlen($password)>4096) throw new AdminSecurityError('Incorrect email or password.');
        $this->db->beginTransaction();
        try {
            $row = $this->state($email);
            if ((int)$row['is_locked']) {
                $this->db->commit();
                throw new AdminSecurityError(self::LOCKED, 429, 'ACCOUNT_LOCKED');
            }
            $uid = $verify($email, $password);
            $q = $this->db->prepare('SELECT id,firebase_uid,is_active FROM users WHERE LOWER(email)=?');
            $q->execute([$email]); $user = $q->fetch(PDO::FETCH_ASSOC);
            if ($uid === null || ($user && (!(int)$user['is_active'] || $user['firebase_uid'] !== $uid))) {
                $attempts = (int)$row['failed_attempts'] + 1;
                $this->db->prepare('UPDATE admin_login_security SET failed_attempts=?,locked_until=IF(? >= 5,DATE_ADD(NOW(),INTERVAL 30 MINUTE),NULL) WHERE email_hash=?')->execute([$attempts,$attempts,$row['email_hash']]);
                $this->audit('admin_login_failed', $user ? (int)$user['id'] : null, ['account_key'=>$row['email_hash']]);
                if ($attempts >= 5) $this->audit('account_locked', $user ? (int)$user['id'] : null);
                $this->db->commit();
                throw new AdminSecurityError($attempts >= 5 ? self::LOCKED : 'Incorrect email or password. '.(5-$attempts).' attempts remaining.', $attempts >= 5 ? 429 : 401, $attempts >= 5 ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS');
            }
            $this->clear($row['email_hash']);
            $this->audit('admin_login_success', $user ? (int)$user['id'] : null);
            if ($user) $this->db->prepare('UPDATE users SET last_login_at=NOW() WHERE id=?')->execute([$user['id']]);
            $this->db->commit();
            return $uid;
        } catch (Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    public function check(array $user, array &$session, bool $activity = false, ?int $now = null): void {
        if (!in_array($user['role_code'], ['admin','super_admin'], true)) return;
        $now ??= time();
        $this->db->beginTransaction();
        try { $row = $this->state($user['email']); $this->db->commit(); }
        catch (Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
        if ((int)$row['is_locked']) { unset($session['admin_auth']); throw new AdminSecurityError(self::LOCKED,429,'ACCOUNT_LOCKED'); }
        $auth = $session['admin_auth'] ?? null;
        if (!$auth || ($auth['uid'] ?? '') !== $user['firebase_uid']) throw new AdminSecurityError('Please log in again.',401,'SESSION_REQUIRED');
        if ($now - (int)$auth['last_activity'] >= self::IDLE_SECONDS) {
            unset($session['admin_auth']);
            $this->audit('admin_inactivity_logout',(int)$user['id']);
            throw new AdminSecurityError(self::EXPIRED,401,'SESSION_EXPIRED');
        }
        if ($activity) $session['admin_auth']['last_activity'] = $now;
    }

    public function unlock(array $actor, int $targetId): void {
        if ($actor['role_code'] !== 'super_admin' || (int)$actor['id'] === $targetId) throw new AdminSecurityError('You are not authorized for this action.',403);
        $this->db->beginTransaction();
        try {
            $q=$this->db->prepare('SELECT u.email,r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE');
            $q->execute([$targetId]); $target=$q->fetch(PDO::FETCH_ASSOC);
            if (!$target || !in_array($target['code'], ['admin','staff'], true)) throw new AdminSecurityError('Only Admin and Staff accounts can be manually unlocked.',422);
            $this->clear(self::emailKey($target['email']));
            $this->audit('admin_account_unlocked',(int)$actor['id'],['affected_user_id'=>$targetId]);
            $this->db->commit();
        } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    public static function verifyPassword(string $apiKey, string $email, string $password): ?string {
        if ($apiKey === '') throw new AdminSecurityError('Login service is not configured. Please contact the administrator.',503,'AUTH_UNAVAILABLE');
        $ch=curl_init('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='.rawurlencode($apiKey));
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_POSTFIELDS=>json_encode(['email'=>$email,'password'=>$password,'returnSecureToken'=>true]),CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>15]);
        $raw=curl_exec($ch); $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
        $data=is_string($raw) ? json_decode($raw,true) : null;
        if ($status===200 && !empty($data['localId'])) return (string)$data['localId'];
        $reason=explode(' : ',(string)($data['error']['message']??''))[0];
        if(in_array($reason,['INVALID_LOGIN_CREDENTIALS','INVALID_PASSWORD','EMAIL_NOT_FOUND','USER_DISABLED'],true)) return null;
        throw new AdminSecurityError('Login service is temporarily unavailable. Please try again later.',503,'AUTH_UNAVAILABLE');
    }
}
