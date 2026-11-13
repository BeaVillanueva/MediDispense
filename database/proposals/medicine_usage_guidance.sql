-- PROPOSAL ONLY: not applied or included in setup/migration runners.
-- Separate, append-only clinical review revisions; existing medicine records are untouched.
CREATE TABLE medicine_usage_guidance (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  medicine_id BIGINT UNSIGNED NOT NULL,
  identity_snapshot JSON NOT NULL,
  medicine_name VARCHAR(180) NOT NULL,
  strength VARCHAR(100) NOT NULL,
  formulation VARCHAR(100) NOT NULL,
  purpose TEXT NOT NULL,
  age_group VARCHAR(180) NOT NULL,
  recommended_dose TEXT NOT NULL,
  frequency TEXT NOT NULL,
  minimum_interval TEXT NULL,
  maximum_daily_dose TEXT NULL,
  precautions TEXT NOT NULL,
  source_label VARCHAR(255) NOT NULL,
  source_url VARCHAR(1000) NOT NULL,
  approval_status ENUM('draft','approved','revoked') NOT NULL DEFAULT 'draft',
  product_identity_verified TINYINT(1) NOT NULL DEFAULT 0,
  pharmacist_name VARCHAR(180) NULL,
  pharmacist_registration VARCHAR(180) NULL,
  approved_at DATETIME NULL,
  review_due_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX medicine_revision (medicine_id,id),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);
