import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FlaskConical,
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
  NoChangeNotice,
  QuantityPicker,
  SafetyNotice,
} from "@/components/kiosk/KioskControls";
import { CheckoutPanel } from "@/components/kiosk/CheckoutPanel";
import "./kiosk.css";

export default function Kiosk() {
  const medicines = useKioskMedicines();
  const checkout = useKioskCheckout();
  const [view, setView] = useState<"browse" | "details" | "review">("browse");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [category, setCategory] = useState("All medicines");
  const [confirmation, setConfirmation] = useState(false);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const checkLock = useRef(false);
  const main = useRef<HTMLElement>(null);
  const catalog = medicines.data ?? [];
  const selected = catalog.find(item => item.id === selectedId);
  const maximum = selected ? quantityLimit(selected) : 0;
  const selectedQuantity = Math.max(1, Math.min(quantity, maximum));
  const busy = checkout.busy || checking;
  const transaction = checkout.transaction;
  const stage = transaction
    ? checkout.paymentStatus === "SUCCESS"
      ? 4
      : transaction.paymentStatus === "successful"
        ? 3
        : 2
    : view === "review"
      ? 1
      : 0;
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
    if (view === "details")
      setQuantity(value => Math.max(1, Math.min(value, maximum)));
  }, [maximum, view]);
  const reset = async () => {
    if (!(await checkout.reset())) return;
    setPurchase(null);
    setSelectedId(null);
    setQuantity(1);
    setView("browse");
    setNotice("");
    setCategory("All medicines");
    void medicines.refetch();
  };
  const buyNow = () => {
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
    setView("review");
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
            <FlaskConical size={28} />
          </span>
          <div>
            <strong>
              Medi<span>Dispense</span>
            </strong>
            <small>Your self-service medicine station</small>
          </div>
        </div>
        <span className="kv-preview-label">
          Customer kiosk · Coin payment only
        </span>
      </header>
      <div className="kv-preview-banner">
        {checkout.simulationEnabled
          ? "Development preview · Sample inventory and simulated coins. No real money or medicine is dispensed."
          : "Preview catalog · Coin payment is unavailable until the physical payment service is connected. Do not insert coins."}
      </div>
      <main className="kv-main" ref={main} tabIndex={-1}>
        <nav aria-label="Purchase progress">
          <ol className="kv-steps">
            {[
              "Choose medicine",
              "Review purchase",
              "Coin payment",
              "Dispensing",
              "Success",
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
            Recovering your saved purchase…
          </div>
        )}
        {checkout.error && (
          <div className="kv-message kv-error" role="alert">
            {checkout.error}
            <button
              className="kv-button kv-secondary"
              disabled={busy}
              onClick={() => void checkout.recover()}
            >
              Reconnect / check purchase
            </button>
            {transaction && <strong> Reference: {transaction.id}</strong>}
          </div>
        )}
        {transaction ? (
          <CheckoutPanel
            checkout={checkout}
            onFinish={reset}
            onBack={async () => {
              if (await checkout.reset()) {
                setView(purchase ? "review" : "browse");
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
                <section className="kv-intro">
                  <div>
                    <p className="kv-eyebrow">Care within reach</p>
                    <h1>What do you need today?</h1>
                    <p>
                      Select one medicine, read its information, and choose your
                      quantity.
                    </p>
                  </div>
                  <span className="kv-inventory-note">
                    {medicines.isPending
                      ? "Checking availability…"
                      : medicines.isError
                        ? "Connection interrupted"
                        : "Availability refreshes automatically"}
                  </span>
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
                            <span>Slot {medicine.slotNumber}</span>
                          </div>
                          <div className="kv-product-copy">
                            <p className="kv-eyebrow">{medicine.category}</p>
                            <h2>{medicine.name}</h2>
                            <p>
                              {medicine.genericName ||
                                "Generic information not provided"}
                            </p>
                            <div className="kv-product-price">
                              <strong>{peso(medicine.price)}</strong>
                              <span>per unit</span>
                            </div>
                            <p
                              className={`kv-stock ${purchasable(medicine) ? "" : "kv-unavailable"}`}
                            >
                              {purchasable(medicine)
                                ? `${medicine.stockQuantity} available`
                                : "Currently unavailable"}
                            </p>
                            <button
                              className="kv-button kv-primary kv-wide"
                              disabled={
                                busy ||
                                !!checkout.error ||
                                medicines.isError ||
                                !purchasable(medicine)
                              }
                              onClick={() => {
                                setSelectedId(medicine.id);
                                setPurchase(null);
                                setQuantity(1);
                                setNotice("");
                                setView("details");
                              }}
                            >
                              Select medicine <ArrowRight size={20} />
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                )}
                <SafetyNotice />
              </>
            )}

            {view === "details" && (
              <>
                <button
                  className="kv-button kv-back"
                  disabled={busy || !!checkout.error}
                  onClick={() => {
                    setPurchase(null);
                    setView("browse");
                  }}
                >
                  <ArrowLeft size={20} /> Back to medicines
                </button>
                {selected ? (
                  <section className="kv-details">
                    <div className="kv-detail-image">
                      <MedicineImage
                        key={selected.imageUrl}
                        src={selected.imageUrl}
                        name={selected.name}
                      />
                    </div>
                    <div>
                      <p className="kv-eyebrow">
                        {selected.category} · Slot {selected.slotNumber}
                      </p>
                      <h1>{selected.name}</h1>
                      <p>{selected.genericName}</p>
                      <div className="kv-detail-price">
                        {peso(selected.price)} <span>per unit</span>
                      </div>
                      <p className="kv-stock">
                        {selected.stockQuantity} available
                      </p>
                      <div className="kv-information">
                        <h2>Medicine information</h2>
                        <p>
                          {selected.description || "No description provided."}
                        </p>
                        <h2>Stored dosage & usage information</h2>
                        <p>
                          {selected.dosage || "No dosage information provided."}
                        </p>
                        <p>{selected.instructions}</p>
                        {selected.expiryDate && (
                          <p>
                            <strong>Expiry date:</strong> {selected.expiryDate}
                          </p>
                        )}
                      </div>
                      <SafetyNotice />
                      <div className="kv-quantity-section">
                        <h2>Choose quantity</h2>
                        <QuantityPicker
                          value={selectedQuantity}
                          maximum={maximum}
                          name={selected.name}
                          onChange={setQuantity}
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
                      <button
                        className="kv-button kv-primary kv-wide"
                        disabled={
                          maximum < selectedQuantity ||
                          medicines.isError ||
                          busy ||
                          !!checkout.error
                        }
                        onClick={buyNow}
                      >
                        Buy Now <ArrowRight size={20} />
                      </button>
                    </div>
                  </section>
                ) : (
                  <div className="kv-empty">
                    <h1>This medicine is no longer available</h1>
                    <p>
                      Please return to the selection to choose another medicine.
                    </p>
                  </div>
                )}
              </>
            )}
            {view === "review" && purchase && (
              <section className="kv-panel kv-purchase-review">
                <p className="kv-eyebrow">Before inserting coins</p>
                <h1>Review purchase</h1>
                <div className="kv-review-medicine">
                  <div className="kv-medicine-thumbnail">
                    <MedicineImage
                      src={purchase.selectedMedicine.imageUrl}
                      name={purchase.selectedMedicine.name}
                    />
                  </div>
                  <div>
                    <h2>{purchase.selectedMedicine.name}</h2>
                    <p>{purchase.selectedMedicine.genericName}</p>
                  </div>
                </div>
                <dl className="kv-review-totals">
                  <div>
                    <dt>Unit price</dt>
                    <dd>{peso(purchase.unitPrice)}</dd>
                  </div>
                  <div>
                    <dt>Quantity</dt>
                    <dd>{purchase.quantity}</dd>
                  </div>
                  <div className="kv-total">
                    <dt>Total amount</dt>
                    <dd>{peso(purchase.totalAmount)}</dd>
                  </div>
                </dl>
                <NoChangeNotice />
                <p>
                  You can change your selection or cancel before inserting
                  coins. Once payment begins, inserted coins cannot be returned.
                </p>
                {changed && (
                  <div className="kv-message kv-error" role="alert">
                    Price or stock changed. Go back and review your selection
                    again.
                  </div>
                )}
                {!checkout.preview && (
                  <div className="kv-message" role="status">
                    Your purchase will be saved in the database. Payment waits
                    for trusted coin acceptor events. Hardware integration is
                    pending.
                  </div>
                )}
                <div className="kv-actions">
                  <button
                    className="kv-button kv-secondary"
                    disabled={busy || !!checkout.error}
                    onClick={() => {
                      setNotice("");
                      setView("details");
                    }}
                  >
                    Back
                  </button>
                  <button
                    className="kv-button kv-primary"
                    disabled={
                      busy || changed || medicines.isError || !!checkout.error
                    }
                    onClick={() => void proceed()}
                  >
                    {busy ? "Checking purchase…" : "Proceed to payment"}
                    <ArrowRight size={20} />
                  </button>
                </div>
                <button
                  className="kv-button kv-back"
                  disabled={busy || !!checkout.error}
                  onClick={() => setConfirmation(true)}
                >
                  Cancel purchase
                </button>
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
        title="Cancel this purchase?"
        description="Your selection will be cleared and you will return to the medicine selection."
        action="Cancel purchase"
        onCancel={() => setConfirmation(false)}
        onConfirm={() => {
          setConfirmation(false);
          reset();
        }}
      />
    </div>
  );
}
