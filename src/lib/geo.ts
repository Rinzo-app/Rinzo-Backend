// ─────────────────────────────────────────────────────────
// Haversine distance  (metres)
//
// Pure function — no external deps.  Used by auto-assign
// logic to rank riders by proximity to a target coordinate.
// ─────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000; // metres

/**
 * Compute the great-circle distance (in **metres**) between
 * two points on Earth using the Haversine formula.
 *
 * @param lat1 Latitude  of point A (degrees)
 * @param lng1 Longitude of point A (degrees)
 * @param lat2 Latitude  of point B (degrees)
 * @param lng2 Longitude of point B (degrees)
 * @returns    Distance in metres
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}
