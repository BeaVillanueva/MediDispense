import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { Medicine } from "@shared/medidispense";

export function MedicineDetailsDialog({ medicine, deleting, onClose, onChanged }: { medicine: Medicine; deleting: boolean; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(medicine.name);
  const [category, setCategory] = useState(medicine.category);
  const [price, setPrice] = useState(String(medicine.price));
  const [expiry, setExpiry] = useState(medicine.expiryDate);
  const [slot, setSlot] = useState(medicine.slotNumber === null ? "" : String(medicine.slotNumber));
  const lock = useRef(false);
  const options = trpc.medicines.options.useQuery(undefined, { enabled: !deleting });
  const callbacks = { onSuccess: () => { toast.success(deleting ? "Medicine deleted" : "Medicine updated"); onChanged(); onClose(); }, onError: (error: { message: string }) => toast.error(error.message), onSettled: () => { lock.current = false; } };
  const update = trpc.medicines.update.useMutation(callbacks);
  const archive = trpc.medicines.archive.useMutation(callbacks);
  const pending = update.isPending || archive.isPending;
  const valid = name.trim().length >= 2 && name.trim().length <= 180 && !!category && /^\d+(\.\d{1,2})?$/.test(price) && Number(price) <= 99999999.99 && !!expiry && !!options.data;
  return <div className="modal-backdrop"><form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="medicine-dialog-title" onSubmit={event => { event.preventDefault(); if (lock.current || (!deleting && !valid)) return; lock.current = true; if (deleting) archive.mutate({ id: medicine.id }); else update.mutate({ id: medicine.id, name: name.trim(), category, price: Number(price), expiryDate: expiry, slotNumber: slot ? Number(slot) : null }); }}>
    <div className="modal-head"><h2 id="medicine-dialog-title">{deleting ? "Delete medicine?" : "Edit medicine details"}</h2></div>
    {deleting ? <p>Delete <strong>{medicine.name}</strong> from the active inventory and remove its slot assignment? Its stock record and transaction history will be preserved. Remove any physical stock before reusing the slot.</p> : <><p className="page-subtitle">Current stock: {medicine.stockQuantity}. Use Add Stock to restock.</p><div className="form-grid">
      <label>Medicine name<input required minLength={2} maxLength={180} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Category<select required value={category} onChange={e => setCategory(e.target.value)}>{!options.data?.categories.includes(category) && <option value={category}>{category}</option>}{options.data?.categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Unit price<input required inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /><small>Non-negative amount, up to 2 decimal places.</small></label>
      <label>Expiry date<input required type="date" min="1000-01-01" max="9999-12-31" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
      <label>Slot assignment<select value={slot} onChange={e => setSlot(e.target.value)}><option value="">Unassigned</option>{options.data?.slots.map(item => <option key={item.slot_number} value={item.slot_number} disabled={item.medicine_id !== null && Number(item.medicine_id) !== medicine.id}>Slot {item.slot_number}{item.medicine_id !== null && Number(item.medicine_id) !== medicine.id ? " (occupied)" : ""}</option>)}</select></label>
    </div><p className="page-subtitle">When changing slots, move the physical stock to match before accepting purchases.</p>{options.isLoading && <p>Loading categories and slots…</p>}{options.error && <p role="alert">{options.error.message}</p>}</>}
    {(update.error || archive.error) && <p role="alert">{update.error?.message ?? archive.error?.message}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>Cancel</button><button className="primary-button" disabled={pending || (!deleting && !valid)}>{pending ? "Saving…" : deleting ? "Delete medicine" : "Save changes"}</button></div>
  </form></div>;
}
