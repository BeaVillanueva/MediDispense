/** Decorative artwork only; payment state comes from the existing checkout. */
export function CoinPaymentIllustration() {
  return <img className="kv-payment-illustration" src={`${import.meta.env.BASE_URL}images/kiosk/payment/hand.png`} alt="" aria-hidden="true" width={144} height={144} />;
}
