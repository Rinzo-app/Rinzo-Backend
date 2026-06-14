import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { ledgerEntries } from "../db/schema/ledger-entries.js";
import { shopPayouts } from "../db/schema/shop-payouts.js";

/**
 * A shop's outstanding balance = total EARNING booked to it minus what
 * has already been paid out. All in paise.
 */
export async function getShopOutstanding(shopId: string): Promise<{
  earned: number;
  paidOut: number;
  balance: number;
}> {
  const [{ earned }] = await db
    .select({ earned: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.entityType, "SHOP"),
        eq(ledgerEntries.entityId, shopId),
        eq(ledgerEntries.reason, "EARNING"),
      ),
    );

  const [{ paidOut }] = await db
    .select({ paidOut: sql<number>`coalesce(sum(${shopPayouts.amount}), 0)::int` })
    .from(shopPayouts)
    .where(eq(shopPayouts.shopId, shopId));

  return { earned, paidOut, balance: Math.max(0, earned - paidOut) };
}
