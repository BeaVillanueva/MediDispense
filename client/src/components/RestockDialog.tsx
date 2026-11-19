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
  const [reason, setReason] = useState("Restock");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
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
  const isolated = ["poweredOff", "stopped", "coins"].every(k => checks[k]);
  const valid = validQuantity &&
    reason.trim().length >= 5 &&
    ["loaded", "sameExpiry", "poweredOff", "stopped", "coins"].every(
      k => checks[k]
    );
  const refresh = () => {
    void utils.invalidate();
    onChanged();
  };
  const begin = trpc.inventory.begin.useMutation({
    onSuccess: result => {
      setLocalOp(result);
      refresh();
    },
    onError: e => toast.error(e.message),
    onSettled: () => {
      lock.current = false;
    },
  });
  const restock = trpc.inventory.restock.useMutation({
    onSuccess: () => {
      toast.success("Stock added and recorded.");
      refresh();
      onClose();
    },
    onError: e => toast.error(e.message),
    onSettled: () => {
      lock.current = false;
    },
  });
  const pending = begin.isPending || restock.isPending;
  const changeQuantity = (value: string) => {
    setQuantity(value);
    setChecks(previous => ({ ...previous, loaded: false }));
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal-card restock-modal add-stock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restock-title"
        onSubmit={e => {
          e.preventDefault();
          if (lock.current) return;
          if (!op && medicine.slotNumber && validQuantity && !pending && !overview.isPending) {
            lock.current = true;
            begin.mutate({
              request_key: key,
              slot_number: medicine.slotNumber,
              action: "restock",
            });
          } else if (op && valid) {
            lock.current = true;
            restock.mutate({
              medicineId: medicine.id,
              quantity: amount,
              reason: reason.trim(),
              requestKey: op.request_key,
              physicallyLoaded: true,
              sameExpiry: true,
              machinePoweredOff: true,
              motorsStopped: true,
              noUnrecordedCoins: true,
            });
          }
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
        {!op ? (
          <>
            <p className="add-stock-safety"><ShieldCheck size={18} aria-hidden="true"/><span>Keep the machine connected. Continue checks it first; do not load tablets yet.</span></p>
          </>
        ) : (
          <>
            <p className="medical-note">
              Safety check passed. Purchases are paused. Turn off the entire machine, including coin payment, before loading.
            </p>
            <div className="slot-confirmations">
              {(
                [
                  [
                    "poweredOff",
                    "The entire machine, including coin payment, is powered off.",
                  ],
                  ["stopped", "All dispensers have stopped."],
                  [
                    "coins",
                    "I checked for coins that were accepted but not recorded. There are none.",
                  ],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!!checks[key]}
                    onChange={e =>
                      setChecks({ ...checks, [key]: e.target.checked })
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <fieldset className="add-stock-loaded" disabled={!isolated || pending}>
              <legend>Load and confirm</legend>
              <p>Add {validQuantity?amount:"the selected"} tablets to Slot {medicine.slotNumber}. Use the same expiry: {medicine.expiryDate}.</p>
              <div className="slot-confirmations">
                {[["loaded","I loaded this number of tablets into this slot."],["sameExpiry","The added tablets have the expiry date shown above."]].map(([key,label])=><label key={key}><input type="checkbox" checked={!!checks[key]} onChange={e=>setChecks({...checks,[key]:e.target.checked})}/><span>{label}</span></label>)}
              </div>
            </fieldset>
            <details className="add-stock-notes"><summary>Stock note</summary><label>Reason<input required minLength={5} maxLength={200} value={reason} onChange={e=>setReason(e.target.value)}/></label></details>
            <small className="add-stock-help">Need to stop? Close and resume later. Purchases stay paused until this is finished.</small>
          </>
        )}
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
            {op ? "Close - resume later" : "Cancel"}
          </button>
          <button
            className="primary-button"
            disabled={
              pending ||
              overview.isPending ||
              !validQuantity ||
              remaining === 0 ||
              (!!op && !valid) ||
              !medicine.slotNumber
            }
          >
            {pending
              ? "Checking..."
              : op
                ? "Confirm added stock"
                : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
