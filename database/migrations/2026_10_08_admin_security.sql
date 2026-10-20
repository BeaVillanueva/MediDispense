-- Additive and safe to rerun. Existing users and passwords are not changed.
CREATE TABLE IF NOT EXISTS admin_login_security (
  email_hash CHAR(64) PRIMARY KEY,
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
