import { ReportTools } from "./ReportPresentation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Transaction } from "@shared/medidispense";
import { DateRangeFilter, RecordPagination, RECORD_PAGE_SIZE } from "./RecordControls";
import { salesReport } from "@/lib/salesReport";
import { salesExportBlob, type SalesExportFormat } from "@/lib/salesExport";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const money = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents/100);
export default function SalesReport({ transactions }: { transactions: Transaction[] }) {
  const source = trpc.transactions.list.useQuery();
  const [start,setStart] = useState(""); const [end,setEnd] = useState("");
  const [product,setProduct] = useState("all");
  const [view,setView] = useState<"daily" | "monthly" | "medicines">("daily");
  const [page,setPage] = useState(1);
  const lock = useRef(false);
  const [format,setFormat] = useState<SalesExportFormat>("csv");
  const [exporting,setExporting] = useState(false);
  const currentTransactions = source.data ?? transactions;
  const audit = trpc.reports.activity.useMutation();
  const products = Array.from(new Map(currentTransactions.flatMap(t => t.items.map(i => [String(i.medicineId),i.medicineName] as const))).entries());
  const medicine = products.find(([id]) => id === product)?.[1] ?? "All medicines";
  const report = useMemo(() => salesReport(currentTransactions,start,end,product),[currentTransactions,start,end,product]);
  const rows = report[view]; const pages = Math.max(1,Math.ceil(rows.length/RECORD_PAGE_SIZE)); const current = Math.min(page,pages);
  useEffect(() => setPage(1),[start,end,product,view]);
  useEffect(() => setPage(p => Math.min(p,pages)),[pages]);
  const invalid = !!start && !!end && start > end;
  const exportReport = async () => {
    if (lock.current || invalid) return; lock.current=true; setExporting(true);
    try {
      const refreshed = await source.refetch();
      if (refreshed.error || !refreshed.data) throw new Error("Could not refresh sales data. Please reconnect and retry.");
      const snapshot = salesReport(refreshed.data,start,end,product);
      const blob = await salesExportBlob({ report:snapshot, start, end, medicine, generatedAt:new Date() },format);
      await audit.mutateAsync({ event: "exported", report_type: "sales", format, record_count: snapshot.records.length, start_date:start, end_date:end, status:"successful", payment:"successful", medicine, search:"" });
      { const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url;link.download=`medidispense-sales-${start || "all"}-${end || "all"}.${format}`;link.click();setTimeout(() => URL.revokeObjectURL(url),60000); }
      toast.success("Sales report exported");
    } catch(error) { toast.error(error instanceof Error ? error.message : "Could not prepare sales report."); }
    finally { lock.current=false; setExporting(false); }
  };
  if (source.isPending) return <section className="panel"><div className="panel-head" role="status">Loading sales report...</div></section>;
  if (source.isError) return <section className="panel"><div className="panel-head"><p role="alert">{source.error.message}</p><button className="secondary-button" onClick={() => void source.refetch()}>Retry</button></div></section>;
  return <div className="page-stack sales-report-page reports-view">
    

    <ReportTools label="Sales report" format={format} onFormat={setFormat} exporting={exporting} disabled={invalid||exporting||audit.isPending} onExport={()=>void exportReport()} hint="Uses the dates and medicine you select."><DateRangeFilter start={start} end={end} onStart={setStart} onEnd={setEnd}/><select aria-label="Sales medicine" value={product} onChange={e=>setProduct(e.target.value)}><option value="all">All medicines</option>{products.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><button className="secondary-button" onClick={()=>{setStart("");setEnd("");setProduct("all");}}>Reset filters</button></ReportTools>
    {invalid && <p role="alert">Start date must not be after end date.</p>}
    <section className="panel"><div className="panel-head"><div><div className="panel-kicker">SALES REPORT</div><h2>{view === "medicines" ? "Sales per medicine" : view === "daily" ? "Daily sales" : "Monthly sales"}</h2></div><select className="select-button" aria-label="Sales breakdown" value={view} onChange={e => setView(e.target.value as typeof view)}><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="medicines">Per medicine</option></select></div><div className="table-wrap"><table><thead><tr><th>{view === "medicines" ? "Medicine" : "Period"}</th><th className="report-number">Purchases</th><th className="report-number">Units sold</th><th className="report-number">Sales</th></tr></thead><tbody>{!rows.length && <tr><td className="report-empty" colSpan={4}><strong>No sales to show yet</strong>Try another date range or reset your filters.</td></tr>}{rows.slice((current-1)*RECORD_PAGE_SIZE,current*RECORD_PAGE_SIZE).map((r,i) => <tr key={`${r.label}-${i}`}><td>{r.label}</td><td className="report-number">{r.transactions}</td><td className="report-number">{r.units}</td><td className="report-number">{money(r.cents)}</td></tr>)}</tbody></table></div><RecordPagination total={rows.length} page={current} onPage={setPage} /></section>
  </div>;
}
