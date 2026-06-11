// ─────────────────────────────────────────────────────────
// Delivery fee configuration
//
// Rate is stored in **paise** per kilometre.
// The customer pays: roundTripDistanceKm × DELIVERY_RATE_PER_KM
// (one charge covers both pickup and drop-off legs).
// ─────────────────────────────────────────────────────────

/** ₹10 per km — stored in paise (100 paise = ₹1) */
export const DELIVERY_RATE_PER_KM = 1000;

/** Floor for distance-computed fees — ₹10 (paise) */
export const MIN_DELIVERY_FEE = 1000;

/** Charged when pickup coordinates are unavailable — ₹20 (paise).
 *  Prevents silently-free delivery (and zero rider payouts) for
 *  orders without GPS data. */
export const FALLBACK_DELIVERY_FEE = 2000;
