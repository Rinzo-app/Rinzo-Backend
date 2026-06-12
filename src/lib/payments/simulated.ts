import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  ProviderPaymentStatus,
} from "./provider.js";

// ─────────────────────────────────────────────────────────
// SIMULATED PROVIDER
//
// Used in tests and while real gateway credentials are pending.
// Behaviour: a created payment reports PENDING on the first status
// check and SUCCESS afterwards — mimicking "user paid in the
// checkout and came back".
// ─────────────────────────────────────────────────────────

const seen = new Map<string, number>();

export const simulatedProvider: PaymentProvider = {
  name: "simulated",

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerOrderId = `SIM-${input.paymentId}`;
    seen.set(providerOrderId, 0);
    return {
      checkoutUrl: `https://example.com/simulated-checkout?ref=${providerOrderId}&redirect=${encodeURIComponent(input.redirectUrl)}`,
      providerOrderId,
    };
  },

  async getStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    const checks = seen.get(providerOrderId);
    if (checks === undefined) return "PENDING"; // unknown (e.g. server restart)
    seen.set(providerOrderId, checks + 1);
    return checks === 0 ? "PENDING" : "SUCCESS";
  },
};
