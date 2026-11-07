import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Transaction } from "@shared/medidispense";
import { trpc } from "@/lib/trpc";

export function DispenseRecoveryDialog({ transaction, onClose, onChanged }: {
  transaction: Transaction; onClose: () => void; onChanged: () => void;
}) {
  const [stopped, setStopped] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [reason, setReason] = useState("Dispensing confirmation missing; motor stopped and controller disconnected.");
  const [reconcile, setReconcile] = useState(!!transaction.adminRecovered);
  const [physicalStock, setPhysicalStock] = useState("");
  const ledger = trpc.transactions.list.useQuery();
  const unresolved = (ledger.data ?? []).filter(item => item.dispensingStatus === "dispensing" && item.id !== transaction.id);
  const sameSlotUnresolved = unresolved.some(item => item.slotNumber === transaction.slotNumber);
  const countValid = /^(?:[0-9]|10)$/.test(physicalStock);
  const canSubmit = stopped && disconnected && reason.trim().length >= 5 && (!transaction.adminRecovered || reconcile) && (!reconcile || (countValid && !sameSlotUnresolved && !!ledger.data));
  const lock = useRef(false);
  const recovery = trpc.transactions.recoverStopped.useMutation({
    onSuccess: () => {
      toast.success(reconcile ? "Recovery and physical stock reconciliation saved." : "Recovery saved. Reconcile physical stock before reopening the slot.");
      onChanged(); onClose();
    },
    onSettled: () => { lock.current = false; },
  });
  return <div className="modal-backdrop"><form className="modal-card restock-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title" onSubmit={event => {
    event.preventDefault();
    if (lock.current || !canSubmit || !transaction.databaseId) return;
    lock.current = true;
    recovery.mutate({ id: transaction.databaseId, transactionCode: transaction.id, motorStopped: true, controllerDisconnected: true, reason, ...(reconcile ? { physicalStock: Number(physicalStock) } : {}) });
  }}>
    <h2 id="recovery-title">{transaction.adminRecovered ? "Reconcile slot stock" : "Recover stopped dispensing"}</h2>
    <p>Dispensing request #{transaction.dispensingRequestId ?? "—"}</p>
    <p><strong>{transaction.id}</strong><br />{transaction.items.map(item => item.medicineName).join(", ")} · Slot {transaction.slotNumber}</p>
    <p>Recovery stops the unresolved purchase from blocking the machine. Reopening this slot also requires a physical stock count. Handle any customer refund separately.</p>
    {transaction.adminRecovered && <p role="status">{transaction.stockReconciled ? "A physical stock reconciliation is already recorded for this purchase. Retrying does not change stock or clear a later safety restriction." : "Recovery is saved, but no physical stock reconciliation is saved for this purchase. This slot remains blocked until you count its stock below."}</p>}
    <p>Disconnect the ESP32 before continuing. Keep it disconnected until its callback connection and any other pending requests are checked.</p>
    {unresolved.length > 0 && <p role="status">{unresolved.length} other unresolved purchase(s) remain. Recover each one; the kiosk unlocks only after all are resolved.{sameSlotUnresolved ? " This slot has another unresolved purchase: finish those recoveries before entering its final stock count." : ""}</p>}
    <label style={{ display: "block", marginBlock: 12 }}><input type="checkbox" checked={stopped} onChange={e => setStopped(e.target.checked)} disabled={recovery.isPending} /> I physically confirmed the motor has stopped.</label>
    <label style={{ display: "block", marginBlock: 12 }}><input type="checkbox" checked={disconnected} onChange={e => setDisconnected(e.target.checked)} disabled={recovery.isPending} /> The ESP32 is powered off / disconnected.</label>
    <div className="form-grid"><label>Recovery reason<textarea required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={recovery.isPending} /></label></div>
    <label style={{ display: "block", marginBlock: 12 }}><input type="checkbox" checked={reconcile} onChange={e => setReconcile(e.target.checked)} disabled={!!transaction.adminRecovered || recovery.isPending || sameSlotUnresolved || !ledger.data} /> Enter the physical stock count to reopen this slot.</label>
    {reconcile && <>
      <div className="form-grid"><label htmlFor="recovery-physical-stock">Actual units remaining (0–10)<input id="recovery-physical-stock" type="text" inputMode="numeric" pattern="[0-9]|10" placeholder="Enter counted units (0–10)" autoComplete="off" required aria-invalid={!countValid} aria-describedby="recovery-stock-help" value={physicalStock} onChange={e => { if (/^\d{0,2}$/.test(e.target.value)) setPhysicalStock(e.target.value); }} disabled={recovery.isPending} /></label></div>
      <p id="recovery-stock-help">Enter the actual physical count, not the quantity dispensed. Any difference is recorded as an audited inventory adjustment.</p>
      {!countValid && <p role="status">Enter a whole number from 0 to 10 to enable saving.</p>}
      {ledger.isPending && <p role="status">Checking unresolved purchases…</p>}
      {ledger.isError && <p role="alert">Unable to check unresolved purchases. <button type="button" className="secondary-button" onClick={() => void ledger.refetch()}>Retry check</button></p>}
    </>}
    {!reconcile && <p role="status"><strong>Recovery only: this slot will remain unavailable.</strong> Select the physical stock count option above to reconcile and reopen it after the safety checks.</p>}
    {!stopped || !disconnected ? <p role="status">Check both confirmations above to enable Confirm recovery.</p> : reason.trim().length < 5 ? <p role="status">Enter a reason with at least 5 characters.</p> : null}
    {recovery.error && <p role="alert">{recovery.error.message}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={recovery.isPending} onClick={onClose}>Back</button><button className="primary-button" disabled={!canSubmit || recovery.isPending}>{recovery.isPending ? "Resolving…" : reconcile ? "Save physical stock reconciliation" : "Save recovery only (keep slot blocked)"}</button></div>
  </form></div>;
}
