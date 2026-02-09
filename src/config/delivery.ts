// ─────────────────────────────────────────────────────────
// Delivery fee configuration
//
// Rate is stored in **paise** per kilometre.
// The customer pays: roundTripDistanceKm × DELIVERY_RATE_PER_KM
// (one charge covers both pickup and drop-off legs).
// ─────────────────────────────────────────────────────────

/** ₹10 per km — stored in paise (100 paise = ₹1) */
export const DELIVERY_RATE_PER_KM = 1000;
