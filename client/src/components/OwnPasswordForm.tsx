import { useRef, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { useFirebaseAuth } from "@/contexts/FirebaseAuthContext";
import { toast } from "sonner";

/** Firebase owns passwords; none are sent to the employee profile API. */
export function OwnPasswordForm() {
  const auth = useFirebaseAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const change = async () => {
    if (lock.current || !auth.user?.email || !current || next.length < 6 || next !== confirm) return;
    lock.current = true; setBusy(true);
    try {
      await reauthenticateWithCredential(auth.user, EmailAuthProvider.credential(auth.user.email, current));
      await updatePassword(auth.user, next);
      setCurrent(""); setNext(""); setConfirm("");
      toast.success("Password changed. Sign in again with your new password.");
      await auth.logout();
    } catch (error) {
      const code = (error as { code?: string }).code;
      toast.error(code === "auth/invalid-credential" || code === "auth/wrong-password" ? "Current password is incorrect." : code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements" ? "The new password does not meet the configured password policy." : code === "auth/too-many-requests" ? "Too many attempts. Please try again later." : "Could not change password. Check your connection and sign in again if needed.");
    } finally { lock.current = false; setBusy(false); }
  };
  return <section className="employee-edit-fields"><h3>Change your password</h3><p className="page-subtitle">Your current password is required. Changing your password signs you out.</p><div className="form-grid"><label>Current password<input type="password" autoComplete="current-password" value={current} disabled={busy} onChange={e => setCurrent(e.target.value)} /></label><label>New password<input type="password" autoComplete="new-password" minLength={6} value={next} disabled={busy} onChange={e => setNext(e.target.value)} /></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirm} disabled={busy} onChange={e => setConfirm(e.target.value)} /></label></div>{confirm && next !== confirm && <p role="alert">Passwords do not match.</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy || !current || next.length < 6 || next !== confirm} onClick={() => void change()}>{busy ? "Updating password…" : "Change password"}</button></div></section>;
}
