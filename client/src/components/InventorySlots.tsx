import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { SlotMaintenance } from "@shared/slotInventory";
import "./inventory-slots.css";

export type SlotSelection = {
  action: "add" | "remove" | "replace";
  slot: number;
};
export function inventoryRequestKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), n =>
    n.toString(16).padStart(2, "0")
  ).join("");
}
export function InventorySlots({
  canManage,
  selection,
  onSelect,
  onClose,
  onChanged,
  onResumeRestock,
}: {
  canManage: boolean;
  selection: SlotSelection | null;
  onSelect: (v: SlotSelection) => void;
  onClose: () => void;
  onChanged: () => void;
  onResumeRestock?: (medicineId: number) => void;
}) {
  const query = trpc.inventory.slots.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const options = trpc.medicines.options.useQuery(undefined, {
    enabled: canManage,
  });
  const [localOp, setLocalOp] = useState<SlotMaintenance | null>(null);
  const [resume, setResume] = useState(false);
  const [beginKey, setBeginKey] = useState(inventoryRequestKey);
  const lock = useRef(false);
  const utils = trpc.useUtils();
  const refresh = () => {
    void query.refetch();
    void utils.invalidate();
    onChanged();
  };
  const begin = trpc.inventory.begin.useMutation({
    onSuccess: op => {
      setLocalOp(op);
      refresh();
    },
    onError: e => toast.error(e.message),
    onSettled: () => {
      lock.current = false;
    },
  });
  const complete = trpc.inventory.complete.useMutation({
    onSuccess: () => {
      toast.success("Medicine slot updated. History preserved.");
      setRemovedCount("");
      setReason("");
      setForm(
        current =>
          Object.fromEntries(
            Object.keys(current).map(key => [key, ""])
          ) as typeof current
      );
      setLocalOp(null);
      setResume(false);
      onClose();
      setChecks({});
      setBeginKey(inventoryRequestKey());
      refresh();
    },
    onError: e => toast.error(e.message),
    onSettled: () => {
      lock.current = false;
    },
  });
  const op = localOp ?? query.data?.operation ?? null;
  const open = !!selection || resume;
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [removedCount, setRemovedCount] = useState("");
  const [form, setForm] = useState({
    name: "",
    generic_name: "",
    category_name: "",
    description: "",
    dosage_information: "",
    usage_instructions: "",
    unit_price: "",
    expiry_date: "",
    stock_quantity: "",
    image_url: "",
  });
  const pending = begin.isPending || complete.isPending;
  const removing = op?.action === "remove";
  const needed = [
    "machine_powered_off",
    "motors_stopped",
    "no_unrecorded_coins",
    "information_approved",
    ...(op?.old_medicine_id ? ["old_stock_removed"] : []),
    ...(!removing ? ["new_stock_loaded"] : []),
  ];
  const valid =
    !!op &&
    needed.every(k => checks[k]) &&
    (!op.old_medicine_id ||
      (/^[0-9]+$/.test(removedCount) &&
        Number(removedCount) === op.old_quantity)) &&
    reason.trim().length >= 5 &&
    (removing ||
      (form.name.trim().length >= 2 &&
        form.generic_name.trim().length >= 2 &&
        form.category_name &&
        form.description.trim().length >= 2 &&
        form.dosage_information.trim().length >= 2 &&
        form.usage_instructions.trim().length >= 2 &&
        Number(form.unit_price) > 0 &&
        form.expiry_date &&
        /^\d+$/.test(form.stock_quantity) &&
        Number(form.stock_quantity) <= 10));
  const close = () => {
    if (pending) return;
    setResume(false);
    onClose();
    setChecks({});
    setBeginKey(inventoryRequestKey());
  };
  const labels: Record<string, string> = {
    machine_powered_off:
      "The whole machine is powered off, including the coin acceptor and dispenser.",
    motors_stopped: "All dispensers have stopped.",
    no_unrecorded_coins:
      "The coin path was checked; no accepted coins are unrecorded.",
    information_approved:
      "I checked and approved the entered medicine information and counts.",
    old_stock_removed:
      "All remaining old medicine has been physically removed from this slot.",
    new_stock_loaded:
      "The new medicine and counted stock are loaded in this exact slot.",
  };
  return (
    <>
      {query.isPending && <p role="status">Loading physical slots...</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {op && (
        <div className="slot-maintenance-note">
          <strong>
            Slot {op.slot_number}: {op.action} in progress
          </strong>
          <span>
            Purchases are paused until the physical check is completed.
          </span>
          {canManage && (
            <button
              className="primary-button"
              onClick={() => {
                if (op.action === "restock" && op.old_medicine_id)
                  onResumeRestock?.(op.old_medicine_id);
                else setResume(true);
              }}
            >
              Resume stock change
            </button>
          )}
        </div>
      )}
      {open && canManage && (
        <div className="modal-backdrop">
          <form
            className="modal-card inventory-slot-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="slot-maintenance-title"
            onSubmit={e => {
              e.preventDefault();
              if (lock.current) return;
              if (!op && selection) {
                lock.current = true;
                begin.mutate({
                  request_key: beginKey,
                  slot_number: selection.slot,
                  action: selection.action,
                });
              } else if (op && valid) {
                lock.current = true;
                complete.mutate({
                  request_key: op.request_key,
                  machine_powered_off: true,
                  motors_stopped: true,
                  no_unrecorded_coins: true,
                  information_approved: true,
                  old_stock_removed: !!checks.old_stock_removed,
                  ...(op.old_medicine_id
                    ? { old_stock_count: Number(removedCount) }
                    : {}),
                  new_stock_loaded: !!checks.new_stock_loaded,
                  reason: reason.trim(),
                  ...(!removing
                    ? {
                        medicine: {
                          ...form,
                          unit_price: Number(form.unit_price),
                          stock_quantity: Number(form.stock_quantity),
                        },
                      }
                    : {}),
                });
              }
            }}
          >
            <div className="modal-head">
              <div>
                <div className="panel-kicker">PHYSICAL SLOT CHECK</div>
                <h2 id="slot-maintenance-title">
                  {op?.action ?? selection?.action} medicine · Slot{" "}
                  {op?.slot_number ?? selection?.slot}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={pending}
                onClick={close}
                aria-label="Close stock change"
              >
                <X size={18} />
              </button>
            </div>
            {!op ? (
              <>
                <p>
                  First, let the system check for open purchases, coin events
                  and medicine deliveries. Keep the controller online for this
                  check. Do not move stock yet.
                </p>
                <p>
                  Once started, purchases will pause. Then power off the entire
                  machine before handling stock. Closing this dialog will leave
                  the slot blocked until the check is completed.
                </p>
              </>
            ) : (
              <>
                <div className="slot-maintenance-note">
                  <strong>{op.old_name ?? "Empty slot"}</strong>
                  <span>
                    {op.old_quantity} recorded tablets. Historical purchases and
                    receipts will be preserved.
                  </span>
                </div>
                {op.old_medicine_id && (
                  <label>
                    Tablets physically removed
                    <input
                      required
                      inputMode="numeric"
                      value={removedCount}
                      onChange={e => setRemovedCount(e.target.value)}
                      placeholder="Enter counted tablets"
                    />
                    <small>
                      Must match the recorded count. Stop and investigate any
                      difference.
                    </small>
                  </label>
                )}
                {!removing && (
                  <div className="form-grid">
                    {(
                      [
                        ["name", "New medicine name"],
                        ["generic_name", "Generic name"],
                        ["unit_price", "Price per tablet"],
                        ["expiry_date", "Expiry date"],
                        ["stock_quantity", "Counted initial stock (0–10)"],
                        ["image_url", "Medicine image path"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          required={key !== "image_url"}
                          type={key === "expiry_date" ? "date" : "text"}
                          value={form[key]}
                          onChange={e =>
                            setForm({ ...form, [key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Category
                      <select
                        value={form.category_name}
                        onChange={e =>
                          setForm({ ...form, category_name: e.target.value })
                        }
                      >
                        <option value="">Choose category</option>
                        {options.data?.categories.map(c => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    {(
                      [
                        ["description", "Approved description"],
                        ["dosage_information", "Approved dosage information"],
                        ["usage_instructions", "Approved usage information"],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="span-2" key={key}>
                        {label}
                        <textarea
                          value={form[key]}
                          onChange={e =>
                            setForm({ ...form, [key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                <label>
                  Reason for this change
                  <textarea
                    maxLength={200}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    required
                  />
                </label>
                <div className="slot-confirmations">
                  {needed.map(key => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={!!checks[key]}
                        onChange={e =>
                          setChecks({ ...checks, [key]: e.target.checked })
                        }
                      />
                      <span>{labels[key]}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {(begin.error || complete.error) && (
              <p role="alert">
                {complete.error?.message ?? begin.error?.message}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={close}
                disabled={pending}
              >
                {op ? "Close · resume later" : "Cancel"}
              </button>
              <button
                className="primary-button"
                disabled={pending || (!!op && !valid)}
              >
                {pending
                  ? "Checking..."
                  : op
                    ? "Confirm physical stock change"
                    : "Check safety & start"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
