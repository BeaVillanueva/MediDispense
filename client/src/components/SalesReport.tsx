import { useEffect, useMemo, useRef, useState } from "react";
import type { Transaction } from "@shared/medidispense";
import { DateRangeFilter, RecordPagination, RECORD_PAGE_SIZE } from "./RecordControls";
import { salesReport, salesCsv } from "@/lib/salesReport";
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
  const audit = trpc.reports.activity.useMutation();
  const products = Array.from(new Map(transactions.flatMap(t => t.items.map(i => [String(i.medicineId),i.medicineName] as const))).entries());
  const medicine = products.find(([id]) => id === product)?.[1] ?? "All medicines";
  const report = useMemo(() => salesReport(transactions,start,end,product),[transactions,start,end,product]);
  const rows = report[view]; const pages = Math.max(1,Math.ceil(rows.length/RECORD_PAGE_SIZE)); const current = Math.min(page,pages);
  useEffect(() => setPage(1),[start,end,product,view]);
  useEffect(() => setPage(p => Math.min(p,pages)),[pages]);
  const invalid = !!start && !!end && start > end;
  const exportReport = async () => {
    if (lock.current || invalid) return; lock.current=true;
    try {
      const csv = salesCsv(report,start,end,medicine);
      await audit.mutateAsync({ event: "exported", report_type: "sales", record_count: report.records.length, start_date:start, end_date:end, status:"successful", payment:"successful", medicine, search:"" });
      { const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"})); const link=document.createElement("a"); link.href=url;link.download=`medidispense-sales-${start || "all"}-${end || "all"}.csv`;link.click();setTimeout(() => URL.revokeObjectURL(url),1000); }
      toast.success("Sales report exported");
    } catch(error) { toast.error(error instanceof Error ? error.message : "Could not prepare sales report."); }
    finally { lock.current=false; }
  };
  if (source.isPending) return <section className="panel"><div className="panel-head" role="status">Loading sales report?</div></section>;
  if (source.isError) return <section className="panel"><div className="panel-head"><p role="alert">{source.error.message}</p><button className="secondary-button" onClick={() => void source.refetch()}>Retry</button></div></section>;
  return <div className="page-stack"><div className="page-toolbar report-toolbar sales-report-toolbar"><div className="report-filter-bar"><DateRangeFilter start={start} end={end} onStart={setStart} onEnd={setEnd} /><select aria-label="Sales medicine" value={product} onChange={e => setProduct(e.target.value)}><option value="all">All medicines</option>{products.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select><button className="secondary-button" onClick={() => {setStart("");setEnd("");setProduct("all");}}>Clear filters</button><button className="primary-button" disabled={invalid || audit.isPending} onClick={() => void exportReport()}>Export sales CSV</button></div></div>
    <p className="page-subtitle">Completed, successfully paid purchases only. Dates use transaction date in Philippine time. Sales use stored item subtotals, excluding overpayment. Selecting a medicine counts only its items.</p>
    {invalid && <p role="alert">Start date must not be after end date.</p>}
    <div className="inventory-summary"><div><span>Total sales</span><strong>{money(report.cents)}</strong></div><div><span>Completed transactions</span><strong>{report.records.length}</strong></div><div><span>Units sold</span><strong>{report.units}</strong></div><div><span>Average sales per transaction</span><strong>{money(report.records.length ? report.cents/report.records.length : 0)}</strong></div></div>
    <section className="panel"><div className="panel-head"><div><div className="panel-kicker">SALES REPORT</div><h2>{view === "medicines" ? "Sales per medicine" : view === "daily" ? "Daily sales" : "Monthly sales"}</h2></div><select className="select-button" aria-label="Sales breakdown" value={view} onChange={e => setView(e.target.value as typeof view)}><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="medicines">Per medicine</option></select></div><div className="table-wrap"><table><thead><tr><th>{view === "medicines" ? "Medicine" : "Period"}</th><th>Transactions</th><th>Units sold</th><th>Sales</th></tr></thead><tbody>{!rows.length && <tr><td colSpan={4}>No completed sales match these filters.</td></tr>}{rows.slice((current-1)*RECORD_PAGE_SIZE,current*RECORD_PAGE_SIZE).map((r,i) => <tr key={`${r.label}-${i}`}><td>{r.label}</td><td>{r.transactions}</td><td>{r.units}</td><td>{money(r.cents)}</td></tr>)}</tbody></table></div><RecordPagination total={rows.length} page={current} onPage={setPage} /></section>
  </div>;
}
