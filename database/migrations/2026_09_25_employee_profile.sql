-- Reuse users.profile_image_url and add a permanent employee identifier.
ALTER TABLE users
  ADD COLUMN employee_id VARCHAR(24) NULL AFTER id;

UPDATE users SET employee_id = CONCAT('EMP-', LPAD(id, 4, '0')) WHERE employee_id IS NULL OR employee_id = '';

ALTER TABLE users
  MODIFY employee_id VARCHAR(24) NOT NULL,
  ADD UNIQUE KEY uq_users_employee_id (employee_id);
