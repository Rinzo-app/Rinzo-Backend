// ─────────────────────────────────────────────────────────
// PAYMENT PROVIDER ABSTRACTION
//
// The platform talks to online-payment gateways through this
// interface. Which provider is active is decided by the
// PAYMENT_PROVIDER env var:
//   - "phonepe"   → PhonePe Standard Checkout V2 (sandbox or prod
//                    depending on PHONEPE_BASE_URL)
//   - "simulated" → in-process fake used for tests and while real
//                    gateway credentials are pending
// ─────────────────────────────────────────────────────────

export interface CreatePaymentInput {
  /** Our payment row id — used as the merchant order id */
  paymentId: string;
  orderId: string;
  /** Amount in paise */
  amount: number;
  /** Where the gateway should send the user after payment */
  redirectUrl: string;
}

export interface CreatePaymentResult {
  /** URL the customer opens to complete the payment */
  checkoutUrl: string;
  /** The id the provider knows this payment by */
  providerOrderId: string;
}

export type ProviderPaymentStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getStatus(providerOrderId: string): Promise<ProviderPaymentStatus>;
}
