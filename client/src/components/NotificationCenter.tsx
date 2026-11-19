import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, PackageMinus, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Alert } from "@shared/medidispense";
import { notificationSummary, productionNotifications } from "@/lib/notifications";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import "./notification-center.css";

const date = (value?: string | null) => value ? new Date(value.replace(" ", "T")).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";
export function NotificationCenter({ alerts }: { alerts: Alert[]; onNavigate: (kind?: string) => void }) {
  const [open,setOpen]=useState(false);
  const [confirmClear,setConfirmClear]=useState(false);
  const [clearThrough,setClearThrough]=useState(0);
  const area=useRef<HTMLDivElement>(null);
  const utils=trpc.useUtils();
  const dismiss=trpc.notifications.dismiss.useMutation({
    onSuccess:(_result,input)=>{
      utils.notifications.list.setData(undefined,current=>current?.filter(a=>a.id!==input.id));
      void utils.notifications.invalidate();
    },onError:e=>toast.error(e.message),
  });
  const clear=trpc.notifications.dismissAll.useMutation({
    onSuccess:(_result,input)=>{
      utils.notifications.list.setData(undefined,current=>current?.filter(a=>a.id>input.throughId));
      setConfirmClear(false);
      void utils.notifications.invalidate();toast.success("Notifications cleared for your account.");
    },onError:e=>toast.error(e.message),
  });
  useEffect(()=>{
    if(!open||confirmClear)return;
    const close=(event:PointerEvent)=>{if(event.target instanceof Node&&!area.current?.contains(event.target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};
  },[open,confirmClear]);
  const visible=productionNotifications(alerts);
  const unread=visible.filter(a=>!a.read).length;
  return <div className="notification-area" ref={area}>
    <button className="icon-button notification-button" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} aria-controls="md-notification-panel" onClick={()=>setOpen(v=>!v)}><Bell size={17}/>{unread>0&&<span>{unread}</span>}</button>
    {open&&<section id="md-notification-panel" className="notification-panel md-alert-center" aria-label="Notification center">
      <div className="md-alert-header"><strong>Notifications <span>· {unread} unread</span></strong><div>
        <button className="md-alert-clear" disabled={!visible.length||clear.isPending||dismiss.isPending} onClick={()=>{setClearThrough(Math.max(...visible.map(a=>a.id)));setConfirmClear(true);}}>Clear All</button>
        <button className="md-alert-close" aria-label="Close notifications" onClick={()=>setOpen(false)}><X size={18}/></button>
      </div></div>
      <div className="md-alert-scroll">
        {visible.length?<ul className="md-alert-list">{visible.map(a=>{
          const info=notificationSummary(a);
          return <li key={a.id}><article className={`md-alert-card ${a.read?"is-read":"is-unread"} tone-${info.tone}`}>
            <span className="md-alert-icon" aria-hidden="true">{info.tone==="stock"?<PackageMinus size={20}/>:info.tone==="urgent"?<AlertTriangle size={20}/>:<Bell size={19}/>}</span>
            <span className="md-alert-copy"><span className="md-alert-title">{info.title}{info.highPriority&&<span className="md-alert-priority">High</span>}</span>
              {info.medicine&&<span className="md-alert-medicine">{info.medicine}</span>}<span className="md-alert-description">{info.description}</span>
              <span className="md-alert-meta"><time>{date(a.createdAt)}</time>{a.resolvedAt&&<span>Resolved</span>}</span>
            </span>{!a.read&&<span className="md-alert-unread-dot" aria-label="Unread"/>}
            <button type="button" className="md-alert-dismiss" aria-label={`Dismiss ${info.title} for ${info.medicine || "this notification"}`} disabled={clear.isPending || dismiss.isPending} onClick={()=>dismiss.mutate({id:a.id})}><X size={16}/></button>
          </article></li>;
        })}</ul>:<div className="md-alert-empty"><Bell size={30} aria-hidden="true"/><strong>You’re all caught up</strong><p>New notifications will appear here.</p></div>}
      </div>
    </section>}
    <AlertDialog open={confirmClear} onOpenChange={value=>{if(!clear.isPending)setConfirmClear(value);}}><AlertDialogContent className="md-alert-confirm">
      <AlertDialogHeader><AlertDialogTitle>Clear all notifications?</AlertDialogTitle><AlertDialogDescription>This hides the current notifications from your account only. Active incidents, email delivery logs, and transaction history will be preserved. New alerts will still appear.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={clear.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={clear.isPending} onClick={event=>{event.preventDefault();clear.mutate({throughId:clearThrough});}}>{clear.isPending?"Clearing…":"Clear All"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
