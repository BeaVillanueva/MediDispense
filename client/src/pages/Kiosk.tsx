import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Pill,
  LoaderCircle,
  ShoppingBag,
} from "lucide-react";
import { useKioskMedicines } from "@/hooks/useKioskMedicines";
import {
  type Purchase,
  peso,
  purchasable,
  purchaseTotal,
  quantityLimit,
  reviewPurchase,
} from "@/lib/kioskPurchase";
import { useKioskCheckout } from "@/hooks/useKioskCheckout";
import {
  Confirmation,
  MedicineImage,
  QuantityPicker,
} from "@/components/kiosk/KioskControls";
import { DraftNavigation } from "@/components/kiosk/DraftNavigation";
import { CheckoutPanel } from "@/components/kiosk/CheckoutPanel";
import { recoveryConfirmed } from "@/lib/dispensingTimeout";
import { medicineLabelDetails, medicineSaleUnit, medicineStockLabel } from "@/lib/medicineInformation";
import "./kiosk.css";
import "./kiosk-theme.css";

export default function Kiosk() {
  const medicines = useKioskMedicines();
  const checkout = useKioskCheckout();
  const [view, setView] = useState<"browse" | "quantity" | "review">("browse");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [category, setCategory] = useState("All medicines");
  const [confirmation, setConfirmation] = useState(false);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [browseWhileUnresolved, setBrowseWhileUnresolved] = useState(false);
  const checkLock = useRef(false);
  const main = useRef<HTMLElement>(null);
  const catalog = [...(medicines.data ?? [])].sort(
    (a, b) => (a.slotNumber ?? Number.MAX_SAFE_INTEGER) - (b.slotNumber ?? Number.MAX_SAFE_INTEGER) || a.id - b.id
  );
  const selected = catalog.find(item => item.id === selectedId);
  const reviewLabel = medicineLabelDetails(selected);
  const maximum = selected ? quantityLimit(selected) : 0;
  const selectedQuantity = Math.max(1, Math.min(quantity, maximum));
  const busy = checkout.busy || checking;
  const transaction = checkout.transaction;
  const machineAwaitingRecovery = catalog.some(medicine => medicine.machineReady === false);
  const browsingSavedPurchase = browseWhileUnresolved && !!transaction && ["pending", "dispensing"].includes(transaction.dispensingStatus);
  const stage = browsingSavedPurchase ? 0 : transaction
    ? checkout.paymentStatus === "SUCCESS"
      ? 5
      : transaction.paymentStatus === "successful"
        ? 4
        : 3
    : view === "quantity"
      ? 2
      : view === "review" ? 1 : 0;
  const categories = [
    "All medicines",
    ...Array.from(new Set(catalog.map(item => item.category).filter(Boolean))),
  ];
  const activeCategory = categories.includes(category)
    ? category
    : "All medicines";
  const changed = purchase ? reviewPurchase(purchase, catalog).changed : false;
  useEffect(() => {
    main.current?.focus();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view, stage]);
  useEffect(() => {
    if (view === "quantity") {
      setQuantity(value => Math.max(1, Math.min(value, maximum)));
      setPurchase(previous => {
        if (!previous || maximum < 1) return previous;
        const next = Math.max(1, Math.min(previous.quantity, maximum));
        return next === previous.quantity ? previous : { ...previous, quantity: next, totalAmount: purchaseTotal(previous.unitPrice, next) };
      });
    }
  }, [maximum, view]);
  const cancelDraft = () => {
    setConfirmation(false);
    // Do not clear a submitted, interrupted, recovering, or active purchase session.
    if (transaction || busy || checkout.error) return;
    setPurchase(null);
    setSelectedId(null);
    setQuantity(1);
    setView("browse");
    setNotice("");
    setCategory("All medicines");
  };
  const reset = async () => {
    if (!(await checkout.reset())) return;
    setBrowseWhileUnresolved(false);
    setPurchase(null);
    setSelectedId(null);
    setQuantity(1);
    setView("browse");
    setNotice("");
    setCategory("All medicines");
    void medicines.refetch();
  };
  useEffect(() => {
    if ((recoveryConfirmed(transaction) || (browseWhileUnresolved && transaction?.dispensingStatus === "failed" && !transaction.issueRecovery)) && !checkout.busy && !checkout.error) {
      void reset();
    }
  }, [transaction?.adminRecovered, transaction?.dispensingStatus, transaction?.issueRecovery?.revision, transaction?.issueRecovery?.machineReuseReady, browseWhileUnresolved, checkout.busy, checkout.error]);
  const continueToQuantity = () => {
    if (
      !selected ||
      maximum < selectedQuantity ||
      medicines.isError ||
      busy ||
      checkout.error
    )
      return;
    setPurchase({
      selectedMedicine: { ...selected },
      quantity: selectedQuantity,
      unitPrice: selected.price,
      totalAmount: purchaseTotal(selected.price, selectedQuantity),
    });
    setNotice("");
    setView("quantity");
  };
  async function proceed() {
    if (checkLock.current || busy || transaction || checkout.error || !purchase)
      return;
    checkLock.current = true;
    setChecking(true);
    setNotice("");
    try {
      const fresh = await medicines.refetch();
      if (fresh.error || !fresh.data) {
        setNotice(
          "Unable to check availability. Please try again when the connection returns."
        );
        return;
      }
      if (reviewPurchase(purchase, fresh.data).changed) {
        setNotice(
          "Price or availability changed. Go back to review the medicine and quantity before paying."
        );
        return;
      }
      await checkout.start(purchase);
    } finally {
      setChecking(false);
      checkLock.current = false;
    }
  }
  return (
    <div className="kv-shell">
      <header className="kv-header">
        <div className="kv-brand">
          <span className="kv-brand-icon">
            <Pill size={30} />
          </span>
          <div>
            <strong>
              Medi<span>Dispense</span>
            </strong>
            <small>Medicine Vending Kiosk</small>
          </div>
        </div>
        <span className="kv-preview-label">
          Customer kiosk · Coin payment only
        </span>
      </header>
      {checkout.preview && <div className="kv-preview-banner">
        Development preview · Sample inventory and simulated coins. No real money or medicine is dispensed.
      </div>}
      <main className="kv-main" ref={main} tabIndex={-1}>
        <nav aria-label="Purchase progress">
          <ol className="kv-steps">
            {[
              "Choose",
              "Review",
              "Quantity",
              "Payment",
              "Dispense",
              "Complete",
            ].map((label, index) => (
              <li
                key={label}
                aria-current={stage === index ? "step" : undefined}
                className={stage >= index ? "is-active" : ""}
              >
                <span>{stage > index ? <Check size={18} /> : index + 1}</span>
                <strong>{label}</strong>
              </li>
            ))}
          </ol>
        </nav>
        {notice && !transaction && (
          <div className="kv-message" role="status">
            {notice}
          </div>
        )}
        {checkout.recovering && (
          <div className="kv-message" role="status">
            Checking your saved purchase…
          </div>
        )}
        {checkout.recoveryMessage && !checkout.error && <div className="kv-message" role="status">{checkout.recoveryMessage}</div>}
        {checkout.error && (
          <div className="kv-message kv-error" role="alert">
            {checkout.error}
            <button
              className="kv-button kv-secondary"
              disabled={busy}
              onClick={() => void checkout.recover(true)}
            >
              {checkout.recovering ? "Checking purchase…" : "Reconnect / check purchase"}
            </button>
            {checkout.canRetrySavedCheckout && <button className="kv-button kv-secondary" disabled={busy} onClick={()=>void checkout.retrySavedCheckout()}>Retry same saved checkout</button>}
            {transaction && <strong> Reference: {transaction.id}</strong>}
          </div>
        )}
        {transaction && !browsingSavedPurchase ? (
          <CheckoutPanel
            checkout={checkout}
            medicine={catalog.find(medicine => medicine.id === transaction.items[0]?.medicineId && medicine.name === transaction.items[0]?.medicineName)}
            onFinish={reset}
            onBrowse={() => { setBrowseWhileUnresolved(true); setView("browse"); setSelectedId(null); setPurchase(null); setQuantity(1); setCategory("All medicines"); }}
            onBack={async () => {
              if (await checkout.reset()) {
                setView(purchase ? "quantity" : "browse");
                void medicines.refetch();
              }
            }}
          />
        ) : (
          <>
            {medicines.isError && (
              <div className="kv-message kv-error" role="alert">
                Unable to refresh medicine availability. Purchasing is paused
                until we reconnect.
                <button
                  className="kv-button kv-secondary"
                  disabled={medicines.isFetching}
                  onClick={() => void medicines.refetch()}
                >
                  {medicines.isFetching ? "Reconnecting…" : "Try again"}
                </button>
              </div>
            )}
            {view === "browse" && (
              <>
                <section className="kv-intro kv-selection-status" aria-label="Medicine availability">
                  {(browsingSavedPurchase || machineAwaitingRecovery || medicines.isPending || medicines.isError) && <span className="kv-inventory-note">
                    {browsingSavedPurchase ? <button className="kv-button kv-secondary" onClick={() => setBrowseWhileUnresolved(false)}>Machine needs assistance · View purchase</button> : machineAwaitingRecovery ? "Machine awaiting staff recovery" : medicines.isPending
                      ? "Checking availability…"
                      : medicines.isError
                        ? "Connection interrupted"
                        : "Availability refreshes automatically"}
                  </span>}
                </section>
                {catalog.length > 0 && (
                  <div
                    className="kv-categories"
                    aria-label="Medicine categories"
                  >
                    {categories.map(value => (
                      <button
                        key={value}
                        aria-pressed={activeCategory === value}
                        onClick={() => setCategory(value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                )}
                {medicines.isPending ? (
                  <div className="kv-empty" role="status">
                    <LoaderCircle className="kv-spin" size={32} />
                    <h2>Loading medicines</h2>
                    <p>Checking what is available in this machine.</p>
                  </div>
                ) : !medicines.isError && catalog.length === 0 ? (
                  <div className="kv-empty">
                    <ShoppingBag size={36} />
                    <h2>No medicines available right now</h2>
                    <p>Please ask pharmacy staff for assistance.</p>
                    <button
                      className="kv-button kv-secondary"
                      disabled={medicines.isFetching}
                      onClick={() => void medicines.refetch()}
                    >
                      Check again
                    </button>
                  </div>
                ) : (
                  <div className="kv-products">
                    {catalog
                      .filter(
                        item =>
                          activeCategory === "All medicines" ||
                          item.category === activeCategory
                      )
                      .map(medicine => (
                        <article className="kv-product" key={medicine.id}>
                          <div className="kv-product-image">
                            <MedicineImage
                              key={medicine.imageUrl}
                              src={medicine.imageUrl}
                              name={medicine.name}
                            />
                          </div>
                          <div className="kv-product-copy">
                            <p className="kv-eyebrow">{medicine.category}</p>
                            <h2>{medicine.name}</h2>
                            <div className="kv-product-price">
                              <strong>{peso(medicine.price)}</strong>
                              <span>/ {medicineSaleUnit(medicine)}</span>
                            </div>
                            <p
                              className={`kv-stock ${purchasable(medicine) ? "" : "kv-unavailable"}`}
                            >
                              {purchasable(medicine)
                                ? medicineStockLabel(medicine)
                                : medicine.unavailableReason ?? (medicine.stockQuantity < 1 ? "Out of stock" : "Currently unavailable")}
                            </p>
                            <button
                              className="kv-button kv-primary kv-wide"
                              disabled={
                                browsingSavedPurchase ||
                                busy ||
                                !!checkout.error ||
                                medicines.isError ||
                                !purchasable(medicine)
                              }
                              onClick={() => {
                                setSelectedId(medicine.id);
                                if (selectedId !== medicine.id) { setPurchase(null); setQuantity(1); }
                                setNotice("");
                                setView("review");
                              }}
                            >
                              Select <ArrowRight size={20} />
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                )}
              </>
            )}

            {view === "quantity" && (
              <>
                {selected ? (
                  <section className="kv-details kv-quantity-screen" aria-label="Select quantity">
                    <div className="kv-detail-image">
                      <MedicineImage
                        key={selected.imageUrl}
                        src={selected.imageUrl}
                        name={selected.name}
                      />
                    </div>
                    <div>
                      <p className="kv-eyebrow">
                        {selected.category}
                      </p>
                      <h1>Select Quantity</h1>
                      <h2>{selected.name}</h2>
                      <div className="kv-detail-price">
                        {peso(selected.price)} <span>per unit</span>
                      </div>
                      <p className="kv-stock">
                        {selected.stockQuantity} available
                      </p>
                      <div className="kv-quantity-section">
                        <h2>Choose quantity</h2>
                        <p className="kv-quantity-hint">
                          Up to {maximum} per purchase
                        </p>
                        <QuantityPicker
                          value={selectedQuantity}
                          maximum={maximum}
                          name={selected.name}
                          onChange={value => {
                            setQuantity(value);
                            setPurchase(previous => previous ? { ...previous, quantity: value, totalAmount: purchaseTotal(previous.unitPrice, value) } : null);
                          }}
                          disabled={
                            maximum === 0 ||
                            medicines.isError ||
                            busy ||
                            !!checkout.error
                          }
                        />
                        <div className="kv-selection-total">
                          <span>Total</span>
                          <strong>
                            {peso(
                              purchaseTotal(selected.price, selectedQuantity)
                            )}
                          </strong>
                        </div>
                      </div>
                      {changed && <div className="kv-message kv-error" role="alert">Price or availability changed. Go back to Review before paying.</div>}

                    </div>
                    <DraftNavigation primaryLabel={busy ? "Checking purchase..." : "Proceed to Payment"}
                      disabled={busy || !!checkout.error} primaryDisabled={!purchase || changed || maximum < selectedQuantity || medicines.isError}
                      onBack={() => { setNotice(""); setView("review"); }} onContinue={() => void proceed()} onCancel={() => setConfirmation(true)} />
                  </section>
                ) : (
                  <div className="kv-empty">
                    <h1>This medicine is no longer available</h1>
                    <p>
                      Please return to the selection to choose another medicine.
                    </p>
                    <button className="kv-button kv-secondary" disabled={busy || !!checkout.error} onClick={() => setView("browse")}><ArrowLeft size={20} /> Back to medicines</button>
                  </div>
                )}
              </>
            )}
            {view === "review" && (
              <section className="kv-panel kv-purchase-review">
                <h1>Review Purchase</h1>
                {selected ? <>
                  <section className="kv-review-information" aria-label="Medicine information">
                    <div className="kv-review-medicine">
                      <div className="kv-medicine-thumbnail"><MedicineImage src={selected.imageUrl} name={selected.name} /></div>
                      <div className="kv-review-medicine-details">
                        <p className="kv-eyebrow">{selected.category}</p>
                        <h2>{selected.name}</h2>
                        <dl className="kv-label-details">
                          <div><dt>Strength</dt><dd>{reviewLabel.strength || "Refer to packaging"}</dd></div>
                          {reviewLabel.type && <div><dt>Type</dt><dd>{reviewLabel.type}</dd></div>}
                          <div><dt>Unit price</dt><dd>{peso(selected.price)}</dd></div>
                        </dl>
                        <div className="kv-review-description">
                          <h3>Description &amp; Common Uses</h3>
                          <p>{selected.description?.trim() || "Medicine information is not available. Please check the packaging or ask a pharmacist."}</p>
                        </div>
                      </div>
                    </div>
                  </section>
                  <DraftNavigation primaryLabel="Continue" disabled={busy || !!checkout.error} primaryDisabled={maximum < 1 || medicines.isError}
                    onBack={() => { setNotice(""); setView("browse"); }} onContinue={continueToQuantity} onCancel={() => setConfirmation(true)} />
                </> : <div className="kv-empty"><p>This medicine is no longer available.</p><button className="kv-button kv-secondary" onClick={() => setView("browse")}>Back to medicines</button></div>}
              </section>
            )}
          </>
        )}
      </main>
      <footer className="kv-footer">
        <span>MediDispense · Exact coins only · No change</span>
        <span>Need help? Please ask pharmacy staff.</span>
      </footer>
      <Confirmation
        open={confirmation}
        title="Cancel Purchase?"
        description="Are you sure you want to cancel this purchase and return to medicine selection?"
        action="Yes, Cancel"
        cancelLabel="Keep Purchase"
        onCancel={() => setConfirmation(false)}
        onConfirm={cancelDraft}
      />
    </div>
  );
}
