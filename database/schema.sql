-- MediDispense normalized MySQL schema
-- Tested for MySQL 8.x / MariaDB 10.6+. Import through phpMyAdmin after creating the database.
CREATE DATABASE IF NOT EXISTS medidispense CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE medidispense;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS notifications, activity_logs, stock_movements, dispensing_logs, dispensing_requests, payments, transaction_items, transactions, inventory, medicines, medicine_categories, machine_status, machine_slots, machines, system_settings, users, roles;

CREATE TABLE roles (
  id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code ENUM('super_admin','admin','staff') NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(24) NOT NULL UNIQUE,
  firebase_uid VARCHAR(128) NOT NULL UNIQUE,
  email VARCHAR(320) NOT NULL UNIQUE,
  display_name VARCHAR(160) NOT NULL,
  profile_image_url VARCHAR(500) NULL,
  contact_number VARCHAR(40) NULL,
  role_id TINYINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  archived_at DATETIME NULL,
  email_verified_at DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  INDEX idx_users_active_role (is_active, role_id)
) ENGINE=InnoDB;

CREATE TABLE medicine_categories (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE medicines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  generic_name VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  dosage_information TEXT NOT NULL,
  usage_instructions TEXT NOT NULL,
  image_url VARCHAR(500) NULL,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  expiry_date DATE NOT NULL,
  minimum_stock_level INT UNSIGNED NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_medicines_category FOREIGN KEY (category_id) REFERENCES medicine_categories(id),
  CONSTRAINT fk_medicines_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_medicines_expiry_enabled (expiry_date, is_enabled),
  INDEX idx_medicines_category (category_id)
) ENGINE=InnoDB;

CREATE TABLE inventory (
  medicine_id BIGINT UNSIGNED PRIMARY KEY,
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  last_counted_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE machines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  location VARCHAR(255) NULL,
  firmware_version VARCHAR(64) NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE machine_slots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  machine_id BIGINT UNSIGNED NOT NULL,
  slot_number SMALLINT UNSIGNED NOT NULL,
  medicine_id BIGINT UNSIGNED NULL,
  motor_id VARCHAR(64) NOT NULL,
  sensor_id VARCHAR(64) NOT NULL,
  slot_status ENUM('ready','low','empty','blocked') NOT NULL DEFAULT 'blocked',
  last_dispensing_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_slots_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  CONSTRAINT fk_slots_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE SET NULL,
  UNIQUE KEY uq_machine_slot_number (machine_id, slot_number),
  INDEX idx_slots_medicine (medicine_id)
) ENGINE=InnoDB;

CREATE TABLE machine_status (
  machine_id BIGINT UNSIGNED PRIMARY KEY,
  connection_status ENUM('online','offline') NOT NULL DEFAULT 'offline',
  esp32_status VARCHAR(100) NULL,
  motor_status VARCHAR(160) NULL,
  sensor_status VARCHAR(160) NULL,
  coin_acceptor_status VARCHAR(160) NULL,
  last_communication_at DATETIME NULL,
  last_payload JSON NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_machine_status_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_code VARCHAR(32) NOT NULL UNIQUE,
  machine_id BIGINT UNSIGNED NULL,
  customer_reference VARCHAR(160) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PHP',
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  change_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_status ENUM('pending','successful','failed','cancelled') NOT NULL DEFAULT 'pending',
  dispensing_status ENUM('pending','dispensing','dispensed','failed','timeout','cancelled') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE SET NULL,
  CONSTRAINT fk_transactions_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_transactions_created_status (created_at, payment_status, dispensing_status)
) ENGINE=InnoDB;

CREATE TABLE transaction_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  medicine_id BIGINT UNSIGNED NOT NULL,
  slot_id BIGINT UNSIGNED NULL,
  medicine_name_snapshot VARCHAR(180) NOT NULL,
  unit_price_snapshot DECIMAL(10,2) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  CONSTRAINT fk_items_slot FOREIGN KEY (slot_id) REFERENCES machine_slots(id) ON DELETE SET NULL,
  INDEX idx_items_medicine (medicine_id)
) ENGINE=InnoDB;

