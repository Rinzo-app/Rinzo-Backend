import type { PaymentProvider } from "./provider.js";
import { phonePeProvider } from "./phonepe.js";
import { simulatedProvider } from "./simulated.js";

export * from "./provider.js";

/** Active provider, selected by PAYMENT_PROVIDER (default: simulated). */
export function getPaymentProvider(): PaymentProvider {
  return (process.env.PAYMENT_PROVIDER ?? "simulated") === "phonepe"
    ? phonePeProvider
    : simulatedProvider;
}
