import { ReportHighlights, ReportTools } from "./ReportPresentation";
import { Pill, PackageCheck, TriangleAlert, PackageX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { inDateRange } from "@/lib/adminFilters";
import { inventoryStockStatus } from "@shared/inventoryReport";
import { DateRangeFilter, RecordPagination, RECORD_PAGE_SIZE } from "./RecordControls";
import { toast } from "sonner";

import { inventoryExportBlob, inventoryExportModel } from "@/lib/inventoryExport";
import type { SalesExportFormat } from "@/lib/salesExport";

const labels = { in_stock: "In Stock", low_stock: "Low Stock", out_of_stock: "Out of Stock" };
export default function InventoryReport() {
  const query = trpc.reports.inventory.useQuery();
  const audit = trpc.reports.activity.useMutation();
  const [medicine,setMedicine] = useState("all"), [status,setStatus] = useState("all");
  const [start,setStart] = useState(""), [end,setEnd] = useState("");
  const [page,setPage] = useState(1), [historyPage,setHistoryPage] = useState(1);
  const lock = useRef(false);
  const [format,setFormat]=useState<SalesExportFormat>("csv");
  const [exporting,setExporting]=useState(false);
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
    if(lock.current || !data || query.isError || invalid)return; lock.current=true; setExporting(true);
    try {
      const refreshed=await query.refetch();
      if(refreshed.error||!refreshed.data) throw new Error("Could not refresh inventory. Please reconnect and retry.");
      const snapshot=inventoryExportModel(refreshed.data,medicine,status,start,end);
      const blob=await inventoryExportBlob(snapshot,format);
      await audit.mutateAsync({event: "exported",report_type:"inventory",format,record_count:snapshot.rows.length,start_date:start,end_date:end,status:"all",payment:"all",medicine:snapshot.medicineName,search:`Stock status: ${status}; movements: ${snapshot.movements.length}`});
      {const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`medidispense-inventory-report.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
      toast.success("Inventory report exported");
    }catch(error){toast.error(error instanceof Error?error.message:"Could not prepare report.");}finally{lock.current=false;setExporting(false);}
  };
  if(query.isPending)return <section className="panel"><div className="panel-head" role="status">Loading inventory report…</div></section>;
  if(query.isError)return <section className="panel"><div className="panel-head"><p role="alert">{query.error.message}</p><button className="secondary-button" onClick={()=>void query.refetch()}>Retry</button></div></section>;
  return <div className="page-stack inventory-report-page reports-view">
    <ReportHighlights items={[{label:"Medicines",value:rows.length,hint:"Matching your stock filters",Icon:Pill,tone:"blue"},{label:"Available stock",value:rows.reduce((n,i)=>n+i.available,0),hint:"Recorded stock less reserved units",Icon:PackageCheck,tone:"green"},{label:"Low stock medicines",value:rows.filter(i=>inventoryStockStatus(i)==="low_stock").length,hint:"At or below their stock threshold",Icon:TriangleAlert,tone:"amber"},{label:"Out of stock",value:rows.filter(i=>i.available===0).length,hint:"No available units remaining",Icon:PackageX,tone:"rose"}]}/>
    <ReportTools label="Inventory report" format={format} onFormat={setFormat} exporting={exporting} disabled={invalid||exporting||audit.isPending} onExport={()=>void exportReport()} hint="Includes current stock and filtered stock history."><DateRangeFilter start={start} end={end} onStart={setStart} onEnd={setEnd}/><select aria-label="Inventory medicine" value={medicine} onChange={e=>setMedicine(e.target.value)}><option value="all">All medicines</option>{products.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><select aria-label="Stock status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All stock statuses</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><button className="secondary-button" onClick={()=>{setMedicine("all");setStatus("all");setStart("");setEnd("");}}>Reset filters</button></ReportTools>
    {invalid&&<p role="alert">Start date must not be after end date.</p>}
    <section className="panel"><div className="panel-head"><div><div className="panel-kicker">INVENTORY REPORT</div><h2>Current inventory</h2></div></div><div className="table-wrap"><table><thead><tr><th>Medicine Name</th><th className="report-number">Available stock</th><th>Stock Status</th><th>Expiration Date</th><th>Last Updated</th></tr></thead><tbody>{!rows.length&&<tr><td className="report-empty" colSpan={5}><strong>No medicines match</strong>Reset your filters to see all active medicines.</td></tr>}{rows.slice((current-1)*RECORD_PAGE_SIZE,current*RECORD_PAGE_SIZE).map(i=><tr key={i.id}><td>{i.name}</td><td className="report-number"><strong>{i.available}</strong><small>{i.quantity} on hand · {i.reserved} reserved</small></td><td><span className={`status-badge ${i.available===0?"bad":inventoryStockStatus(i)==="low_stock"?"warn":"good"}`}>{labels[inventoryStockStatus(i)]}</span></td><td>{i.expiry ?? "Not recorded"}</td><td>{i.updatedAt}</td></tr>)}</tbody></table></div><RecordPagination total={rows.length} page={current} onPage={setPage}/></section>
    <section className="panel"><div className="panel-head"><div><div className="panel-kicker">RECORDED STOCK MOVEMENTS</div><h2>Stock additions and deductions</h2><div className="report-movement-summary"><span>Added <b>+{additions}</b></span><span>Removed <b>-{deductions}</b></span><span>Net change <b>{additions-deductions>0?"+":""}{additions-deductions}</b></span></div><p className="add-stock-help">Recorded changes only; starting stock may not appear here.</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Medicine</th><th className="report-number">Before</th><th className="report-number">Change</th><th className="report-number">After</th><th>Reason</th><th>Responsible</th></tr></thead><tbody>{!movements.length&&<tr><td className="report-empty" colSpan={7}><strong>No stock changes to show</strong>Try another date range or reset your filters.</td></tr>}{movements.slice((historyCurrent-1)*RECORD_PAGE_SIZE,historyCurrent*RECORD_PAGE_SIZE).map(i=><tr key={i.id}><td>{i.createdAt}</td><td>{i.name}</td><td className="report-number">{i.previous}</td><td className="report-number"><span className={i.change>0?"report-change-positive":i.change<0?"report-change-negative":""}>{i.change>0?"+":""}{i.change}</span></td><td className="report-number">{i.next}</td><td>{i.reason||i.type.replaceAll("_"," ")}</td><td>{i.actor}</td></tr>)}</tbody></table></div><RecordPagination total={movements.length} page={historyCurrent} onPage={setHistoryPage}/></section>
  </div>;
}
