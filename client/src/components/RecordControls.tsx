import type { ReactNode } from "react";
import { CalendarDays, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function FilterDropdown({ count, children }: { count: number; children: ReactNode }) {
  return <Popover><PopoverTrigger asChild><button className="secondary-button"><SlidersHorizontal size={14} /> Filters{count > 0 ? ` (${count})` : ""}</button></PopoverTrigger><PopoverContent align="start" className="record-filter-popover"><h3>Report filters</h3>{children}</PopoverContent></Popover>;
}

export function DateRangeFilter({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (value: string) => void; onEnd: (value: string) => void }) {
  const invalid = !!start && !!end && start > end;
  return <Popover><PopoverTrigger asChild><button className="secondary-button"><CalendarDays size={14} /> Date Range{start || end ? `: ${start || "Any"} – ${end || "Any"}` : ""}</button></PopoverTrigger><PopoverContent align="start" className="record-filter-popover"><h3>Date Range</h3><label>Start Date<input type="date" value={start} max={end || undefined} onChange={e => onStart(e.target.value)} /></label><label>End Date<input type="date" value={end} min={start || undefined} onChange={e => onEnd(e.target.value)} /></label>{invalid && <p role="alert">Start date must not be after end date.</p>}<button className="secondary-button" onClick={() => { onStart(""); onEnd(""); }}>Clear dates</button></PopoverContent></Popover>;
}

export const RECORD_PAGE_SIZE = 15;
export function RecordPagination({ total, page, onPage }: { total: number; page: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / RECORD_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const numbers = Array.from(new Set([1, current - 1, current, current + 1, pages])).filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return <nav className="activity-pagination" aria-label="Record pagination"><span>Showing {total ? (current - 1) * RECORD_PAGE_SIZE + 1 : 0}–{Math.min(current * RECORD_PAGE_SIZE, total)} of {total} records</span><div className="activity-pagination-controls"><button disabled={current === 1} onClick={() => onPage(current - 1)}>Previous</button>{numbers.map((n, i) => <span key={n}>{i > 0 && n > numbers[i - 1] + 1 && <span className="pagination-gap">…</span>}<button aria-label={`Page ${n}`} aria-current={n === current ? "page" : undefined} onClick={() => onPage(n)}>{n}</button></span>)}<button disabled={current === pages} onClick={() => onPage(current + 1)}>Next</button></div></nav>;
}
