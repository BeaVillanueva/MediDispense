import { useRef, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Transaction } from "@shared/medidispense";
import { trpc } from "@/lib/trpc";
import { peso } from "@/lib/kioskPurchase";
import {
  deliveryCheckErrors,
  recoveryFormSignature,
  recoveryRequestKey,
  type RecoveryForm,
} from "@/lib/dispenseIssue";
import {
  recoveryBlockerText,
  recoveryErrorText,
} from "@/lib/recoveryPresentation";
import "./dispensing-issue.css";

export function DispensingIssueDialog({
  transaction,
  onClose,
  onChanged,
}: {
  transaction: Transaction;
  onClose: () => void;
  onChanged: () => void;
}) {
  const details = trpc.transactions.issueDetails.useQuery(
    { id: transaction.databaseId! },
    { refetchInterval: 5000 }
  );
  const current = details.data?.transaction ?? transaction;
  const prior = current.issueRecovery;
  const requested =
    current.requestedQuantity ?? current.items[0]?.quantity ?? 0;
  const sensor =
    current.sensorConfirmedQuantity ?? current.dispensedQuantity ?? 0;
  const [form, setForm] = useState<RecoveryForm>({
    outcome: "",
    quantity: "",
    stock: "",
    notes: "",
    obligation: "pending",
    reference: "",
    complete: false,
    inspected: false,
    stopped: false,
    disconnected: false,
  });
  const [mode, setMode] = useState<"external" | "isolated">("external");
  const [power, setPower] = useState(false);
  const [inspectionKey, setInspectionKey] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(recoveryRequestKey);
  const [prepareKey] = useState(recoveryRequestKey);
  const [reopenKey, setReopenKey] = useState(recoveryRequestKey);
  const [physicalSignature, setPhysicalSignature] = useState<string | null>(
    null
  );
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [reopenPanel, setReopenPanel] = useState(false);
  const [reopenChecks, setReopenChecks] = useState({
    power: false,
    stopped: false,
    disconnected: false,
  });
  const lock = useRef(false);
  const submission = useRef<{ signature: string; payload: any } | null>(null);
  const preparedKey =
    inspectionKey ??
    (details.data?.inspection?.active ? details.data.inspection.key : null);
  const errors = deliveryCheckErrors(
    form,
    sensor,
    prior?.verifiedQuantity ?? sensor,
    requested,
    mode,
    !!preparedKey,
    power
  );
  if(mode==='isolated'&&prior&&!prior.reviewRequired&&form.outcome&&
    (form.outcome!==prior.outcome||Number(form.quantity)!==prior.verifiedQuantity||
      (form.outcome==='dispensed_sensor_missed'?'delivery_verified':form.obligation)!==prior.obligationStatus)){
    errors.savedCheck='A finalized check is already saved. Select Load saved check to retain its recorded result and customer follow-up.';
  }
  const signature = recoveryFormSignature(form);
  const external =
    form.outcome !== "dispensed_sensor_missed" && form.obligation !== "pending";
  const resetMessages = () => {
    setStatus("");
    setReopenPanel(false);
    submission.current = null;
    setRequestKey(recoveryRequestKey());
  };
  const update = (change: Partial<RecoveryForm>) => {
    setForm(f => ({ ...f, ...change }));
    resetMessages();
  };
  const refresh = async () => {
    const r = await details.refetch();
    setRefreshFailed(!!r.error);
    return !r.error;
  };
  const save = trpc.transactions.saveDeliveryCheck.useMutation({
    onSuccess: () => {
      submission.current = null;
      toast.success("Delivery check saved successfully.");
      // The parent invalidates transaction and issue queries. Saving is not reopening.
      onChanged();
      onClose();
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  const prepare = trpc.transactions.prepareDeliveryInspection.useMutation({
    onSuccess: async result => {
      setInspectionKey(result.request_key);
      await refresh();
      setStatus(
        "Purchases paused. Confirm power remains isolated before inspecting."
      );
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  const reopen = trpc.transactions.reopenAfterReview.useMutation({
    onSuccess: async result => {
      if (
        result.issueRecovery?.returnRequested &&
        result.issueRecovery.machineReuseReady
      ) {
        setStatus("Kiosk reopening confirmed.");
        toast.success("Kiosk can return to Choose Medicine.");
        setReopenPanel(false);
        setReopenKey(recoveryRequestKey());
        onChanged();
      } else
        setStatus("Reopening was not confirmed. Check the machine status.");
      await refresh();
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  const pending = save.isPending || prepare.isPending || reopen.isPending;
  const loading = !details.data || !!details.error;
  const canSave = !loading && !pending && !Object.keys(errors).length;
  const canOfferReopen =
    !!prior &&
    physicalSignature === signature &&
    !!details.data?.returnEligibility.ready &&
    !refreshFailed &&
    !prior.returnRequested &&
    !save.error &&
    !prepare.error &&
    !reopen.error;
  const blocked = saved || !!prior || !!details.data?.deliveryCheck;
  const firstBlocker = details.data?.returnEligibility.blockers[0];
  const readyForPreparation =
    !!details.data?.inspection?.eligible &&
    power &&
    form.stopped &&
    form.disconnected &&
    !pending;
  const apiError = save.error ?? prepare.error ?? reopen.error;
  const physicallyLocked = mode === "isolated" && !preparedKey;
  const loadSaved = () => {
    const actual = details.data?.history[0],
      note = details.data?.deliveryCheck;
    const v = actual ?? note;
    if (!v) return;
    const next: RecoveryForm = {
      ...form,
      outcome: v.outcome as RecoveryForm["outcome"],
      quantity: String(v.verifiedQuantity),
      stock: v.physicalStock == null ? "" : String(v.physicalStock),
      notes: v.notes,
      obligation:
        v.obligationStatus === "refund_documented"
          ? "refund_documented"
          : v.obligationStatus === "replacement_documented"
            ? "replacement_documented"
            : "pending",
      reference: v.obligationReference,
      complete: true,
      inspected: false,
      stopped: false,
      disconnected: false,
    };
    setForm(next);
    setPower(false);
    setMode(actual ? "isolated" : "external");
    setPhysicalSignature(actual ? recoveryFormSignature(next) : null);
    resetMessages();
  };
  return (
    <div className="modal-backdrop issue-backdrop">
      <form
        className="modal-card dispense-issue-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-title"
        onSubmit={event => {
          event.preventDefault();
          if (lock.current || !canSave || !form.outcome) return;
          const input = {
            id: current.databaseId!,
            transactionCode: current.id,
            requestKey,
            expectedRevision:
              mode === "external"
                ? (details.data?.deliveryCheck?.revision ?? 0)
                : (prior?.revision ?? 0),
            mode,
            inspectionKey: preparedKey,
            outcome: form.outcome,
            quantity: Number(form.quantity),
            stock: form.stock===''?null:Number(form.stock),
            notes: form.notes.trim(),
            obligation:
              form.outcome === "dispensed_sensor_missed"
                ? ("delivery_verified" as const)
                : form.obligation,
            reference: external ? form.reference.trim() : "",
            observed: mode === "external" && form.inspected,
            inspected: mode === "isolated" && form.inspected,
            powerIsolated: power,
            stopped: form.stopped,
            disconnected: form.disconnected,
          };
          const fullSignature = JSON.stringify({
            signature,
            mode,
            preparedKey,
          });
          const payload =
            submission.current?.signature === fullSignature
              ? submission.current.payload
              : input;
          submission.current = { signature: fullSignature, payload };
          lock.current = true;
          save.mutate(payload);
        }}
      >
        <header className="issue-header">
          <div>
            <h2 id="issue-title">Check Medicine Delivery</h2>
            <p>
              <strong>
                {current.items.map(i => i.medicineName).join(", ")}
              </strong>
            </p>
            <div className="issue-header-meta">
              <span>Slot {current.slotNumber}</span>
              <span>{requested} ordered</span>
              <span>{peso(current.amountPaid)} paid</span>
            </div>
            <strong className="issue-reference">
              {current.databaseId != null
                ? `Transaction #${current.databaseId}`
                : "Transaction number unavailable"}
            </strong>
            <details className="issue-reference">
              <summary>Full reference</summary>
              <small>{current.id}</small>
            </details>
          </div>
          <button
            type="button"
            className="icon-button"
            disabled={pending}
            onClick={() => void refresh()}
            aria-label="Refresh recovery status"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={pending}
            onClick={onClose}
            aria-label="Close delivery check"
          >
            <X size={18} />
          </button>
        </header>
        <div className="issue-body">
          {details.error && (
            <p className="issue-error" role="alert">
              Could not load the purchase. Please try again.
            </p>
          )}
          <div className="issue-mode">
            <label htmlFor="issue-mode">
              How was it checked?
              <select
                id="issue-mode"
                value={mode}
                disabled={pending}
                onChange={e => {
                  setMode(e.target.value as typeof mode);
                  setForm(f => ({
                    ...f,
                    inspected: false,
                    stopped: false,
                    disconnected: false,
                  }));
                  setPower(false);
                  resetMessages();
                }}
              >
                <option value="external">Observed from outside</option>
                <option value="isolated">Hands-on stock inspection</option>
              </select>
            </label>
            {!!(
              details.data?.deliveryCheck || details.data?.history.length
            ) && (
              <button
                type="button"
                className="issue-link"
                onClick={loadSaved}
                disabled={pending}
              >
                Load saved check
              </button>
            )}
          </div>
          {mode === "isolated" && (
            <section
              className="issue-isolation"
              aria-label="Physical inspection safety"
            >
              {!!preparedKey && <p role="status">Inspection pause is saved. Keep power isolated; Save Check does not require the machine to be online.</p>}
              <p>
                Switch off and isolate the whole machine before opening it. A
                connection indicator alone cannot prove it is electrically safe.
              </p>
              <div className="issue-safety-checks">
                <label>
                  <input
                    id="issue-power"
                    type="checkbox"
                    checked={power}
                    onChange={e => setPower(e.target.checked)}
                  />
                  Machine power is isolated, including the coin acceptor.
                </label>
                <label>
                  <input
                    id="issue-stopped"
                    type="checkbox"
                    checked={form.stopped}
                    onChange={e => update({ stopped: e.target.checked })}
                  />
                  All moving parts have stopped.
                </label>
                <label>
                  <input
                    id="issue-disconnected"
                    type="checkbox"
                    checked={form.disconnected}
                    onChange={e => update({ disconnected: e.target.checked })}
                  />
                  The control board is switched off or disconnected.
                </label>
              </div>
              {!preparedKey ? (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!readyForPreparation}
                    onClick={() => {
                      if (lock.current) return;
                      lock.current = true;
                      prepare.mutate({
                        id: current.databaseId!,
                        transactionCode: current.id,
                        requestKey: prepareKey,
                        machinePowerIsolated: true,
                        motorStopped: true,
                        controllerDisconnected: true,
                      });
                    }}
                  >
                    Pause for physical inspection
                  </button>
                  {details.data?.inspection?.blockers[0] && (
                    <small role="status">
                      {recoveryBlockerText(
                        details.data.inspection.blockers[0].code
                      )}
                    </small>
                  )}
                </>
              ) : (
                <small>
                  Inspection is prepared. Purchases remain paused until an
                  authorized reopening.
                </small>
              )}
            </section>
          )}
          <fieldset
            disabled={loading || pending || physicallyLocked}
            className="issue-fields"
          >
            <label className="issue-full" htmlFor="issue-outcome">
              Did the medicine come out?
              <select
                id="issue-outcome"
                value={form.outcome}
                required
                onChange={e => {
                  const outcome = e.target.value as RecoveryForm["outcome"];
                  update({
                    outcome,
                    quantity:
                      outcome === "not_dispensed"
                        ? "0"
                        : outcome === "dispensed_sensor_missed"
                          ? String(requested)
                          : "",
                  });
                }}
              >
                <option value="">Choose a result</option>
                <option value="not_dispensed">No tablets came out</option>
                <option value="partial" disabled={requested <= 1}>
                  Some tablets came out
                </option>
                <option value="dispensed_sensor_missed">
                  All tablets came out
                </option>
              </select>
            </label>
            <label htmlFor="issue-quantity">
              Tablets delivered
              <input
                id="issue-quantity"
                inputMode="numeric"
                value={form.quantity}
                readOnly={form.outcome !== "partial"}
                required
                aria-invalid={!!form.outcome && !!errors.quantity}
                onChange={e => {
                  if (form.outcome === "partial")
                    update({ quantity: e.target.value });
                }}
                placeholder="Enter count"
              />
              {form.outcome && errors.quantity && (
                <small className="issue-field-error">{errors.quantity}</small>
              )}
              {sensor > 0 && <small>Already recorded: {sensor}</small>}
            </label>
            <label htmlFor="issue-stock">
              Tablets remaining in slot
              <input
                id="issue-stock"
                inputMode="numeric"
                value={form.stock}
                required={mode==='isolated'}
                aria-invalid={form.stock !== "" && !!errors.stock}
                onChange={e => update({ stock: e.target.value })}
                placeholder="Count 0?10"
              />
              <small>
                {form.stock !== "" && errors.stock ? (
                  <span className="issue-field-error">{errors.stock}</span>
                ) : (
                  "Recorded stock: " +
                  (details.data?.recordedStock ?? "?") +
                  (mode==='external'?". Leave blank if not visible from outside.":". Enter your physical count.")
                )}
              </small>
            </label>
            {form.outcome && form.outcome !== "dispensed_sensor_missed" && (
              <label htmlFor="issue-obligation">
                Customer follow-up
                <select
                  id="issue-obligation"
                  value={form.obligation}
                  onChange={e =>
                    update({
                      obligation: e.target.value as RecoveryForm["obligation"],
                    })
                  }
                >
                  <option value="pending">Needs follow-up</option>
                  <option value="refund_documented">
                    Refund already given
                  </option>
                  <option value="replacement_documented">
                    Replacement already provided
                  </option>
                </select>
              </label>
            )}
            {external && (
              <label htmlFor="issue-reference">
                Refund or replacement reference
                <input
                  id="issue-reference"
                  value={form.reference}
                  required
                  maxLength={200}
                  onChange={e => update({ reference: e.target.value })}
                />
                {errors.reference && (
                  <small className="issue-field-error">
                    {errors.reference}
                  </small>
                )}
              </label>
            )}
            <label className="issue-full" htmlFor="issue-notes">
              Inspection notes
              <textarea
                id="issue-notes"
                required
                maxLength={1000}
                value={form.notes}
                onChange={e => update({ notes: e.target.value })}
                placeholder="Briefly describe what you found."
              />
              {form.notes !== "" && errors.notes && (
                <small className="issue-field-error">{errors.notes}</small>
              )}
            </label>
            <label className="issue-full issue-confirm">
              <input
                id="issue-inspected"
                type="checkbox"
                checked={form.inspected}
                onChange={e => update({ inspected: e.target.checked })}
              />
              <span>
                {mode === "external"
                  ? "I observed from outside, without opening or reaching into the machine."
                  : "I inspected and counted the medicine after isolating machine power."}
              </span>
            </label>
          </fieldset>
          {canOfferReopen && (
            <section className="issue-reopen">
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => {
                  setReopenPanel(true);
                  setReopenChecks({
                    power: false,
                    stopped: false,
                    disconnected: false,
                  });
                }}
              >
                Reopen Kiosk
              </button>
              {reopenPanel && (
                <>
                  <p>
                    Confirm the current safety state. This does not dispense
                    medicine or settle customer follow-up.
                  </p>
                  {(["power", "stopped", "disconnected"] as const).map(key => (
                    <label className="issue-confirm" key={key}>
                      <input
                        id={"reopen-" + key}
                        type="checkbox"
                        checked={reopenChecks[key]}
                        onChange={e =>
                          setReopenChecks({
                            ...reopenChecks,
                            [key]: e.target.checked,
                          })
                        }
                      />
                      <span>
                        {key === "power"
                          ? "Machine power is isolated."
                          : key === "stopped"
                            ? "All moving parts are stopped."
                            : "The control board is disconnected."}
                      </span>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      pending || !Object.values(reopenChecks).every(Boolean)
                    }
                    onClick={() => {
                      if (lock.current) return;
                      lock.current = true;
                      reopen.mutate({
                        id: current.databaseId!,
                        transactionCode: current.id,
                        requestKey: reopenKey,
                        expectedRevision: prior!.revision,
                        machinePowerIsolated: true,
                        motorStopped: true,
                        controllerDisconnected: true,
                      });
                    }}
                  >
                    Confirm Reopen
                  </button>
                </>
              )}
            </section>
          )}
          {!canOfferReopen && blocked && (
            <p className="issue-reopen-note" role="status">
              {!prior
                ? "Findings are separate from stock reconciliation. Prepare an isolated inspection before reopening."
                : firstBlocker
                  ? recoveryBlockerText(firstBlocker.code)
                  : "Prepare and save the physical reconciliation before reopening."}
            </p>
          )}
          {(details.data?.history.length || details.data?.deliveryCheck) && (
            <details className="issue-history">
              <summary>Previous checks</summary>
              {details.data?.deliveryCheck && (
                <p>
                  External findings saved. Inventory has not been changed by
                  this note.
                </p>
              )}
              {details.data?.history.map(v => (
                <article key={v.revision}>
                  <strong>
                    {v.createdAt} ? {v.verifiedQuantity} delivered
                  </strong>
                  <p>{v.notes}</p>
                </article>
              ))}
            </details>
          )}
        </div>
        <footer className="issue-footer">
          {errors.savedCheck&&<p className="issue-error" role="status">{errors.savedCheck}</p>}
          {status && (
            <p className="issue-success" role="status">
              {status}
            </p>
          )}
          {apiError && (
            <p className="issue-error" role="alert">
              {recoveryErrorText(apiError.message)}
            </p>
          )}
          <div className="issue-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={!canSave}
            >
              {pending ? "Saving..." : "Save Check"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
