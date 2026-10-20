import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { useLocation } from "wouter";
import { apiBaseUrl, firebaseAuth, firebaseConfigured } from "@/firebase";

export type AppRole = "super_admin" | "admin" | "staff";
export type UserProfile = {
  id?: number;
  employee_id?: string;
  firebase_uid?: string;
  email?: string;
  display_name?: string;
  contact_number?: string;
  profile_image_url?: string | null;
  role_code?: AppRole;
  is_active?: boolean;
};
type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const expiredMessage =
  "Your session expired due to inactivity. Please log in again.";
class AuthRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
  }
}
async function request(
  path: string,
  method = "POST",
  body?: unknown,
  user?: User | null
) {
  if (!apiBaseUrl) throw new Error("The login service is not configured.");
  const token = user ? await user.getIdToken() : null;
  const response = await fetch(`${apiBaseUrl}/api/auth/${path}`, {
    method,
    credentials: "include",
    signal: AbortSignal.timeout(path === "logout" ? 3000 : 20000),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new AuthRequestError(
      payload?.error?.message ?? "The login service is unavailable.",
      payload?.error?.code ?? "",
      response.status
    );
  return payload?.data;
}
export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [location, navigate] = useLocation();
  const kiosk = location.replace(/\/$/, "") === "/kiosk";
  const ending = useRef(false);
  const endSession = useCallback(async (message?: string) => {
    if (ending.current) return;
    ending.current = true;
    setProfile(null);
    setUser(null);
    setError(message ?? null);
    try {
      await request("logout", "POST", undefined, firebaseAuth?.currentUser);
    } catch {
      /* Expired sessions already fail closed on PHP. */
    } finally {
      if (firebaseAuth) await signOut(firebaseAuth).catch(() => undefined);
      sessionStorage.removeItem("firebase-id-token");
      setUser(null);
      setProfile(null);
      setLoading(false);
      setError(message ?? null);
      ending.current = false;
    }
  }, []);
  const refreshProfile = useCallback(async () => {
    if (!user || kiosk) return;
    try {
      const data = await request("profile", "POST", undefined, user);
      if (firebaseAuth?.currentUser?.uid === user.uid && !ending.current) {
        setProfile(data.profile);
        setError(null);
      }
    } catch (caught) {
      setProfile(null);
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not load the account profile.";
      if (
        caught instanceof AuthRequestError &&
        [401, 429].includes(caught.status)
      )
        await endSession(message);
      else setError(message);
    }
  }, [user, kiosk, endSession]);
  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(firebaseAuth, nextUser => {
      setUser(nextUser);
      setProfile(null);
      setLoading(false);
      if (!nextUser) sessionStorage.removeItem("firebase-id-token");
    });
  }, []);
  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);
  useEffect(() => {
    if (
      kiosk ||
      !user ||
      !profile ||
      !["admin", "super_admin"].includes(profile.role_code ?? "")
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastSent = 0;
    let inFlight = false;
    let pendingActivity = false;
    let activityTimer: ReturnType<typeof setTimeout> | undefined;
    const expire = async () => {
      if (stopped) return;
      // Another admin tab may have extended the shared PHP session.
      try {
        const data = await request("session", "GET", undefined, user);
        if (stopped) return;
        if (data.remaining_seconds > 0) {
          schedule(data.remaining_seconds);
          return;
        }
      } catch {
        /* Fail closed if the server cannot confirm a live session. */
      }
      if (!stopped) {
        void endSession(expiredMessage);
        navigate("/");
      }
    };
    const schedule = (seconds: number) => {
      clearTimeout(timer);
      timer = setTimeout(expire, Math.max(0, seconds) * 1000);
    };
    const sync = async (activity: boolean) => {
      if (stopped) return;
      if (inFlight) {
        pendingActivity ||= activity;
        return;
      }
      inFlight = true;
      try {
        const data = await request(
          activity ? "activity" : "session",
          activity ? "POST" : "GET",
          undefined,
          user
        );
        if (!stopped && typeof data.remaining_seconds === "number")
          schedule(data.remaining_seconds);
      } catch (caught) {
        if (
          !stopped &&
          caught instanceof AuthRequestError &&
          [401, 403, 429].includes(caught.status)
        ) {
          stopped = true;
          clearTimeout(timer);
          void endSession(
            caught.code === "SESSION_EXPIRED" ? expiredMessage : caught.message
          );
          navigate("/");
        }
      } finally {
        inFlight = false;
        if (pendingActivity && !stopped) {
          pendingActivity = false;
          void sync(true);
        }
      }
    };
    const activity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      clearTimeout(activityTimer);
      activityTimer = setTimeout(
        () => {
          lastSent = Date.now();
          void sync(true);
        },
        Math.max(0, 1000 - (Date.now() - lastSent))
      );
    };
    schedule(300);
    void sync(false);
    const poll = setInterval(() => void sync(false), 5000);
    const events = [
      "pointerdown",
      "keydown",
      "touchstart",
      "click",
      "popstate",
    ];
    events.forEach(event =>
      window.addEventListener(event, activity, { passive: true })
    );
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(activityTimer);
      clearInterval(poll);
      events.forEach(event => window.removeEventListener(event, activity));
    };
  }, [kiosk, user, profile?.role_code, endSession, navigate]);
  const signIn = async (email: string, password: string) => {
    if (!firebaseAuth) throw new Error("Firebase is not configured.");
    setError(null);
    try {
      // PHP verifies the password with Firebase and grants a server session first.
      await request("login", "POST", { email: email.trim(), password });
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    } catch (caught) {
      const message =
        caught instanceof AuthRequestError
          ? caught.message
          : "Unable to sign in. Please try again.";
      setError(message);
      throw new Error(message);
    }
  };
  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        configured: firebaseConfigured,
        error,
        signIn,
        resetPassword: async email => {
          if (!firebaseAuth) throw new Error("Firebase is not configured.");
          await sendPasswordResetEmail(firebaseAuth, email.trim());
        },
        resendVerification: async () => {
          if (!user) throw new Error("You are not signed in.");
          await sendEmailVerification(user);
        },
        logout: () => endSession(),
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useFirebaseAuth() {
  const value = useContext(AuthContext);
  if (!value)
    throw new Error("useFirebaseAuth must be used inside FirebaseAuthProvider");
  return value;
}
