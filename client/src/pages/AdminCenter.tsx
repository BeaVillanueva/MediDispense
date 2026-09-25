import { useEffect, useState } from "react";
import { useFirebaseAuth, type AppRole } from "@/contexts/FirebaseAuthContext";
import { apiBaseUrl, createEmployeeAuthAccount, uploadEmployeeProfilePhoto } from "@/firebase";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import { toast } from "sonner";

import { Eye, EyeOff } from "lucide-react";

import { acceptContactInput, acceptEmailInput, acceptEmployeeIdInput, acceptNameInput, hasRestrictedCharacters, validateAccountFields } from "@/lib/accountValidation";

type Employee = { id: number; employee_id: string; firebase_uid: string; email: string; display_name: string; contact_number?: string | null; profile_image_url?: string | null; is_active: number | string | boolean; role_code: AppRole; role_name: string; created_at: string; last_login_at?: string | null };
type Setting = { setting_key: string; setting_value: string; updated_at: string };
type Log = { id: number; display_name?: string; email?: string; actor_type: string; action: string; description: string; created_at: string };
type Tab = "employees" | "activity" | "settings";

export default function AdminCenter({ tab }: { tab: Tab }) {
  const auth = useFirebaseAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [createPhoto, setCreatePhoto] = useState<File | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editContact, setEditContact] = useState("");
  const [editRole, setEditRole] = useState<AppRole>("staff");
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [newEmployee, setNewEmployee] = useState({ email: "", display_name: "", employee_id: "", contact_number: "", password: "", role_code: "staff" as AppRole });
  const [busy, setBusy] = useState(false);
  const request = async (path: string, method = "GET", body?: unknown) => {
    if (!auth.user || !apiBaseUrl) throw new Error("Connect Firebase and the PHP API to manage system data.");
    const token = await auth.user.getIdToken();
    const response = await fetch(`${apiBaseUrl}/api/${path}`, { method, credentials: "include", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(payload?.error?.message ?? "The request could not be completed.");
    return payload?.data;
  };
  const load = async () => {
    try {
      if (tab === "employees") setEmployees(await request("users"));
      if (tab === "activity") setLogs(await request("logs"));
      if (tab === "settings") setSettings(await request("settings"));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load this section."); }
  };
  useEffect(() => { void load(); }, [tab, auth.user]);
  const mutate = async (work: () => Promise<unknown>, success: string) => { setBusy(true); try { await work(); toast.success(success); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : "Action failed."); } finally { setBusy(false); } };
  const employeeIsActive = (employee: Employee) => Number(employee.is_active) === 1 || employee.is_active === true;
  const createEmployee = async () => mutate(async () => {
    const account = await createEmployeeAuthAccount(newEmployee.email, newEmployee.password, newEmployee.display_name);
    try {
      const photoUrl = createPhoto ? await uploadEmployeeProfilePhoto(createPhoto, account.firebaseUid) : null;
      await request("users", "POST", { firebase_uid: account.firebaseUid, email: newEmployee.email, display_name: newEmployee.display_name, employee_id: newEmployee.employee_id, contact_number: newEmployee.contact_number, role_code: newEmployee.role_code, profile_image_url: photoUrl, email_verified: false });
      await account.dispose();
      setNewEmployee({ email: "", display_name: "", employee_id: "", contact_number: "", password: "", role_code: "staff" });
      setCreatePhoto(null);
    } catch (error) { await account.rollback(); throw error; }
  }, "Employee account created; verification email sent");
  const openEmployee = (employee: Employee, editing: boolean) => { setSelectedEmployee(employee); setEditMode(editing); setEditName(employee.display_name); setEditContact(employee.contact_number ?? ""); setEditRole(employee.role_code); setEditPhoto(null); };
  const saveEmployee = async () => mutate(async () => {
    if (!selectedEmployee) throw new Error("Select an employee before saving changes.");
    const displayName = editName;

    validateAccountFields(displayName, editContact);
    if (!displayName) throw new Error("Employee name is required.");
    let profileImageUrl = selectedEmployee.profile_image_url ?? null;
    if (editPhoto) profileImageUrl = await uploadEmployeeProfilePhoto(editPhoto, selectedEmployee.firebase_uid);
    await request(`users/${selectedEmployee.id}`, "PATCH", { display_name: displayName, contact_number: editContact.trim(), role_code: editRole, profile_image_url: profileImageUrl });
    setSelectedEmployee(null);
  }, "Employee updated");

  if (tab === "employees") return <div className="page-stack"><section className="panel"><div className="panel-head"><div><div className="panel-kicker">SYSTEM OWNER</div><h2>Employee access</h2></div></div><div id="new-employee-form" className="form-grid employee-create-form"><label>Employee ID<input value={newEmployee.employee_id} onChange={e => { const value = acceptEmployeeIdInput(e.target.value); if (value !== null) setNewEmployee({ ...newEmployee, employee_id: value }); }} placeholder="EMP-0001" maxLength={24} pattern="EMP-[A-Za-z0-9-]+" required /></label><label>Email<input type="email" maxLength={320} value={newEmployee.email} onChange={e => { const value = acceptEmailInput(e.target.value); if (value !== null) setNewEmployee({ ...newEmployee, email: value }); }} onPaste={e => { if (acceptEmailInput(e.clipboardData.getData("text")) === null) e.preventDefault(); }} required /></label><label>Employee name<input maxLength={160} pattern="[A-Za-z0-9 .,'-]+" value={newEmployee.display_name} onChange={e => { const value = acceptNameInput(e.target.value); if (value !== null) setNewEmployee({ ...newEmployee, display_name: value }); }} required /></label><label>Contact number<input maxLength={40} pattern="[0-9+() -]*" value={newEmployee.contact_number} onChange={e => { const value = acceptContactInput(e.target.value); if (value !== null) setNewEmployee({ ...newEmployee, contact_number: value }); }} /></label><label>Initial password<input type="password" minLength={6} maxLength={20} autoComplete="new-password" value={newEmployee.password} onChange={e => { const value = e.target.value; if (!hasRestrictedCharacters(value) && !/\\s/.test(value)) setNewEmployee({ ...newEmployee, password: value }); }} onPaste={e => { const value = e.clipboardData.getData("text"); if (hasRestrictedCharacters(value) || /\\s/.test(value)) e.preventDefault(); }} required /></label><label>Role<select value={newEmployee.role_code} onChange={e => setNewEmployee({ ...newEmployee, role_code: e.target.value as AppRole })}><option value="super_admin">SUPER ADMIN - System Owner</option><option value="admin">ADMIN - Inventory Manager</option><option value="staff">STAFF - Monitoring/Operations</option></select></label><div>Profile photo<label className="file-picker"><span>{createPhoto?.name ?? "No file selected"}</span><b>Choose file</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setCreatePhoto(e.target.files?.[0] ?? null)} /></label></div></div><button className="primary-button" disabled={busy || !newEmployee.email || !newEmployee.display_name || !newEmployee.employee_id || newEmployee.password.length < 6} onClick={() => void createEmployee()}>Create employee account</button></section><section className="panel"><div className="table-wrap"><table className="employee-table"><thead><tr><th>Photo</th><th>Employee ID</th><th>Employee</th><th>Email</th><th>Contact</th><th>Role</th><th>Status</th><th>Created</th><th>Last login</th><th>Access</th></tr></thead><tbody>{employees.map(employee => <tr key={employee.id}><td><EmployeeAvatar name={employee.display_name} imageUrl={employee.profile_image_url} className="avatar small" /></td><td>{employee.employee_id}</td><td><strong>{employee.display_name}</strong></td><td><small>{employee.email}</small></td><td>{employee.contact_number || "-"}</td><td><select value={employee.role_code} disabled={busy || employee.id === auth.profile?.id} onChange={e => void mutate(() => request(`users/${employee.id}`, "PATCH", { role_code: e.target.value }), "Role updated")}><option value="super_admin">SUPER ADMIN - System Owner</option><option value="admin">ADMIN - Inventory Manager</option><option value="staff">STAFF - Monitoring/Operations</option></select></td><td>{employeeIsActive(employee) ? "Active" : "Inactive"}</td><td>{new Date(employee.created_at).toLocaleDateString()}</td><td>{employee.last_login_at ? new Date(employee.last_login_at).toLocaleString() : "Never"}</td><td><button className="secondary-button action-edit" disabled={busy || employee.id === auth.profile?.id} onClick={() => openEmployee(employee, true)}>Edit</button> <button className="secondary-button action-view" disabled={busy} onClick={() => openEmployee(employee, false)}>View</button> <button className={`secondary-button ${employeeIsActive(employee) ? "action-deactivate" : "action-activate"}`} disabled={busy || employee.id === auth.profile?.id} onClick={() => void mutate(() => request(`users/${employee.id}`, "PATCH", { is_active: !employeeIsActive(employee) }), employeeIsActive(employee) ? "Employee deactivated" : "Employee activated")}>{employeeIsActive(employee) ? "Deactivate" : "Activate"}</button> <button className="secondary-button action-reset" disabled={busy} onClick={() => void mutate(() => auth.resetPassword(employee.email), "Password reset email sent")}>Reset password</button></td></tr>)}</tbody></table></div></section>{selectedEmployee && <div className="modal-backdrop" onClick={() => setSelectedEmployee(null)}><div className="modal-card" onClick={event => event.stopPropagation()}><div className="panel-head"><div><div className="panel-kicker">EMPLOYEE PROFILE</div><h2>{editMode ? "Edit employee" : "Employee details"}</h2></div></div><div className={`profile-photo-row ${editMode ? "editing" : "viewing"}`}><EmployeeAvatar name={selectedEmployee.display_name} imageUrl={editPhoto ? URL.createObjectURL(editPhoto) : selectedEmployee.profile_image_url} className="avatar profile-avatar" />{editMode && <label className="file-picker"><span>{editPhoto?.name ?? "No file selected"}</span><b>Choose file</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setEditPhoto(e.target.files?.[0] ?? null)} /></label>}</div><div className="form-grid employee-edit-fields"><label>Employee ID<input value={selectedEmployee.employee_id} readOnly /></label><label>Email<input value={selectedEmployee.email} readOnly /></label></div>{editMode ? <div className="form-grid employee-edit-fields"><label>Name<input maxLength={160} pattern="[A-Za-z0-9 .,'-]+" value={editName} onChange={e => { const value = acceptNameInput(e.target.value); if (value !== null) setEditName(value); }} /></label><label>Contact number<input maxLength={40} pattern="[0-9+() -]*" value={editContact} onChange={e => { const value = acceptContactInput(e.target.value); if (value !== null) setEditContact(value); }} /></label><label>Role<select value={editRole} onChange={e => setEditRole(e.target.value as AppRole)}><option value="admin">ADMIN - Inventory Manager</option><option value="staff">STAFF - Monitoring/Operations</option><option value="super_admin">SUPER ADMIN - System Owner</option></select></label></div> : <div className="form-grid employee-view-fields"><label>Name<input value={selectedEmployee.display_name} readOnly /></label><label>Contact number<input value={selectedEmployee.contact_number || "Not provided"} readOnly /></label><label>Role<input value={selectedEmployee.role_name} readOnly /></label><label>Status<input value={employeeIsActive(selectedEmployee) ? "Active" : "Inactive"} readOnly /></label></div>}<div className="page-toolbar">{editMode ? <><button className="primary-button" disabled={busy} onClick={() => void saveEmployee()}>{busy ? "Saving..." : "Save changes"}</button><button className="secondary-button" disabled={busy} onClick={() => { setSelectedEmployee(null); setEditMode(false); }}>Cancel</button></> : <button className="primary-button" disabled={selectedEmployee.id === auth.profile?.id} onClick={() => setEditMode(true)}>Edit</button>}</div></div></div>}</div>;
  if (tab === "settings") return <div className="page-stack"><section className="panel"><div className="panel-head"><div><div className="panel-kicker">SYSTEM OWNER</div><h2>System settings</h2></div></div>{settings.map(setting => <div className="page-toolbar" key={setting.setting_key}><label>{setting.setting_key}<input value={setting.setting_value} onChange={e => setSettings(rows => rows.map(row => row.setting_key === setting.setting_key ? { ...row, setting_value: e.target.value } : row))} /></label><button className="secondary-button" disabled={busy} onClick={() => void mutate(() => request("settings", "PATCH", setting), "Setting saved")}>Save</button></div>)}</section></div>;
  return <div className="page-stack"><section className="panel"><div className="panel-head"><div><div className="panel-kicker">SYSTEM OWNER</div><h2>Activity log</h2></div></div><div className="table-wrap"><table><thead><tr><th>When</th><th>Employee</th><th>Action</th><th>Details</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.display_name ?? log.email ?? log.actor_type}</td><td>{log.action}</td><td>{log.description}</td></tr>)}</tbody></table></div></section></div>;
}

