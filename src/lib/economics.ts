/**
 * Platform economics configuration.
 *
 * All monetary values are in paise (1/100 of a rupee).
 * These are compile-time constants — no env lookup needed
 * until we add an admin config endpoint.
 */

/** Flat platform fee added on top of every order (paise) */
export const PLATFORM_FEE = 1000; // ₹10

/** Commission rate charged on order totalAmount */
export const COMMISSION_RATE = 0.10; // 10 %
