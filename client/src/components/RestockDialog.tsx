import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Medicine } from "@shared/medidispense";

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
  const lock = useRef(false);
  const [touched, setTouched] = useState(false);
  const amount = Number(quantity);
  const remaining = Math.max(0, 10 - medicine.stockQuantity);
  const [inputError, setInputError] = useState("");
  const error = remaining === 0 ? "Stock is already full." : quantity === "" ? "Enter a quantity to add." : !/^[1-9]\d*$/.test(quantity) || amount > remaining ? `You can only add up to ${remaining} more items.` : "";
  const valid = !error;
  const restock = trpc.inventory.restock.useMutation({
    onSuccess: () => {
      toast.success(
        "Successfully added"
      );
      onChanged();
      onClose();
    },
    onError: error => toast.error(error.message),
    onSettled: () => {
      lock.current = false;
    },
  });
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!restock.isPending) onClose();
      }}
    >
      <form
        className="modal-card restock-modal"
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby="restock-title"
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault();
          setTouched(true);
          if (!valid || lock.current) return;
          lock.current = true;
          restock.mutate({ medicineId: medicine.id, quantity: amount });
        }}
      >
        <div className="modal-head">
          <div>
            <div className="panel-kicker">EXISTING MEDICINE</div>
            <h2 id="restock-title">Add stock</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close restock"
            disabled={restock.isPending}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="restock-product">
          <strong>{medicine.name}</strong>
          <span>
            Current Stock: <b>{medicine.stockQuantity}</b>
          </span><span>Maximum Capacity: <b>10</b></span>
        </div>
        <div className="form-grid">
          <label>
            Quantity to add
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]+"
              required
              autoFocus
              value={quantity}
              disabled={restock.isPending || remaining === 0}
              aria-invalid={touched && !valid}
              aria-describedby="restock-feedback"
              onBlur={() => setTouched(true)}
              onChange={e => {
                const next = e.target.value;
                setTouched(true);
                if (next !== "" && (!/^[1-9]\d*$/.test(next) || Number(next) > remaining)) {
                  setInputError(`Enter positive whole numbers only. You can only add up to ${remaining} more items.`);
                  return;
                }
                setInputError(""); setQuantity(next);
              }}
              placeholder={remaining > 0 ? `1 to ${remaining}` : "Full"}
            />
          </label>
        </div>
        <div id="restock-feedback">
          {(touched || remaining === 0) && error && (
            <p className="restock-error" role="alert">
              {error}
            </p>
          )}
          {inputError && <p className="restock-error" role="alert">{inputError}</p>}
          {remaining > 0 && <p>You can only add up to {remaining} more items.</p>}
          {restock.error && (
            <p className="restock-error" role="alert">
              {restock.error.message}
            </p>
          )}
        </div>
        <p className="page-subtitle">
          Adds to the latest stock on the server. This preview may change if
          dispensing occurs before you save.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={restock.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={restock.isPending || !valid}
          >
            {restock.isPending ? "Adding stock..." : "Add stock"}
          </button>
        </div>
      </form>
    </div>
  );
}
