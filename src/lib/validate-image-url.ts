import { z } from "zod";

// ─────────────────────────────────────────────────────────
// IMAGE-URL VALIDATION
//
// Image URLs (rider documents, shop/service photos, delivery
// proofs) are uploaded client-side to Firebase Storage and the
// resulting download URL is sent here for storage. Those URLs
// are later rendered inside OTHER users' apps, so we must not
// accept arbitrary external URLs — only download URLs that point
// at our own project's Storage bucket. Storage security rules
// already constrain WHERE a user can upload (their own uid
// folder); this constrains WHAT URL they can register.
// ─────────────────────────────────────────────────────────

const BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || "rinzo-prod-54e65.firebasestorage.app";

// Google serves Firebase Storage download URLs from these hosts.
const ALLOWED_HOSTS = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
]);

/** True only for an https download URL pointing at our own bucket. */
export function isAllowedStorageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;

  // Standard download URL: .../v0/b/<bucket>/o/<encoded-path>?alt=media&token=...
  if (ALLOWED_HOSTS.has(u.hostname)) {
    return (
      u.pathname.includes(`/b/${BUCKET}/`) ||
      u.pathname.includes(encodeURIComponent(BUCKET))
    );
  }

  // Bucket-domain form: https://<bucket>/...
  if (u.hostname === BUCKET) return true;

  return false;
}

/**
 * Zod schema for an optional image URL field. Rejects anything that
 * isn't a download URL for our own Storage bucket.
 */
export const storageImageUrl = z
  .string()
  .url()
  .max(1000)
  .refine(isAllowedStorageUrl, {
    message: "Image URL must be an uploaded Rinzo storage URL",
  });
