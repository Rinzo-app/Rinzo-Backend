import { getPricing } from "./pricing-config.js";

/**
 * Compute the customer-facing delivery fee in paise.
 *
 * - With a known customer↔shop distance: round-trip km × rate,
 *   floored at the minimum fee.
 * - Without coordinates: the fallback fee — delivery is a real cost;
 *   missing GPS must never make it free (it also starves the
 *   rider-payout distance chain).
 *
 * Rates come from the operator-configurable pricing cache.
 */
export function computeDeliveryFee(oneWayDistanceM: number | null): number {
  const { deliveryRatePerKm, minDeliveryFee, fallbackDeliveryFee } = getPricing();
  if (oneWayDistanceM == null || !Number.isFinite(oneWayDistanceM)) {
    return fallbackDeliveryFee;
  }
  const roundTripKm = (oneWayDistanceM / 1000) * 2;
  return Math.max(Math.round(roundTripKm * deliveryRatePerKm), minDeliveryFee);
}
