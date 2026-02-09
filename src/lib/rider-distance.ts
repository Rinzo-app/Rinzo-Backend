// ─────────────────────────────────────────────────────────
// Rider distance resolver
//
// Determines the one-way distance for a rider leg using a
// strict priority chain:
//
//   1. GEO_CUSTOMER_SHOP  — customer ↔ shop  (Haversine)
//   2. GEO_RIDER_SHOP     — rider   ↔ shop  (Haversine)
//   3. ESTIMATED_FROM_FEE  — derived from deliveryFee
//
// Returns { distanceKm, source } or null when no method
// can produce a distance.
// ─────────────────────────────────────────────────────────

import { haversineDistance } from "./geo.js";

export type DistanceSource =
  | "GEO_CUSTOMER_SHOP"
  | "GEO_RIDER_SHOP"
  | "ESTIMATED_FROM_FEE";

export interface ResolveDistanceOpts {
  leg: "PICKUP" | "DROP";
  customer?: { lat: number; lng: number } | null;
  shop?: { lat: number; lng: number } | null;
  rider?: { lat: number; lng: number } | null;
  deliveryFeePaise?: number;
  deliveryRatePerKm?: number;
}

export interface ResolvedDistance {
  distanceKm: number;
  source: DistanceSource;
}

/**
 * Resolve the one-way distance for a single rider leg.
 *
 * @returns `{ distanceKm, source }` or `null` if no method succeeds.
 */
export function resolveRiderLegDistanceKm(
  opts: ResolveDistanceOpts,
): ResolvedDistance | null {
  const { leg, customer, shop, rider, deliveryFeePaise, deliveryRatePerKm } = opts;

  // ── 1. GEO_CUSTOMER_SHOP (primary) ────────────────────
  if (
    customer?.lat != null &&
    customer?.lng != null &&
    shop?.lat != null &&
    shop?.lng != null &&
    Number.isFinite(customer.lat) &&
    Number.isFinite(customer.lng) &&
    Number.isFinite(shop.lat) &&
    Number.isFinite(shop.lng)
  ) {
    const distanceM =
      leg === "PICKUP"
        ? haversineDistance(customer.lat, customer.lng, shop.lat, shop.lng)
        : haversineDistance(shop.lat, shop.lng, customer.lat, customer.lng);

    return {
      distanceKm: distanceM / 1000,
      source: "GEO_CUSTOMER_SHOP",
    };
  }

  // ── 2. GEO_RIDER_SHOP (fallback) ─────────────────────
  if (
    rider?.lat != null &&
    rider?.lng != null &&
    shop?.lat != null &&
    shop?.lng != null &&
    Number.isFinite(rider.lat) &&
    Number.isFinite(rider.lng) &&
    Number.isFinite(shop.lat) &&
    Number.isFinite(shop.lng)
  ) {
    const distanceM =
      leg === "PICKUP"
        ? haversineDistance(rider.lat, rider.lng, shop.lat, shop.lng)
        : haversineDistance(shop.lat, shop.lng, rider.lat, rider.lng);

    return {
      distanceKm: distanceM / 1000,
      source: "GEO_RIDER_SHOP",
    };
  }

  // ── 3. ESTIMATED_FROM_FEE (last resort) ───────────────
  if (
    deliveryFeePaise != null &&
    deliveryFeePaise > 0 &&
    deliveryRatePerKm != null &&
    deliveryRatePerKm > 0
  ) {
    const roundTripKm = deliveryFeePaise / deliveryRatePerKm;
    const oneWayKm = roundTripKm / 2;

    return {
      distanceKm: oneWayKm,
      source: "ESTIMATED_FROM_FEE",
    };
  }

  // ── No method available ────────────────────────────────
  return null;
}
