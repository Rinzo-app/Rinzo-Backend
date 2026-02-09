import { pgEnum } from "drizzle-orm/pg-core";

// ── Users ──────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", [
  "CUSTOMER",
  "SHOP_OWNER",
  "RIDER",
  "ADMIN",
]);

export const userStatusEnum = pgEnum("user_status", [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
]);

// ── Shops ──────────────────────────────────────────────
export const shopStatusEnum = pgEnum("shop_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
]);

// ── Services ───────────────────────────────────────────
export const pricingTypeEnum = pgEnum("pricing_type", [
  "PER_KG",
  "PER_ITEM",
]);

// ── Riders ─────────────────────────────────────────────
export const riderStatusEnum = pgEnum("rider_status", [
  "PENDING",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
]);

// ── Orders ─────────────────────────────────────────────
export const orderStatusEnum = pgEnum("order_status", [
  "PLACED",
  "SHOP_ACCEPTED",
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "AT_SHOP",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "REJECTED_BY_SHOP",
]);

export const rejectionReasonEnum = pgEnum("rejection_reason", [
  "CAPACITY_FULL",
  "CLOSED_TEMPORARILY",
  "SERVICE_UNAVAILABLE",
  "EMERGENCY",
]);

// ── Payments ───────────────────────────────────────────
export const paymentMethodEnum = pgEnum("payment_method", [
  "COD",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "COLLECTED",
  "FAILED",
]);

// ── Ledger ─────────────────────────────────────────────
export const ledgerEntityTypeEnum = pgEnum("ledger_entity_type", [
  "PLATFORM",
  "SHOP",
  "RIDER",
]);

export const ledgerReasonEnum = pgEnum("ledger_reason", [
  "PLATFORM_FEE",
  "COMMISSION",
  "EARNING",
  "COMMISSION_REFUND",
  "EARNING_REVERSAL",
  "PAYOUT",
]);

// ── Refunds ────────────────────────────────────────────
export const refundStatusEnum = pgEnum("refund_status", [
  "PROCESSED",
]);

export const refundReasonEnum = pgEnum("refund_reason", [
  "ORDER_CANCELLED",
  "ADMIN_DISCRETION",
]);

// ── Disputes ───────────────────────────────────────────
export const disputeRaisedByEnum = pgEnum("dispute_raised_by", [
  "CUSTOMER",
  "SHOP",
  "RIDER",
]);

export const disputeStatusEnum = pgEnum("dispute_status", [
  "OPEN",
  "IN_REVIEW",
  "RESOLVED",
  "CLOSED",
]);
