import { useState } from "react";
import { Boxes, CircleHelp, RefreshCw, Radio, CreditCard, ScanLine, Cpu, Pill } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { connectionState, componentState, slotStock, checkMonitoringConnection } from "@/lib/machineMonitoring";
import "./machine-monitoring.css";

export default function MachineMonitoring() {
  const machine=trpc.machine.status.useQuery(undefined,{refetchInterval:5000});
  const [feedback,setFeedback]=useState("");
  const data=machine.data;
  const elapsed=machine.dataUpdatedAt ? Math.max(0,(Date.now()-machine.dataUpdatedAt)/1000) : 0;
  const connection=machine.isError ? connectionState() : connectionState(data,elapsed);
  const fresh=connection.label==="Online";
  async function checkConnection() {
    setFeedback("");
    setFeedback(await checkMonitoringConnection(()=>machine.refetch()));
  }
  if(machine.isPending)return <div className="panel mm-empty" role="status"><RefreshCw size={24}/> Loading machine monitoring...</div>;
  if(!data)return <div className="panel mm-empty" role="alert"><CircleHelp size={28}/><h2>Monitoring unavailable</h2><p>We could not retrieve machine information. No hardware status has been verified.</p><button className="primary-button" disabled={machine.isFetching} onClick={()=>void checkConnection()}>Check Connection</button></div>;
  const components=[
    {key:"controller" as const,label:"Machine Controller",technical:"ESP32 controller",raw:data.esp32Status,icon:Cpu},
    {key:"dispenser" as const,label:"Medicine Dispenser",technical:"Motor drivers",raw:data.motorStatus,icon:Boxes},
    {key:"detection" as const,label:"Medicine Detection",technical:"IR / limit sensors",raw:data.sensorStatus,icon:ScanLine},
    {key:"payment" as const,label:"Coin Payment",technical:"Coin acceptor",raw:data.coinAcceptorStatus,icon:CreditCard},
  ].map(item=>({...item,state:componentState(item.raw,data.componentReports?.[item.key]===true,fresh)}));

  return <div className="page-stack machine-monitoring">
    
    <section className={`machine-overview mm-hero mm-hero-${connection.tone}`}>
      <div className="mm-machine-art" aria-hidden="true"><div className="mm-art-orbit"/><div className="mm-art-machine"><div className="mm-art-screen"><Pill size={30}/></div><div className="mm-art-products"><span/><span/><span/></div><div className="mm-art-tray"/></div><div className="mm-art-signal"><Radio size={25}/></div></div>
      <div className="machine-copy"><div className="eyebrow">Machine Status</div><h2>{data.machineName || "Machine name unavailable"}</h2><p>{connection.message}</p>
        <span className={`mm-status mm-${connection.tone}`}><i aria-hidden="true"/>{connection.label}</span>
      </div>
      <button className="primary-button light-button" disabled={machine.isFetching} onClick={()=>void checkConnection()}><RefreshCw size={17} className={machine.isFetching?"mm-refreshing":""}/>{machine.isFetching?"Checking...":"Check Connection"}</button>
    </section>
    {feedback && <p role="status" className="mm-feedback">{feedback}</p>}
    {machine.isError && <p role="alert" className="mm-warning">Monitoring updates are unavailable. Previously recorded data may be outdated.</p>}
    <div className="hardware-grid">{components.map(({label,key,icon:Icon,state})=><section className={`hardware-card mm-component mm-component-${key} mm-card-${state.tone}`} key={key}><div className="mm-component-top"><div className="hardware-icon"><Icon size={24}/></div><span className={`mm-status mm-${state.tone}`}><i aria-hidden="true"/>{state.label}</span></div><h3>{label}</h3><p>{state.message}</p></section>)}</div>

    <section className="panel mm-stock-panel"><div className="panel-head"><div className="mm-section-title"><div className="mm-section-icon"><Pill size={23}/></div><div><div className="panel-kicker">INVENTORY OVERVIEW</div><h2>Medicine Stock</h2></div></div><span className="mm-slot-count">{data.slots.length} medicine slots</span></div>
      <p className="mm-inventory-note">Stock shown is based on inventory records.{machine.isError?" These recorded quantities may be outdated.":""}</p>
      {data.slots.length===0?<p className="mm-empty">No medicine slots are recorded.</p>:<div className="slot-grid">{data.slots.map(slot=>{const stock=slotStock(slot);return <article className={`slot-card mm-stock-card mm-stock-${slot.medicineId?stock.tone:"neutral"}`} key={slot.slotNumber}><div className="mm-stock-top"><div className="slot-number"><Pill size={16}/> Slot {slot.slotNumber}</div><span className={`mm-status mm-${slot.medicineId?stock.tone:"neutral"}`}><i aria-hidden="true"/>{slot.medicineId?stock.label:"Unassigned"}</span></div><h3>{slot.medicineName || "No medicine assigned"}</h3><div className="mm-stock-amount"><strong>{stock.quantity??'—'}</strong><span>{stock.quantity==null?'Quantity not verified':'units available'}</span></div><div className="mm-stock-footer"><span>Recorded inventory</span><Boxes size={18} aria-hidden="true"/></div>{slot.status==="blocked" && <p className="mm-warning">Purchasing unavailable. Staff check required.</p>}</article>;})}</div>}
    </section>
  </div>;
}
