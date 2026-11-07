import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./ui/sheet";

export function useDashboardNavigation() {
  const [mobile,setMobile]=useState(() => window.innerWidth < 768);
  const [collapsed,setCollapsed]=useState(() => { try { return localStorage.getItem("medidispense-sidebar-collapsed") === "true"; } catch { return false; } });
  const [open,setOpen]=useState(false);
  useEffect(() => { const media=window.matchMedia("(max-width: 767px)"); const update=()=>{setMobile(media.matches);setOpen(false);}; media.addEventListener("change",update); return ()=>media.removeEventListener("change",update); },[]);
  const toggle=()=>{ if(mobile) {setOpen(value=>!value);return;} setCollapsed(value=>{try {localStorage.setItem("medidispense-sidebar-collapsed",String(!value));}catch{} return !value;}); };
  return {mobile,collapsed,open,setOpen,toggle};
}
export type NavigationState = ReturnType<typeof useDashboardNavigation>;
export function NavigationToggle({ state }: {state:NavigationState}) {
  const label=state.mobile?"Open navigation":state.collapsed?"Expand sidebar":"Collapse sidebar";
  return <button className="icon-button navigation-toggle" aria-label={label} title={label} aria-expanded={state.mobile?state.open:!state.collapsed} aria-controls="dashboard-navigation" onClick={state.toggle}><Menu size={19}/></button>;
}
export function DashboardNavigation({state,children}:{state:NavigationState;children:ReactNode}) {
  if(!state.mobile) return <div className={`desktop-navigation ${state.collapsed?"is-collapsed":""}`}>{children}</div>;
  return <Sheet open={state.open} onOpenChange={state.setOpen}><SheetContent side="left" className="dashboard-navigation-drawer" onCloseAutoFocus={event=>{event.preventDefault();document.querySelector<HTMLButtonElement>(".navigation-toggle")?.focus();}}><SheetTitle className="sr-only">MediDispense navigation</SheetTitle><SheetDescription className="sr-only">Choose a dashboard page.</SheetDescription>{children}</SheetContent></Sheet>;
}
