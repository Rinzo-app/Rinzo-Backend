// ─────────────────────────────────────────────────────────
// WEIGHING / PRICE ADJUSTMENT
//
// Customers estimate quantities at checkout (laundry is priced
// per kg, but nobody owns a luggage scale). The shop weighs the
// laundry when it arrives (AT_SHOP) and the price adjusts:
//
//   - decreases and small increases apply automatically
//   - increases above AUTO_APPROVE_INCREASE_PCT (vs the customer's
//     original estimate) pause the order until the customer
//     approves the new price in the app
// ─────────────────────────────────────────────────────────

/** Price increases beyond this percentage need customer approval. */
export const AUTO_APPROVE_INCREASE_PCT = 20;

export interface WeighedItem {
  /** Unit price in paise */
  price: number;
  /** Measured quantity (kg can be fractional) */
  actualQuantity: number;
}

/** Total in paise for the measured quantities. */
export function computeWeighedTotal(items: readonly WeighedItem[]): number {
  let total = 0;
  for (const it of items) {
    total += Math.round(it.price * it.actualQuantity);
  }
  return total;
}

export type AdjustmentDecision = "APPLY" | "NEEDS_APPROVAL";

/**
 * Decide whether a weighed total can apply automatically.
 *
 * @param baselineTotal The total the customer originally agreed to
 *                      (their checkout estimate), in paise.
 * @param weighedTotal  The total computed from actual weights.
 */
export function decideAdjustment(
  baselineTotal: number,
  weighedTotal: number,
): AdjustmentDecision {
  if (weighedTotal <= baselineTotal) return "APPLY";
  const increasePct = ((weighedTotal - baselineTotal) / baselineTotal) * 100;
  return increasePct > AUTO_APPROVE_INCREASE_PCT ? "NEEDS_APPROVAL" : "APPLY";
}
