import { useEffect, useState } from "react";
import { useFirebaseAuth } from "@/contexts/FirebaseAuthContext";
import { apiBaseUrl } from "@/firebase";
import { ROLE_LABELS } from "@shared/rbac";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import { encodeProfilePhoto } from "@/lib/profilePhoto";
import { toast } from "sonner";

import { acceptContactInput, acceptNameInput, validateAccountFields } from "@/lib/accountValidation";

export default function ProfilePanel() {
  const auth = useFirebaseAuth();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(auth.profile?.display_name ?? auth.user?.displayName ?? ""); setContact(auth.profile?.contact_number ?? ""); setPhotoPreview(auth.profile?.profile_image_url ?? null); }, [auth.profile, auth.user?.displayName]);
  useEffect(() => { if (!photo) return; const url = URL.createObjectURL(photo); setPhotoPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  const submit = async (action: () => Promise<void>, success: string) => { setBusy(true); try { await action(); toast.success(success); } catch (error) { toast.error(error instanceof Error ? error.message : "Update failed."); } finally { setBusy(false); } };
  const profileRequest = async (path: string, method: string, body?: unknown) => {
    if (!auth.user || !apiBaseUrl) throw new Error("Connect Firebase and the PHP API to update your profile.");
    const token = await auth.user.getIdToken(true);
    const response = await fetch(`${apiBaseUrl}${path}`, { method, credentials: "include", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? `Request failed (${response.status}). Check the PHP API and Firebase token.`);
    return payload?.data;
  };
  const saveProfile = async () => {
    const displayName = name;
    validateAccountFields(displayName, contact);
    await profileRequest("/api/profile", "PATCH", { display_name: displayName, contact_number: contact.trim() });
    await auth.refreshProfile();
  };
  const upload = async () => {
    if (!photo) throw new Error("Choose a photo first.");
    const encoded = await encodeProfilePhoto(photo);
    await profileRequest("/api/profile/photo", "POST", encoded);
    setPhoto(null);
    await auth.refreshProfile();
  };
  const removePhoto = async () => {
    await profileRequest("/api/profile/photo", "DELETE");
    setPhoto(null);
    setPhotoPreview(null);
    await auth.refreshProfile();
  };
  return <div className="page-stack"><section className="panel profile-panel"><div className="panel-head"><div><div className="panel-kicker">MY ACCOUNT</div><h2>Profile settings</h2></div></div><div className="profile-photo-row"><EmployeeAvatar name={name || "Employee"} imageUrl={photoPreview} className="avatar profile-avatar" /><div className="profile-photo-controls"><div>Profile picture<label className="file-picker"><span>{photo?.name ?? "No file selected"}</span><b>Choose file</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></label></div><small>JPG, PNG, or WebP Ã‚Â· Maximum 2 MB</small><div className="toolbar-actions"><button className="secondary-button" disabled={busy || !photo} onClick={() => void submit(upload, "Profile photo updated")}>Upload photo</button><button className="panel-link" disabled={busy || (!auth.profile?.profile_image_url && !photoPreview)} onClick={() => void submit(removePhoto, "Profile photo removed")}>Remove photo</button></div></div></div><div className="form-grid profile-fields"><label>Employee name<input maxLength={160} pattern="[A-Za-z0-9 .,'-]+" value={name} onChange={e => { const value = acceptNameInput(e.target.value); if (value !== null) setName(value); }} /></label><label>Employee ID<input value={auth.profile?.employee_id ?? ""} disabled /></label><label>Email<input value={auth.profile?.email ?? auth.user?.email ?? ""} disabled /></label><label>Role<input value={auth.profile?.role_code ? ROLE_LABELS[auth.profile.role_code] : "Staff"} disabled /></label><label>Contact number<input maxLength={40} pattern="[0-9+() -]*" value={contact} onChange={e => { const value = acceptContactInput(e.target.value); if (value !== null) setContact(value); }} /></label></div><div className="modal-actions"><button className="primary-button" disabled={busy || !name.trim()} onClick={() => void submit(saveProfile, "Profile updated")}>Save profile</button></div></section></div>;
}