CREATE TABLE payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  payment_method ENUM('coin_acceptor','manual','test') NOT NULL DEFAULT 'coin_acceptor',
  amount_due DECIMAL(10,2) NOT NULL,
  amount_inserted DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('pending','successful','failed','cancelled') NOT NULL DEFAULT 'pending',
  provider_reference VARCHAR(160) NULL,
  raw_payload JSON NULL,
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  INDEX idx_payments_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE dispensing_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  machine_id BIGINT UNSIGNED NOT NULL,
  slot_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  request_status ENUM('queued','sent','dispensing','success','failed','timeout','cancelled') NOT NULL DEFAULT 'queued',
  command_reference VARCHAR(160) NOT NULL UNIQUE,
  command_payload JSON NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  completed_at DATETIME NULL,
  CONSTRAINT fk_dispense_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_dispense_machine FOREIGN KEY (machine_id) REFERENCES machines(id),
  CONSTRAINT fk_dispense_slot FOREIGN KEY (slot_id) REFERENCES machine_slots(id),
  INDEX idx_dispensing_status (request_status, requested_at)
) ENGINE=InnoDB;

CREATE TABLE dispensing_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dispensing_request_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('command_sent','motor_started','sensor_pulse','dispensed_successfully','dispensing_failed','timeout','cancelled') NOT NULL,
  sensor_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  motor_status VARCHAR(160) NULL,
  sensor_payload JSON NULL,
  event_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dispensing_logs_request FOREIGN KEY (dispensing_request_id) REFERENCES dispensing_requests(id) ON DELETE CASCADE,
  INDEX idx_dispensing_logs_event (event_type, event_at)
) ENGINE=InnoDB;

CREATE TABLE stock_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  medicine_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NULL,
  dispensing_request_id BIGINT UNSIGNED NULL,
  previous_quantity INT UNSIGNED NOT NULL,
  new_quantity INT UNSIGNED NOT NULL,
  change_quantity INT NOT NULL,
  change_type ENUM('purchase','successful_dispensing','manual_addition','adjustment','damaged','expired','failed_dispensing_reversal') NOT NULL,
  reason VARCHAR(255) NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  CONSTRAINT fk_stock_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  CONSTRAINT fk_stock_request FOREIGN KEY (dispensing_request_id) REFERENCES dispensing_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_stock_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_stock_movements_medicine_time (medicine_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_type ENUM('user','system','hardware') NOT NULL DEFAULT 'system',
  action VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  ip_address VARCHAR(64) NULL,
  device_information VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activity_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_activity_time_action (created_at, action)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notification_type ENUM('low_stock','out_of_stock','near_expiry','expired','dispensing_failure','payment_failure','system_error') NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('info','warning','danger') NOT NULL DEFAULT 'info',
  medicine_id BIGINT UNSIGNED NULL,
  transaction_id BIGINT UNSIGNED NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  INDEX idx_notifications_unread (is_read, created_at)
) ENGINE=InnoDB;

CREATE TABLE system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO roles (code, name, description) VALUES
 ('super_admin','Super Admin','Full system access and account management'),
 ('admin','Admin','Medicine and inventory management, reports, and operations monitoring'),
 ('staff','Staff – Monitoring/Operations','Read-only monitoring and operations access');
INSERT INTO medicine_categories (name) VALUES ('Pain Relief'),('Fever'),('Cold and Flu'),('Allergy'),('Vitamins'),('Other OTC Medicines');
INSERT INTO machines (machine_code, name, location, firmware_version) VALUES ('MD-001','MediDispense-01','Capstone laboratory','0.9.0');
INSERT INTO machine_status (machine_id, connection_status, esp32_status, motor_status, sensor_status, coin_acceptor_status, last_communication_at) VALUES (1,'online','Ready','Idle','Monitoring','Ready',CURRENT_TIMESTAMP);
INSERT INTO machine_slots (machine_id, slot_number, motor_id, sensor_id, slot_status) VALUES (1,1,'MOTOR-1','IR-1','ready'),(1,2,'MOTOR-2','IR-2','ready'),(1,3,'MOTOR-3','IR-3','low');
INSERT INTO system_settings (setting_key, setting_value) VALUES ('currency','PHP'),('near_expiry_days','30'),('machine_offline_seconds','60'),('low_stock_default','10');

SET FOREIGN_KEY_CHECKS = 1;

-- Firebase users are provisioned by the PHP sync endpoint after their Firebase ID token is verified.
-- No password hashes are stored in this schema.
