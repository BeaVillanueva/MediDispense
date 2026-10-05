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
  return <MedicineImageLoader key={`${src}:${name}`} src={src} name={name} />;
}

function MedicineImageLoader({ src, name }: { src: string; name: string }) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  // Presentation artwork only. Names, prices, stock and labels still come from the API.
  const artwork = /\bparacetamol\b/i.test(name)
    ? "paracetamol"
    : /\bbioflu\b/i.test(name)
      ? "bioflu"
      : /\bcetirizine\b/i.test(name)
        ? "cetirizine"
        : "medicine";
  const useStoredImage = !!src && !failedSources.includes(src);
  const imageSource = useStoredImage
    ? src
    : `${import.meta.env.BASE_URL}images/kiosk/${artwork}.svg`;
  const exhausted = failedSources.includes(imageSource);
  const loaded = !exhausted && loadedSource === imageSource;
  return (
    <div
      className="kv-medicine-art"
      role="img"
      aria-label={
        useStoredImage
          ? name
          : `Demo illustration for ${name}, not actual packaging`
      }
    >
      {!loaded && (
        <div className="kv-art-fallback" aria-hidden="true">
          <Pill size={56} />
        </div>
      )}
      {!exhausted && (
        <img
          key={imageSource}
          src={imageSource}
          alt=""
          aria-hidden="true"
          style={{ visibility: loaded ? "visible" : "hidden" }}
          onLoad={() => setLoadedSource(imageSource)}
          onError={() =>
            setFailedSources(previous => [...previous, imageSource])
          }
        />
      )}
      {!useStoredImage && (
        <small className="kv-art-label">Demo illustration</small>
      )}
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
