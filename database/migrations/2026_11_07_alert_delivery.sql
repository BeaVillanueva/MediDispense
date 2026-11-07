-- Additive only: preserve all existing notifications, inventory and transactions.
CREATE TABLE IF NOT EXISTS alert_incidents (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 incident_key VARCHAR(160) NOT NULL UNIQUE,
 active_key VARCHAR(160) NULL UNIQUE,
 notification_id BIGINT UNSIGNED NOT NULL UNIQUE,
 kind ENUM('low_stock','dispensing_failure') NOT NULL,
 medicine_id BIGINT UNSIGNED NOT NULL,
 slot_id BIGINT UNSIGNED NOT NULL,
 request_id BIGINT UNSIGNED NULL,
 details JSON NOT NULL,
 detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 acknowledged_at DATETIME NULL,
 acknowledged_by BIGINT UNSIGNED NULL,
 resolved_at DATETIME NULL,
 resolved_by BIGINT UNSIGNED NULL,
 resolution_note VARCHAR(500) NULL,
 INDEX alert_active(kind,resolved_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notification_reads (
 notification_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(notification_id,user_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS alert_recipients (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 low_stock TINYINT(1) NOT NULL DEFAULT 0,
 dispensing_failure TINYINT(1) NOT NULL DEFAULT 0,
 updated_by BIGINT UNSIGNED NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS alert_email_jobs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 incident_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 recipient VARCHAR(320) NOT NULL,
 message_id VARCHAR(180) NOT NULL UNIQUE,
 status ENUM('pending','processing','retry','sent','uncertain','dead','cancelled') NOT NULL DEFAULT 'pending',
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 claimed_at DATETIME NULL,
 sent_at DATETIME NULL,
 last_error VARCHAR(500) NULL,
 UNIQUE KEY incident_recipient(incident_id,user_id),
 INDEX email_due(status,next_attempt_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS alert_email_attempts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 job_id BIGINT UNSIGNED NOT NULL,
 attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 outcome ENUM('started','sent','retry','uncertain','dead','cancelled') NOT NULL,
 detail VARCHAR(500) NULL,
 INDEX job_history(job_id,id)
) ENGINE=InnoDB;
INSERT IGNORE INTO system_settings(setting_key,setting_value) VALUES('alert_monitor_started_at',DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s'));
