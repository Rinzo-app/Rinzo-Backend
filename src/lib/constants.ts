/**
 * Canonical dispute categories shared across all roles.
 * Mobile apps should fetch these from GET /api/disputes/categories.
 */
export const DISPUTE_CATEGORIES = [
  "Payment Issue",
  "Late Delivery",
  "Wrong Items",
  "Order Damaged",
  "Missing Items",
  "Customer No-show",
  "Wrong Order Info",
  "Rider Issue",
  "App Issue",
  "Other",
] as const;
