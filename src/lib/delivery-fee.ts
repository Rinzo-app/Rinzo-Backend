import {
  DELIVERY_RATE_PER_KM,
  MIN_DELIVERY_FEE,
  FALLBACK_DELIVERY_FEE,
} from "../config/delivery.js";

/**
 * Compute the customer-facing delivery fee in paise.
 *
 * - With a known customer↔shop distance: round-trip km × rate,
 *   floored at MIN_DELIVERY_FEE.
 * - Without coordinates: FALLBACK_DELIVERY_FEE — delivery is a real
 *   cost; missing GPS must never make it free (it also starves the
 *   rider-payout distance chain).
 */
export function computeDeliveryFee(oneWayDistanceM: number | null): number {
  if (oneWayDistanceM == null || !Number.isFinite(oneWayDistanceM)) {
    return FALLBACK_DELIVERY_FEE;
  }
  const roundTripKm = (oneWayDistanceM / 1000) * 2;
  return Math.max(Math.round(roundTripKm * DELIVERY_RATE_PER_KM), MIN_DELIVERY_FEE);
}
