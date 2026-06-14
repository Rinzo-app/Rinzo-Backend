import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { payments } from "../db/schema/payments.js";
import { orders } from "../db/schema/orders.js";
import { ledgerEntries } from "../db/schema/ledger-entries.js";

export interface RiderOutstanding {
  /** Total COD cash the rider has collected and not settled (paise) */
  cashInHand: number;
  /** The rider's own delivery earnings on those orders (paise) */
  yourCut: number;
  /** cashInHand − yourCut: what the rider owes the platform (paise) */
  handOver: number;
  /** Number of unsettled collected orders */
  orderCount: number;
  /** Payment ids that a settlement would close */
  paymentIds: string[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Compute a rider's unsettled COD position from the payments + ledger. */
export async function getRiderOutstanding(riderId: string): Promise<RiderOutstanding> {
  const collected = await db
    .select({
      paymentId: payments.id,
      orderId: payments.orderId,
      amount: payments.amount,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(payments.status, "COLLECTED"),
        eq(payments.method, "COD"), // UPI never passes through the rider's hands
        eq(orders.riderId, riderId),
      ),
    );

  const cashInHand = collected.reduce((s, p) => s + p.amount, 0);
  const orderIds = collected.map((p) => p.orderId);

  let yourCut = 0;
  if (orderIds.length > 0) {
    const earnings = await db
      .select({ amount: ledgerEntries.amount })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.entityType, "RIDER"),
          eq(ledgerEntries.entityId, riderId),
          eq(ledgerEntries.reason, "EARNING"),
          inArray(ledgerEntries.orderId, orderIds),
        ),
      );
    yourCut = earnings.reduce((s, e) => s + e.amount, 0);
  }

  return {
    cashInHand,
    yourCut,
    handOver: Math.max(0, cashInHand - yourCut),
    orderCount: collected.length,
    paymentIds: collected.map((p) => p.paymentId),
  };
}

/** Mark the given still-COLLECTED COD payments as SETTLED (idempotent). */
export async function settlePaymentsInTx(tx: Tx, paymentIds: string[]): Promise<void> {
  if (paymentIds.length === 0) return;
  await tx
    .update(payments)
    .set({ status: "SETTLED", settledAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(payments.id, paymentIds), eq(payments.status, "COLLECTED")));
}
