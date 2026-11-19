import { useRef, useState } from "react";
import { X, PackagePlus, Pill, Layers, Archive, CalendarDays, Minus, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Medicine } from "@shared/medidispense";
import type { SlotMaintenance } from "@shared/slotInventory";
import { inventoryRequestKey } from "./InventorySlots";
import "./restock-dialog.css";
export function RestockDialog({
  medicine,
  onClose,
  onChanged,
}: {
  medicine: Medicine;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [key] = useState(inventoryRequestKey);
  const [localOp, setLocalOp] = useState<SlotMaintenance | null>(null);
  const lock = useRef(false);
  const overview = trpc.inventory.slots.useQuery();
  const utils = trpc.useUtils();
  const saved = overview.data?.operation;
  const op =
    localOp ??
    (saved?.action === "restock" && saved.old_medicine_id === medicine.id
      ? saved
      : null);
  const remaining = Math.max(0, 10 - medicine.stockQuantity);
  const amount = Number(quantity);
  const validQuantity =
    /^[1-9][0-9]*$/.test(quantity) &&
    amount <= remaining;
  // Pressing Add Stock is the confirmation that these tablets (same expiry) were loaded.
  const valid = validQuantity;
  const refresh = () => {
    void utils.invalidate();
    onChanged();
  };
  const begin = trpc.inventory.begin.useMutation();
  const restock = trpc.inventory.restock.useMutation();
  const pending = begin.isPending || restock.isPending;
  // One step: the server pre-check (begin) and the stock record (restock) run
  // back to back, so purchases are never left paused by an unfinished dialog.
  // If a previous attempt already started the check, it is reused.
  const addStock = async () => {
    if (lock.current || !medicine.slotNumber || !valid) return;
    lock.current = true;
    try {
      const active = op ?? await begin.mutateAsync({
        request_key: key,
        slot_number: medicine.slotNumber,
        action: "restock",
      });
      setLocalOp(active);
      await restock.mutateAsync({
        medicineId: medicine.id,
        quantity: amount,
        reason: "Restock",
        requestKey: active.request_key,
        physicallyLoaded: true,
        sameExpiry: true,
      });
      toast.success("Stock added and recorded.");
      refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stock could not be added.");
      refresh();
    } finally {
      lock.current = false;
    }
  };
  const changeQuantity = (value: string) => setQuantity(value);
  return (
    <div className="modal-backdrop">
      <form
        className="modal-card restock-modal add-stock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restock-title"
        onSubmit={e => {
          e.preventDefault();
          if (!pending && !overview.isPending) void addStock();
        }}
      >
        <div className="modal-head">
          <span className="add-stock-header-icon" aria-hidden="true"><PackagePlus size={24}/></span>
          <div className="add-stock-heading">
            <h2 id="restock-title">Add Stock</h2>
            <p className="add-stock-subtitle">Add tablets to the selected medicine.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close restock"
            disabled={pending}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="add-stock-body">
        <div className="add-stock-medicine">
          <span className="add-stock-medicine-icon" aria-hidden="true"><Pill size={23}/></span>
          <div className="add-stock-medicine-name">
            <h3>{medicine.name}</h3>
            <span className="add-stock-slot">Slot {medicine.slotNumber}</span>
          </div>
          <span className="add-stock-expiry"><CalendarDays size={14} aria-hidden="true"/><span>Expires <time dateTime={medicine.expiryDate}>{medicine.expiryDate || "Not recorded"}</time></span></span>
        </div>
        <div className="add-stock-recorded">
          <div><span className="add-stock-stat-icon" aria-hidden="true"><Layers size={20}/></span><span>Current Stock <b>{medicine.stockQuantity} tablets</b></span></div>
          <div><span className="add-stock-stat-icon" aria-hidden="true"><Archive size={20}/></span><span>Slot Capacity <b>10 tablets</b></span></div>
        </div>
        <div className="add-stock-entry">
          <div className="add-stock-quantity">
            <label htmlFor="restock-quantity">How many tablets will you add?</label>
            <div className="add-stock-stepper">
              <button type="button" aria-label="Decrease tablets to add" disabled={pending || !validQuantity || amount <= 1} onClick={() => changeQuantity(String(amount - 1))}><Minus size={20} aria-hidden="true"/></button>
              <input id="restock-quantity" type="number" required min={1} max={remaining} step={1}
                inputMode="numeric" value={quantity} disabled={pending}
                onChange={e => changeQuantity(e.target.value)} placeholder={remaining ? "1" : "0"}
                aria-describedby="restock-quantity-help" aria-invalid={quantity!==""&&!validQuantity}/>
              <button type="button" aria-label="Increase tablets to add" disabled={pending || remaining === 0 || (quantity !== "" && !validQuantity) || (validQuantity && amount >= remaining)} onClick={() => changeQuantity(String(quantity === "" ? 1 : amount + 1))}><Plus size={20} aria-hidden="true"/></button>
            </div>
          </div>
          <div className="add-stock-preview" aria-live="polite" aria-atomic="true">
            <span>New Stock Total</span>
            <div><Layers size={20} aria-hidden="true"/><strong>{validQuantity ? medicine.stockQuantity+amount : "—"}<small> / 10 tablets</small></strong></div>
            <small>{medicine.stockQuantity} current + {validQuantity ? amount : "—"} adding</small>
          </div>
        </div>
        <small id="restock-quantity-help" className={quantity!==""&&!validQuantity?"restock-error":"add-stock-help"}>
          {remaining===0?"This slot is full.":quantity!==""&&!validQuantity?`Enter a whole number from 1 to ${remaining}.`:`You can add up to ${remaining} tablets.`}
        </small>
        <p className="add-stock-safety"><ShieldCheck size={18} aria-hidden="true"/><span>Load the tablets into Slot {medicine.slotNumber} (expiry {medicine.expiryDate}), then press Add Stock.</span></p>
        {(begin.error || restock.error) && (
          <p role="alert">{restock.error?.message ?? begin.error?.message}</p>
        )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={
              pending ||
              overview.isPending ||
              !valid ||
              remaining === 0 ||
              !medicine.slotNumber
            }
          >
            {pending ? "Adding..." : "Add Stock"}
          </button>
        </div>
      </form>
    </div>
  );
}
