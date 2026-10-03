import { peso } from "@/lib/kioskPurchase";

// Both rendering and the adapter handlers are development-gated. No production
// customer can type a balance or manually confirm a sensor through these controls.
export function DevelopmentControls({
  enabled,
  busy,
  coinInput,
  unitNumber,
  onCoin,
  onUnit,
}: {
  enabled: boolean;
  busy: boolean;
  coinInput: boolean;
  unitNumber?: number;
  onCoin: (amount: number) => void;
  onUnit: (unit: number, success: boolean) => void;
}) {
  if (!import.meta.env.DEV || !enabled) return null;
  return (
    <div className="kv-demo-controls">
      <strong>
        {coinInput
          ? "DEVELOPMENT / PAYMENT SIMULATION"
          : "DEVELOPMENT / DISPENSING SIMULATION"}
      </strong>
      <p>
        {coinInput
          ? "Simulated coins only. Each button adds its full value, including any excess."
          : "One simulated confirmation per unit. No motor or physical sensor is connected."}
      </p>
      <div className="kv-actions">
        {coinInput
          ? [1, 5, 10, 20].map(amount => (
              <button
                className="kv-button kv-secondary"
                key={amount}
                disabled={busy}
                onClick={() => onCoin(amount)}
              >
                + {peso(amount)}
              </button>
            ))
          : unitNumber !== undefined && (
              <>
                <button
                  className="kv-button kv-primary"
                  disabled={busy}
                  onClick={() => onUnit(unitNumber, true)}
                >
                  Confirm unit {unitNumber} dropped
                </button>
                <button
                  className="kv-button kv-secondary"
                  disabled={busy}
                  onClick={() => onUnit(unitNumber, false)}
                >
                  Simulate unit {unitNumber} failure
                </button>
              </>
            )}
      </div>
    </div>
  );
}
