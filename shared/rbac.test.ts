import { describe, expect, it } from "vitest";
import { EMPLOYEE_ROLES, hasPermission, ROLE_PERMISSIONS } from "./rbac";

describe("MediDispense RBAC", () => {
  it("defines exactly the three employee roles", () => {
    expect(EMPLOYEE_ROLES).toEqual(["super_admin", "admin", "staff"]);
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual(["super_admin", "admin", "staff"]);
  });

  it("gives Super Admin the full system-owner permission set", () => {
    for (const permission of [
      "dashboard.view", "medicines.create", "medicines.edit", "medicines.archive", "inventory.adjust",
      "transactions.view", "reports.export", "employees.create", "employees.assign_roles", "activity_logs.view",
      "settings.manage", "machine.view", "profile.manage",
    ]) expect(hasPermission("super_admin", permission)).toBe(true);
  });

  it("does not grant employee management or settings to Admin and Staff", () => {
    for (const role of ["admin", "staff"] as const) {
      expect(hasPermission(role, "employees.create")).toBe(false);
      expect(hasPermission(role, "employees.assign_roles")).toBe(false);
      expect(hasPermission(role, "settings.manage")).toBe(false);
    }
  });

  it("gives Admin inventory, archive, reports, and machine monitoring without owner controls", () => {
    for (const permission of ["medicines.create", "medicines.edit", "medicines.archive", "inventory.adjust", "transactions.view", "reports.view", "reports.export", "machine.view", "machine.operate"]) {
      expect(hasPermission("admin", permission)).toBe(true);
    }
    for (const permission of ["employees.view", "employees.archive", "employees.assign_roles", "activity_logs.view", "settings.manage"]) {
      expect(hasPermission("admin", permission)).toBe(false);
    }
  });

  it("keeps Staff monitoring-only for catalog and inventory mutations", () => {
    expect(hasPermission("staff", "medicines.view")).toBe(true);
    expect(hasPermission("staff", "inventory.view")).toBe(true);
    expect(hasPermission("staff", "medicines.create")).toBe(false);
    expect(hasPermission("staff", "inventory.adjust")).toBe(false);
    expect(hasPermission("staff", "reports.basic.view")).toBe(true);
    expect(hasPermission("staff", "reports.export")).toBe(false);
    expect(hasPermission("staff", "employees.view")).toBe(false);
    expect(hasPermission("staff", "settings.manage")).toBe(false);
    expect(hasPermission("staff", "profile.manage")).toBe(true);
  });
});
