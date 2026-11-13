import type { MachineStatus, MachineSlot } from "@shared/medidispense";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@shared/const";
export type MonitorState = { label: string; tone: "good" | "bad" | "warn" | "neutral" | "info"; message: string };
export const HEARTBEAT_FRESH_SECONDS = 90;
export async function checkMonitoringConnection(refetch: () => Promise<{ error?: unknown }>) {
  try {
    const result=await refetch();
    if(!result.error)return "Connection status updated.";
  } catch { /* Never expose a raw backend/hardware exception to staff. */ }
  return "Monitoring could not be refreshed. Please check the network and try again.";
}
export function connectionState(machine?: MachineStatus, elapsedSeconds=0): MonitorState {
  if(machine?.controllerAmbiguous)return {label:"Status Unknown",tone:"warn",message:"The machine connection needs checking. Please ask for maintenance assistance."};
  const age=machine?.heartbeatAgeSeconds;
  if(!machine || age==null || !Number.isFinite(age) || age<0) return { label:"Status Unknown",tone:"neutral",message:"The connection has not yet been verified. Please check again." };
  if(!machine.online || age+Math.max(0,elapsedSeconds)>HEARTBEAT_FRESH_SECONDS) return { label:"Offline",tone:"bad",message:"The machine is not connected. Please check its power and internet connection." };
  return {label:"Online",tone:"good",message:"The machine is connected and communicating with the system."};
}
export function componentState(raw: string | undefined, reported: boolean, fresh: boolean): MonitorState {
  const unknown:MonitorState={label:"Not Yet Verified",tone:"neutral",message:"This part has not been checked yet."};
  if(!fresh || !reported)return unknown;
  const value=(raw??"").trim().toLowerCase().replace(/[_-]/g," ");
  if(value==="connected")return {label:"Connected",tone:"info",message:"The machine controller is communicating."};
  if(["not connected","disconnected","offline"].includes(value))return {label:"Disconnected",tone:"bad",message:"Please check the machine or ask for assistance."};
  if(["error","failed","jammed","stalled","fault"].includes(value))return {label:"Needs Attention",tone:"bad",message:"Please ask for maintenance assistance."};
  // Ready, idle, monitoring and running reports do not verify functionality.
  return unknown;
}
export function slotStock(slot: MachineSlot) {
  const quantity=slot.availableQuantity;
  if(quantity==null || !Number.isFinite(quantity) || quantity<0) return {label:"Status Unknown",tone:"neutral" as const,quantity:null};
  const threshold=slot.minimumStockLevel ?? DEFAULT_LOW_STOCK_THRESHOLD;
  return {quantity,label:quantity===0?"Out of Stock":quantity<=threshold?"Low Stock":"In Stock",tone:quantity===0?"bad" as const:quantity<=threshold?"warn" as const:"good" as const};
}
