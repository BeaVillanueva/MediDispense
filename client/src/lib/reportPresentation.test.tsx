import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Transaction } from "@shared/medidispense";
import type { InventoryReportData } from "@shared/inventoryReport";
const h=vi.hoisted(()=>({transactions:[] as Transaction[],inventory:{items:[],movements:[]} as InventoryReportData}));
vi.mock("@/lib/trpc",()=>({trpc:{transactions:{list:{useQuery:()=>({data:h.transactions,isPending:false,isError:false})}},reports:{inventory:{useQuery:()=>({data:h.inventory,isPending:false,isError:false})},activity:{useMutation:()=>({isPending:false})}}}}));
import SalesReport from "@/components/SalesReport";
import InventoryReport from "@/components/InventoryReport";
import { ReportTools } from "@/components/ReportPresentation";
import { ReportHighlights } from "@/components/ReportPresentation";
import { History } from "lucide-react";
beforeEach(()=>{h.transactions=[];h.inventory={items:[],movements:[]};});
it('supports shared three-card admin summaries with honest zero and unavailable values',()=>{
  const html=renderToStaticMarkup(<ReportHighlights items={[{label:'Activities',value:0,hint:'Matching records',Icon:History,tone:'blue'},{label:'Sources',value:0,hint:'Recorded sources',Icon:History,tone:'violet'},{label:'Unavailable',value:'—',hint:'Not yet loaded',Icon:History,tone:'amber'}]}/>);
  expect(html).toContain('data-count="3"');
  expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(2);
  expect(html).toContain('<strong>—</strong>');
  expect(html).not.toContain('Working');
});
it("uses the same summary-first, filters, export and table design for both reports",()=>{
  for(const html of [renderToStaticMarkup(<SalesReport transactions={[]}/>),renderToStaticMarkup(<InventoryReport/>)]){
    expect(html.indexOf('class="sales-highlights"')).toBeLessThan(html.indexOf('class="sales-tools"'));
    expect(html.indexOf('class="sales-tools"')).toBeLessThan(html.indexOf('<table>'));
    for(const label of ['Choose what to view','Save your report','Reset filters','Excel','PDF'])expect(html).toContain(label);
    expect(html).not.toContain('About these figures');
    expect(html).not.toContain('sales-report-context');
    expect(html).toContain('report-empty');
  }
});
it("renders actual available stock, stock status and movement totals without conflating current stock and history",()=>{
  h.inventory={items:[{id:1,name:'Sample medicine',quantity:7,reserved:2,available:5,threshold:3,expiry:'2027-12-31',updatedAt:'2026-11-16'}],movements:[{id:1,medicineId:1,name:'Sample medicine',previous:3,next:7,change:4,type:'restock',reason:'Added stock',actor:'Admin',createdAt:'2026-11-16'}]};
  const html=renderToStaticMarkup(<InventoryReport/>);
  expect(html).toContain('7 on hand');expect(html).toContain('2 reserved');
  expect(html).toContain('In Stock');expect(html).toContain('Added <b>+4</b>');
  expect(html).not.toContain('Date range applies to stock history only.');
  expect(html).toContain('report-change-positive');
});
it("keeps export controls disabled while preparing and does not offer simulated downloads",()=>{
  const html=renderToStaticMarkup(<ReportTools label="Inventory report" format="xlsx" onFormat={()=>{}} exporting disabled onExport={()=>{}} hint="Filtered report"><span>Filters</span></ReportTools>);
  expect(html).toContain('Preparing...');expect(html).toContain('aria-label="Inventory export format" disabled');
  expect(html).toMatch(/<button[^>]*disabled=""/);expect(html).not.toContain('href=');
});
