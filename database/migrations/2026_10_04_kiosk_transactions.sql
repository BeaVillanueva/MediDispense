-- Additive migration. Apply once to the existing database; never reimport schema.sql.
ALTER TABLE inventory ADD COLUMN reserved_quantity INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE transactions
  ADD COLUMN checkout_key CHAR(64) NULL,
  ADD COLUMN access_token_hash CHAR(64) NULL,
  ADD COLUMN expires_at DATETIME NULL,
  ADD UNIQUE KEY uq_checkout_key (checkout_key);
ALTER TABLE dispensing_requests ADD COLUMN dispensed_quantity INT UNSIGNED NOT NULL DEFAULT 0;
-- Completed historical requests already represent their full quantity.
UPDATE dispensing_requests SET dispensed_quantity=quantity WHERE request_status='success';
ALTER TABLE dispensing_logs
  ADD COLUMN unit_number INT UNSIGNED NULL,
  ADD UNIQUE KEY uq_dispense_unit (dispensing_request_id, unit_number);
CREATE TABLE payment_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  event_id VARCHAR(100) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_coin_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  UNIQUE KEY uq_coin_event (transaction_id,event_id)
) ENGINE=InnoDB;
