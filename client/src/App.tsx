import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CheckCircle2, LogOut, MailCheck, ShieldCheck, Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { FirebaseAuthProvider, useFirebaseAuth } from "./contexts/FirebaseAuthContext";
import Home from "./pages/Home";
import Kiosk from "./pages/Kiosk";
import Login from "./pages/Login";
import { useLocation } from "wouter";
import { toast } from "sonner";

function VerificationGate() { const auth = useFirebaseAuth(); const resend = async () => { try { await auth.resendVerification(); toast.success("Verification email sent."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not send verification email."); } }; return <div className="auth-shell"><div className="auth-brand"><div className="brand-mark"><ShieldCheck size={21} /></div><div><strong>Medi<span>Dispense</span></strong><small>SECURE CONTROL CENTER</small></div></div><div className="verification-card"><div className="verification-icon"><MailCheck size={28} /></div><div className="auth-kicker">EMAIL VERIFICATION REQUIRED</div><h1>Check your inbox.</h1><p>We sent a verification link to <strong>{auth.user?.email}</strong>. Verify your email, then return here and refresh the page.</p><div className="verification-actions"><button className="primary-button" onClick={() => window.location.reload()}><CheckCircle2 size={15} /> I verified my email</button><button className="secondary-button" onClick={resend}>Resend email</button><button className="auth-text-button" onClick={() => void auth.logout()}><LogOut size={14} /> Sign out</button></div></div></div>; }
function AdminGate() { const auth = useFirebaseAuth(); if (!auth.configured) return <Home />; if (auth.loading) return <div className="auth-loading"><Loader2 size={22} className="spin" /> Checking secure session...</div>; if (!auth.user) return <Login />; if (!auth.user.emailVerified) return <VerificationGate />; return <Home />; }
function Router() { const [location] = useLocation(); return location === "/kiosk" ? <Kiosk /> : <AdminGate />; }
export default function App() { return <ErrorBoundary><ThemeProvider defaultTheme="light"><FirebaseAuthProvider><TooltipProvider><Toaster position="top-center" richColors closeButton duration={3500} visibleToasts={3} /><Router /></TooltipProvider></FirebaseAuthProvider></ThemeProvider></ErrorBoundary>; }
