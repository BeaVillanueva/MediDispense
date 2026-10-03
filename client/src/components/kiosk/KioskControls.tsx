import { useState } from "react";
import { Minus, Pill, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function MedicineImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} alt={name} onError={() => setFailed(true)} />
  ) : (
    <div
      className="kv-image-placeholder"
      aria-label={`No image available for ${name}`}
    >
      <Pill size={48} />
      <span>Medicine image unavailable</span>
    </div>
  );
}
export function NoChangeNotice() {
  return (
    <aside className="kv-no-change">
      <TriangleAlert size={26} />
      <div>
        <strong>EXACT AMOUNT ONLY</strong>
        <p>THIS MACHINE DOES NOT PROVIDE CHANGE.</p>
        <small>Inserted coins cannot be returned.</small>
      </div>
    </aside>
  );
}
export function QuantityPicker({
  value,
  maximum,
  name,
  onChange,
  disabled = false,
}: {
  value: number;
  maximum: number;
  name: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="kv-quantity"
      role="group"
      aria-label={`Quantity for ${name}`}
    >
      <button
        disabled={disabled || value <= 1}
        aria-label={`Decrease ${name} quantity`}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={20} />
      </button>
      <output aria-label={`${name} quantity`}>{value}</output>
      <button
        disabled={disabled || value >= maximum}
        aria-label={`Increase ${name} quantity`}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={20} />
      </button>
    </div>
  );
}
export function SafetyNotice() {
  return (
    <aside className="kv-safety">
      <ShieldCheck size={24} />
      <div>
        <strong>Please read before purchase</strong>
        <p>
          Read the medicine label and follow the recommended dosage. If unsure,
          consult a pharmacist or healthcare professional.
        </p>
      </div>
    </aside>
  );
}
export function Confirmation({
  open,
  title,
  description,
  action,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={value => {
        if (!value) onCancel();
      }}
    >
      <AlertDialogContent className="kv-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
