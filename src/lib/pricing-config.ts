// ─────────────────────────────────────────────────────────
// Cached operator pricing/timeout config.
//
// Pricing is read on every quote/order, so we cache the single
// platform_settings row in memory rather than hitting the DB each
// time. The cache is loaded at startup, refreshed on a TTL, and
// updated in place when an admin edits the settings. Defaults match
// the original compile-time constants, so getPricing() is always safe
// even before the first DB load (and in unit tests with no DB).
//
// NOTE: the DB is imported lazily (inside loadPricing) so that pure
// helpers like computeDeliveryFee — which only call getPricing() — do
// not transitively pull in the DB client at module load.
// ─────────────────────────────────────────────────────────

export interface PricingConfig {
  deliveryRatePerKm: number; // paise per km (customer, round-trip)
  minDeliveryFee: number; // paise
  fallbackDeliveryFee: number; // paise
  riderPayoutPerKm: number; // paise per km (rider, one-way per leg)
  platformFee: number; // paise, flat per order
  commissionRate: number; // fraction, e.g. 0.10
  placedTimeoutMin: number; // auto-cancel a never-accepted order after N min
  noRiderTimeoutMin: number; // auto-cancel a no-rider order after N min
}

/** Shape of the settings row this module reads (structural, no schema import). */
interface SettingsRow {
  deliveryRatePerKm: number;
  minDeliveryFee: number;
  fallbackDeliveryFee: number;
  riderPayoutPerKm: number;
  platformFee: number;
  commissionBps: number;
  placedTimeoutMin: number;
  noRiderTimeoutMin: number;
}

const DEFAULTS: PricingConfig = {
  deliveryRatePerKm: 1000,
  minDeliveryFee: 1000,
  fallbackDeliveryFee: 2000,
  riderPayoutPerKm: 700,
  platformFee: 1000,
  commissionRate: 0.1,
  placedTimeoutMin: 60,
  noRiderTimeoutMin: 60,
};

let current: PricingConfig = { ...DEFAULTS };
let lastLoadedMs = 0;
const TTL_MS = 60_000;

function fromRow(row: SettingsRow): PricingConfig {
  return {
    deliveryRatePerKm: row.deliveryRatePerKm,
    minDeliveryFee: row.minDeliveryFee,
    fallbackDeliveryFee: row.fallbackDeliveryFee,
    riderPayoutPerKm: row.riderPayoutPerKm,
    platformFee: row.platformFee,
    commissionRate: row.commissionBps / 10_000,
    placedTimeoutMin: row.placedTimeoutMin,
    noRiderTimeoutMin: row.noRiderTimeoutMin,
  };
}

/** Synchronous accessor — always returns the latest cached config. */
export function getPricing(): PricingConfig {
  return current;
}

/** Load the settings row into the cache (no-op-safe if the row is missing). */
export async function loadPricing(): Promise<void> {
  try {
    const { db } = await import("../db/client.js");
    const { platformSettings } = await import("../db/schema/platform-settings.js");
    const [row] = await db.select().from(platformSettings).limit(1);
    if (row) {
      current = fromRow(row);
      lastLoadedMs = Date.now();
    }
  } catch {
    // Keep whatever we have (defaults or last good) — never crash pricing.
  }
}

/** Refresh from DB if the cache is older than the TTL (best-effort). */
export async function refreshPricingIfStale(): Promise<void> {
  if (Date.now() - lastLoadedMs > TTL_MS) await loadPricing();
}

/** Push a freshly-saved row straight into the cache (after an admin edit). */
export function applyPricingRow(row: SettingsRow): void {
  current = fromRow(row);
  lastLoadedMs = Date.now();
}
