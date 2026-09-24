export const EMPLOYEE_ROLES = ["super_admin", "admin", "staff"] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const ROLE_LABELS: Record<EmployeeRole, string> = {
  super_admin: "SUPER ADMIN – System Owner",
  admin: "ADMIN – Inventory Manager",
  staff: "STAFF – Monitoring/Operations",
};

export const ROLE_PERMISSIONS = {
  super_admin: [
    "dashboard.view", "medicines.create", "medicines.view", "medicines.edit", "medicines.archive",
    "inventory.add", "inventory.update", "inventory.adjust", "inventory.view", "transactions.view", "dispensing.view",
    "reports.view", "reports.basic.view", "reports.export", "employees.create", "employees.view", "employees.edit", "employees.activate",
    "employees.archive", "employees.assign_roles", "activity_logs.view", "settings.manage", "machine.view", "machine.operate", "profile.manage",
  ],
  admin: [
    "dashboard.view", "medicines.create", "medicines.view", "medicines.edit", "medicines.archive",
    "inventory.add", "inventory.update", "inventory.adjust", "inventory.view", "transactions.view", "dispensing.view",
    "reports.view", "reports.basic.view", "reports.export", "machine.view", "machine.operate", "profile.manage",
  ],
  staff: [
    "dashboard.view", "medicines.view", "inventory.view", "transactions.view", "dispensing.view",
    "reports.basic.view", "machine.view", "machine.operate", "profile.manage",
  ],
} as const satisfies Record<EmployeeRole, readonly string[]>;

export function hasPermission(role: EmployeeRole, permission: string) {
  return (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission);
}
