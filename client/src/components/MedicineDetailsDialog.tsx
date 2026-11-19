import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { Medicine } from "@shared/medidispense";

export function MedicineDetailsDialog({
  medicine,
  onClose,
  onChanged,
}: {
  medicine: Medicine;
  deleting: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(medicine.name);
  const [category, setCategory] = useState(medicine.category);
  const [price, setPrice] = useState(String(medicine.price));
  const [expiry, setExpiry] = useState(medicine.expiryDate);
  const lock = useRef(false);
  const [sameProduct, setSameProduct] = useState(false);
  const [genericName, setGenericName] = useState(medicine.genericName);
  const [description, setDescription] = useState(medicine.description);
  const [dosage, setDosage] = useState(medicine.dosage);
  const [instructions, setInstructions] = useState(medicine.instructions);
  const options = trpc.medicines.options.useQuery(undefined);
  const callbacks = {
    onSuccess: () => {
      toast.success("Medicine updated");
      onChanged();
      onClose();
    },
    onError: (error: { message: string }) => toast.error(error.message),
    onSettled: () => {
      lock.current = false;
    },
  };
  const update = trpc.medicines.update.useMutation(callbacks);
  const pending = update.isPending;
  const valid =
    sameProduct &&
    genericName.trim().length >= 2 &&
    description.trim().length >= 2 &&
    dosage.trim().length >= 2 &&
    instructions.trim().length >= 2 &&
    Number(price) > 0 &&
    name.trim().length >= 2 &&
    name.trim().length <= 180 &&
    !!category &&
    /^\d+(\.\d{1,2})?$/.test(price) &&
    Number(price) <= 99999999.99 &&
    !!expiry &&
    !!options.data;
  return (
    <div className="modal-backdrop">
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="medicine-dialog-title"
        onSubmit={event => {
          event.preventDefault();
          if (lock.current || !valid) return;
          lock.current = true;
          update.mutate({
            id: medicine.id,
            name: name.trim(),
            category,
            price: Number(price),
            expiryDate: expiry,
            slotNumber: medicine.slotNumber,
            sameProductConfirmed: true,
            genericName,
            description,
            dosage,
            instructions,
          });
        }}
      >
        <div className="modal-head">
          <h2 id="medicine-dialog-title">Edit medicine details</h2>
        </div>
        <>
          <p className="page-subtitle">
            Current stock: {medicine.stockQuantity}. Use Add Stock to restock.
          </p>
          <div className="form-grid">
            <label>
              Medicine name
              <input
                required
                minLength={2}
                maxLength={180}
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </label>
            <label>
              Category
              <select
                required
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {!options.data?.categories.includes(category) && (
                  <option value={category}>{category}</option>
                )}
                {options.data?.categories.map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Unit price
              <input
                required
                inputMode="decimal"
                value={price}
                onChange={e => setPrice(e.target.value)}
              />
              <small>Positive amount, up to 2 decimal places.</small>
            </label>
            <label>
              Expiry date
              <input
                required
                type="date"
                min="1000-01-01"
                max="9999-12-31"
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
              />
            </label>
            <label>
              Assigned slot
              <input
                readOnly
                value={
                  medicine.slotNumber
                    ? "Slot " + medicine.slotNumber
                    : "Unassigned"
                }
              />
            </label>
            <label>
              Generic name
              <input
                value={genericName}
                onChange={e => setGenericName(e.target.value)}
              />
            </label>
            <label className="span-2">
              Approved description
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </label>
            <label className="span-2">
              Approved dosage information
              <textarea
                value={dosage}
                onChange={e => setDosage(e.target.value)}
              />
            </label>
            <label className="span-2">
              Approved usage information
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
              />
            </label>
            <label className="span-2">
              <input
                type="checkbox"
                checked={sameProduct}
                onChange={e => setSameProduct(e.target.checked)}
              />{" "}
              This is the same medicine, strength and formulation. These edits
              only correct its details.
            </label>
          </div>
          <p className="page-subtitle">
            Use Replace Medicine for a different product. Expiry cannot change
            while old tablets remain.
          </p>
          {options.isLoading && <p>Loading categories and slots…</p>}
          {options.error && <p role="alert">{options.error.message}</p>}
        </>
        {update.error && <p role="alert">{update.error.message}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary-button" disabled={pending || !valid}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
