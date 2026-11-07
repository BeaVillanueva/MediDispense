-- Per-user presentation state only. No incident or email history is deleted.
CREATE TABLE IF NOT EXISTS notification_dismissals (
 notification_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 dismissed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(notification_id,user_id),
 INDEX dismissals_by_user(user_id,notification_id)
) ENGINE=InnoDB;
