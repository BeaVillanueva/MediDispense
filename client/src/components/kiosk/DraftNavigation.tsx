import { ArrowLeft, ArrowRight } from "lucide-react";

export function DraftNavigation({ primaryLabel, disabled, primaryDisabled, onBack, onContinue, onCancel }: {
  primaryLabel: string;
  disabled: boolean;
  primaryDisabled: boolean;
  onBack: () => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return <div className="kv-draft-navigation">
    <div className="kv-actions">
      <button className="kv-button kv-secondary" disabled={disabled} onClick={onBack}><ArrowLeft size={20} /> Back</button>
      <button className="kv-button kv-primary" disabled={disabled || primaryDisabled} onClick={onContinue}>{primaryLabel} <ArrowRight size={20} /></button>
    </div>
    <button className="kv-button kv-cancel-draft" disabled={disabled} onClick={onCancel}>Cancel Purchase</button>
  </div>;
}
