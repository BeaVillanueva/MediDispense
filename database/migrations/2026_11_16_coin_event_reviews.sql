-- Additive, manual migration. Never updates transactions, payments, journals or inventory.
CREATE TABLE coin_review_attestations (
  nonce CHAR(32) PRIMARY KEY,
  machine_id BIGINT UNSIGNED NOT NULL,
  device_id CHAR(12) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_coin_review_device (machine_id,device_id,created_at)
) ENGINE=InnoDB;
CREATE TABLE coin_event_reviews (
  id CHAR(32) PRIMARY KEY,
  machine_id BIGINT UNSIGNED NOT NULL,
  device_id CHAR(12) NOT NULL,
  event_id VARCHAR(100) NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  attestation_nonce CHAR(32) NOT NULL,
  decision_nonce CHAR(32) NOT NULL,
  event_payload JSON NOT NULL,
  decision VARCHAR(40) NOT NULL,
  original_payment_event_id VARCHAR(100) NOT NULL,
  verified_total DECIMAL(10,2) NOT NULL,
  notes TEXT NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_coin_review_event (machine_id,device_id,event_id)
) ENGINE=InnoDB;
CREATE TABLE coin_event_review_acks (
  review_id CHAR(32) PRIMARY KEY,
  archive_hash CHAR(64) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
