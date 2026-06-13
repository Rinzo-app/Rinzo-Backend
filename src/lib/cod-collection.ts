import { ledgerEntries } from "../db/schema/ledger-entries.js";
import { getPricing } from "./pricing-config.js";
import type { db } from "../db/client.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Book the revenue split when a COD payment is collected:
 * platform fee + commission to the platform, the remainder of the
 * items total to the shop. Must run inside the same transaction
 * that flips the payment to COLLECTED (the PENDING→COLLECTED guard
 * is what makes this idempotent).
 */
export async function bookCodCollection(
  tx: Tx,
  opts: {
    orderId: string;
    totalAmount: number;
    platformFee: number;
    shopId: string;
  },
): Promise<void> {
  const commission = Math.round(opts.totalAmount * getPricing().commissionRate);
  const shopEarning = opts.totalAmount - commission;

  await tx.insert(ledgerEntries).values([
    {
      entityType: "PLATFORM",
      entityId: null,
      orderId: opts.orderId,
      amount: opts.platformFee,
      reason: "PLATFORM_FEE",
    },
    {
      entityType: "PLATFORM",
      entityId: null,
      orderId: opts.orderId,
      amount: commission,
      reason: "COMMISSION",
    },
    {
      entityType: "SHOP",
      entityId: opts.shopId,
      orderId: opts.orderId,
      amount: shopEarning,
      reason: "EARNING",
    },
  ]);
}
