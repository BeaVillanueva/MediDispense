import type { ReactNode } from "react";
import { Download, SlidersHorizontal, type LucideIcon } from "lucide-react";
import AdminFilterToolbar from "./AdminFilterToolbar";
import type { SalesExportFormat } from "@/lib/salesExport";
import "./sales-report.css";

export function ReportHighlights({items}:{items:{label:string;value:string|number;hint:string;Icon:LucideIcon;tone:"green"|"blue"|"amber"|"violet"|"rose"}[]}) {
  return <div className="sales-highlights" data-count={items.length}>{items.map(({label,value,hint,Icon,tone})=><div key={label} className={`sales-highlight sales-highlight-${tone}`}><div className="sales-highlight-top"><span>{label}</span><i aria-hidden="true"><Icon size={22}/></i></div><strong>{value}</strong><small>{hint}</small></div>)}</div>;
}

export function ReportTools({label,children,format,onFormat,exporting,disabled,onExport,hint}:{label:string;children:ReactNode;format:SalesExportFormat;onFormat:(value:SalesExportFormat)=>void;exporting:boolean;disabled:boolean;onExport:()=>void;hint:string}) {
  return <section className="sales-tools">
    <div className="sales-filter-area"><h3><SlidersHorizontal size={17} aria-hidden="true"/> Choose what to view</h3><AdminFilterToolbar label={`${label} filters`}>{children}</AdminFilterToolbar></div>
    <div className="sales-export-area"><h3><Download size={17} aria-hidden="true"/> Save your report</h3><div className="sales-export-controls"><select aria-label={`${label.startsWith("Sales")?"Sales":"Inventory"} export format`} value={format} disabled={exporting} onChange={e=>onFormat(e.target.value as SalesExportFormat)}><option value="csv">CSV · Raw data</option><option value="xlsx">Excel · Editable workbook</option><option value="pdf">PDF · Ready to print</option></select><button className="primary-button" disabled={disabled} onClick={onExport}><Download size={16} aria-hidden="true"/>{exporting?"Preparing...":`Export ${format==="xlsx"?"Excel":format.toUpperCase()}`}</button></div><small>{hint}</small></div>
  </section>;
}

