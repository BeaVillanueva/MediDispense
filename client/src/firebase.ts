import { deleteApp, getApp, getApps, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth, sendEmailVerification, signOut, updateProfile } from "firebase/auth";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
export const firebaseApp = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const firebaseStorage = firebaseApp ? getStorage(firebaseApp) : null;
export { apiBaseUrl } from "./lib/apiConfig";

export async function uploadEmployeeProfilePhoto(file: File, uid: string) {
  if (!firebaseStorage) throw new Error("Firebase Storage is not configured.");
  const ownerUid = firebaseAuth?.currentUser?.uid ?? uid;
  const path = `profile-photos/${ownerUid}-${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
  const storageRef = ref(firebaseStorage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}

export async function createEmployeeAuthAccount(email: string, password: string, displayName: string) {
  if (!firebaseConfigured) throw new Error("Firebase is not configured.");
  const app = initializeApp(firebaseConfig, `employee-provision-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const auth = getAuth(app);
  let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>["user"] | null = null;
  try {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    createdUser = credential.user;
    await updateProfile(credential.user, { displayName: displayName.trim() });
    await sendEmailVerification(credential.user);
    return {
      firebaseUid: credential.user.uid,
      dispose: async () => { await signOut(auth); await deleteApp(app); },
      rollback: async () => { if (createdUser) await deleteUser(createdUser).catch(() => undefined); await signOut(auth).catch(() => undefined); await deleteApp(app); },
    };
  } catch (error) {
    if (createdUser) await deleteUser(createdUser).catch(() => undefined);
    await signOut(auth).catch(() => undefined);
    await deleteApp(app);
    throw error;
  }
}
