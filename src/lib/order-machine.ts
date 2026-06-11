import type { UserRole } from "./types.js";
import { ConflictError, ForbiddenError } from "./errors.js";

// ─────────────────────────────────────────────────────────
// ORDER STATUS & TRANSITION TYPES
// ─────────────────────────────────────────────────────────

export type OrderStatus =
  | "PLACED"
  | "SHOP_ACCEPTED"
  | "PICKUP_OFFERED"
  | "PICKUP_ASSIGNED"
  | "PICKED_UP_FROM_CUSTOMER"
  | "AT_SHOP"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "REJECTED_BY_SHOP";

/** Actors that can trigger transitions. SYSTEM is internal (auto-reject, rider dispatch). */
export type TransitionActor = UserRole | "SYSTEM";

/** Rejection reasons (mirrors the DB enum). */
export type RejectionReason =
  | "CAPACITY_FULL"
  | "CLOSED_TEMPORARILY"
  | "SERVICE_UNAVAILABLE"
  | "EMERGENCY";

// Terminal states — no transitions out of these
const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "DELIVERED",
  "CANCELLED",
  "REJECTED_BY_SHOP",
]);

// ─────────────────────────────────────────────────────────
// TRANSITION → ACTOR MAP
//
// Each entry: [from, to] → allowed actors
//
// Derived from rinzo-unified-domain.md §6–§8:
//
//  PLACED → SHOP_ACCEPTED              SHOP_OWNER
//  PLACED → REJECTED_BY_SHOP           SHOP_OWNER, SYSTEM (auto-reject)
//  PLACED → CANCELLED                  CUSTOMER
//  SHOP_ACCEPTED → PICKUP_OFFERED      SYSTEM (offer to a rider)
//  SHOP_ACCEPTED → PICKUP_ASSIGNED     SYSTEM (admin manual assignment)
//  PICKUP_OFFERED → PICKUP_ASSIGNED    RIDER  (rider accepts the offer)
//  PICKUP_OFFERED → SHOP_ACCEPTED      RIDER (decline), SYSTEM (expiry)
//  PICKUP_ASSIGNED → PICKED_UP_FROM_CUSTOMER   RIDER
//  PICKED_UP_FROM_CUSTOMER → AT_SHOP   RIDER
//  AT_SHOP → READY                     SHOP_OWNER
//  READY → OUT_FOR_DELIVERY            SYSTEM (delivery dispatch)
//  OUT_FOR_DELIVERY → DELIVERED        RIDER
//
//  ADMIN can perform ANY transition (bypasses map).
// ─────────────────────────────────────────────────────────

interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  actors: ReadonlySet<TransitionActor>;
}

const rules: readonly TransitionRule[] = [
  // ── Happy path ───────────────────────────────────────
  { from: "PLACED",                   to: "SHOP_ACCEPTED",            actors: new Set(["SHOP_OWNER"]) },
  { from: "SHOP_ACCEPTED",            to: "PICKUP_OFFERED",           actors: new Set(["SYSTEM"]) },
  { from: "SHOP_ACCEPTED",            to: "PICKUP_ASSIGNED",          actors: new Set(["SYSTEM"]) },
  { from: "PICKUP_OFFERED",           to: "PICKUP_ASSIGNED",          actors: new Set(["RIDER"]) },
  { from: "PICKUP_OFFERED",           to: "SHOP_ACCEPTED",            actors: new Set(["RIDER", "SYSTEM"]) },
  { from: "PICKUP_ASSIGNED",          to: "PICKED_UP_FROM_CUSTOMER",  actors: new Set(["RIDER"]) },
  { from: "PICKED_UP_FROM_CUSTOMER",  to: "AT_SHOP",                  actors: new Set(["RIDER"]) },
  { from: "AT_SHOP",                  to: "READY",                    actors: new Set(["SHOP_OWNER"]) },
  { from: "READY",                    to: "OUT_FOR_DELIVERY",         actors: new Set(["SYSTEM"]) },
  { from: "OUT_FOR_DELIVERY",         to: "DELIVERED",                actors: new Set(["RIDER"]) },

  // ── Rejection (PLACED only) ──────────────────────────
  { from: "PLACED",                   to: "REJECTED_BY_SHOP",         actors: new Set(["SHOP_OWNER", "SYSTEM"]) },

  // ── Cancellation (PLACED only for CUSTOMER) ──────────
  { from: "PLACED",                   to: "CANCELLED",                actors: new Set(["CUSTOMER"]) },
] as const;

// Build a lookup map: "FROM->TO" → Set<TransitionActor>
const transitionMap = new Map<string, ReadonlySet<TransitionActor>>(
  rules.map((r) => [`${r.from}->${r.to}`, r.actors]),
);

// ─────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────

/**
 * Returns all statuses reachable from `current` for a given actor.
 * ADMIN sees every possible next state; terminal statuses return [].
 */
export function getAllowedTransitions(
  current: OrderStatus,
  actor: TransitionActor,
): OrderStatus[] {
  if (TERMINAL_STATUSES.has(current)) return [];

  const allowed: OrderStatus[] = [];
  for (const rule of rules) {
    if (rule.from !== current) continue;
    if (actor === "ADMIN" || rule.actors.has(actor)) {
      allowed.push(rule.to);
    }
  }
  return allowed;
}

/**
 * Validates that `actor` may move an order from `current` → `next`.
 *
 * - ADMIN bypasses all guards.
 * - Throws ConflictError (409) if the transition is invalid.
 * - Throws ForbiddenError (403) if the transition exists but the
 *   actor is not authorized.
 */
export function assertTransition(
  current: OrderStatus,
  next: OrderStatus,
  actor: TransitionActor,
): void {
  // Admin overrides everything
  if (actor === "ADMIN") return;

  // Cannot transition out of a terminal state
  if (TERMINAL_STATUSES.has(current)) {
    throw new ConflictError(
      `Order in '${current}' state cannot be updated`,
      "ERR_ORDER_TERMINAL",
    );
  }

  // Check if this transition exists at all
  const key = `${current}->${next}`;
  const allowedActors = transitionMap.get(key);

  if (!allowedActors) {
    throw new ConflictError(
      `Invalid order transition: ${current} → ${next}`,
      "ERR_ORDER_INVALID_TRANSITION",
    );
  }

  // Check if this actor is permitted
  if (!allowedActors.has(actor)) {
    throw new ForbiddenError(
      `Role '${actor}' cannot transition order from ${current} → ${next}`,
      "ERR_ORDER_TRANSITION_DENIED",
    );
  }
}

/**
 * Returns true if the given status is terminal (no further transitions).
 */
export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
