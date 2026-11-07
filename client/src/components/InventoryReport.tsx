import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { inDateRange, reportCsv } from "@/lib/adminFilters";
import { inventoryStockStatus } from "@shared/inventoryReport";
import { DateRangeFilter, RecordPagination, RECORD_PAGE_SIZE } from "./RecordControls";
import { toast } from "sonner";

const labels = { in_stock: "In Stock", low_stock: "Low Stock", out_of_stock: "Out of Stock" };
export default function InventoryReport() {
  const query = trpc.reports.inventory.useQuery();
  const audit = trpc.reports.activity.useMutation();
  const [medicine,setMedicine] = useState("all"), [status,setStatus] = useState("all");
  const [start,setStart] = useState(""), [end,setEnd] = useState("");
  const [page,setPage] = useState(1), [historyPage,setHistoryPage] = useState(1);
  const lock = useRef(false);
  useEffect(() => {setPage(1);setHistoryPage(1);},[medicine,status,start,end]);
  const data=query.data;
  const products=Array.from(new Map([...(data?.items ?? []).map(i => [String(i.id),i.name] as const),...(data?.movements ?? []).map(i => [String(i.medicineId),i.name] as const)]).entries());
  const rows=(data?.items ?? []).filter(i => (medicine === "all" || String(i.id) === medicine) && (status === "all" || inventoryStockStatus(i) === status));
  const ids=new Set(rows.map(i=>i.id));
  const movements=(data?.movements ?? []).filter(i => (medicine === "all" || String(i.medicineId) === medicine) && (status === "all" || ids.has(i.medicineId)) && inDateRange(i.createdAt,start,end));
  const current=Math.min(page,Math.max(1,Math.ceil(rows.length/RECORD_PAGE_SIZE)));
  const historyCurrent=Math.min(historyPage,Math.max(1,Math.ceil(movements.length/RECORD_PAGE_SIZE)));
  const additions=movements.reduce((n,i)=>n+Math.max(0,i.change),0), deductions=movements.reduce((n,i)=>n+Math.max(0,-i.change),0);
  const invalid=!!start && !!end && start>end;
  const exportReport = async ()=>{
    if(lock.current || !data || query.isError || invalid)return; lock.current=true;
    try {
      const csv=reportCsv([["MediDispense Inventory Report"],["Medicine",products.find(([id])=>id===medicine)?.[1] ?? "All"],["Stock status",status],["Movement start",start || "All"],["Movement end",end || "All"],["Current inventory is not a historical snapshot"],
        ["Medicine","Available stock","On hand","Reserved","Stock status","Expiry","Last updated"],...rows.map(i=>[i.name,i.available,i.quantity,i.reserved,labels[inventoryStockStatus(i)],i.expiry ?? "",i.updatedAt]),[],
        ["Recorded additions",additions],["Recorded deductions",deductions],["Net movement",additions-deductions],
        ["Movement date","Medicine","Previous","Change","New stock","Type","Reason","Responsible"],...movements.map(i=>[i.createdAt,i.name,i.previous,i.change,i.next,i.type,i.reason,i.actor])]);
      await audit.mutateAsync({event: "exported",report_type:"inventory",record_count:rows.length,start_date:start,end_date:end,status:"all",payment:"all",medicine:products.find(([id])=>id===medicine)?.[1] ?? "All medicines",search:`Stock status: ${status}; movements: ${movements.length}`});
      {const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="medidispense-inventory-report.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      toast.success("Inventory report exported");
    }catch(error){toast.error(error instanceof Error?error.message:"Could not prepare report.");}finally{lock.current=false;}
  };
  if(query.isPending)return <section className="panel"><div className="panel-head" role="status">Loading inventory report…</div></section>;
  if(query.isError)return <section className="panel"><div className="panel-head"><p role="alert">{query.error.message}</p><button className="secondary-button" onClick={()=>void query.refetch()}>Retry</button></div></section>;
  return <div className="page-stack"><div className="page-toolbar report-toolbar sales-report-toolbar"><div className="report-filter-bar"><DateRangeFilter start={start} end={end} onStart={setStart} onEnd={setEnd}/><select aria-label="Inventory medicine" value={medicine} onChange={e=>setMedicine(e.target.value)}><option value="all">All medicines</option>{products.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><select aria-label="Stock status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All stock statuses</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><button className="secondary-button" onClick={()=>{setMedicine("all");setStatus("all");setStart("");setEnd("");}}>Clear filters</button><button className="primary-button" disabled={invalid||audit.isPending} onClick={()=>void exportReport()}>Export Inventory CSV</button></div></div>
    <p className="page-subtitle">Current active medicines; available stock is on-hand stock minus reservations. Low stock includes the configured threshold. Summary cards follow medicine and stock filters. Date Range applies only to movement history; stock status filters history by each medicine’s current status.</p>{invalid&&<p role="alert">Start date must not be after end date.</p>}
    <div className="inventory-summary">{[["Total Medicines",rows.length],["Total Stock",rows.reduce((n,i)=>n+i.available,0)],["Low Stock Medicines",rows.filter(i=>inventoryStockStatus(i)==="low_stock").length],["Out of Stock Medicines",rows.filter(i=>i.available===0).length]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <section className="panel"><div className="panel-head"><div><div className="panel-kicker">INVENTORY REPORT</div><h2>Current inventory</h2></div></div><div className="table-wrap"><table><thead><tr><th>Medicine Name</th><th>Current Stock (Available)</th><th>Stock Status</th><th>Expiration Date</th><th>Last Updated</th></tr></thead><tbody>{!rows.length&&<tr><td colSpan={5}>No medicines match these filters.</td></tr>}{rows.slice((current-1)*RECORD_PAGE_SIZE,current*RECORD_PAGE_SIZE).map(i=><tr key={i.id}><td>{i.name}</td><td><strong>{i.available}</strong><small>{i.quantity} on hand · {i.reserved} reserved</small></td><td><span className={`status-badge ${i.available===0?"bad":inventoryStockStatus(i)==="low_stock"?"warn":"good"}`}>{labels[inventoryStockStatus(i)]}</span></td><td>{i.expiry ?? "Not recorded"}</td><td>{i.updatedAt}</td></tr>)}</tbody></table></div><RecordPagination total={rows.length} page={current} onPage={setPage}/></section>
    <section className="panel"><div className="panel-head"><div><div className="panel-kicker">RECORDED STOCK MOVEMENTS</div><h2>Stock additions and deductions</h2><p className="page-subtitle">Added: {additions} · Deducted: {deductions} · Net change: {additions-deductions}. Recorded movements only; initial stock may not have a movement record.</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Medicine</th><th>Previous</th><th>Change</th><th>New stock</th><th>Reason</th><th>Responsible</th></tr></thead><tbody>{!movements.length&&<tr><td colSpan={7}>No recorded movements match these filters.</td></tr>}{movements.slice((historyCurrent-1)*RECORD_PAGE_SIZE,historyCurrent*RECORD_PAGE_SIZE).map(i=><tr key={i.id}><td>{i.createdAt}</td><td>{i.name}</td><td>{i.previous}</td><td>{i.change>0?"+":""}{i.change}</td><td>{i.next}</td><td>{i.reason||i.type.replaceAll("_"," ")}</td><td>{i.actor}</td></tr>)}</tbody></table></div><RecordPagination total={movements.length} page={historyCurrent} onPage={setHistoryPage}/></section>
  </div>;
}
