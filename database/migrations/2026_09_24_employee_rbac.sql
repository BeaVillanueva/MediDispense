-- Normalize employee roles to the three supported RBAC roles.
UPDATE users u
JOIN roles old_role ON old_role.id = u.role_id
JOIN roles staff_role ON staff_role.code = 'staff'
SET u.role_id = staff_role.id
WHERE old_role.code NOT IN ('super_admin', 'admin', 'staff');

DELETE FROM roles WHERE code NOT IN ('super_admin', 'admin', 'staff');
UPDATE roles SET name = 'Staff – Monitoring/Operations', description = 'Read-only monitoring and operations access' WHERE code = 'staff';
UPDATE roles SET name = 'Super Admin', description = 'Full system access and account management' WHERE code = 'super_admin';
UPDATE roles SET name = 'Admin', description = 'Medicine and inventory management, reports, and operations monitoring' WHERE code = 'admin';

ALTER TABLE roles MODIFY code ENUM('super_admin', 'admin', 'staff') NOT NULL;
