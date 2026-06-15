import { and, eq, gt, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { memberships } from "../db/schema/memberships.js";
import { plans } from "../db/schema/plans.js";

export interface MembershipBenefit {
  planName: string;
  freeDelivery: boolean;
  discountBps: number;
  expiresAt: Date;
}

/** The customer's current active (non-expired) membership benefit, or null. */
export async function getActiveMembership(
  customerId: string,
): Promise<MembershipBenefit | null> {
  const [row] = await db
    .select({
      planName: plans.name,
      freeDelivery: plans.freeDelivery,
      discountBps: plans.discountBps,
      expiresAt: memberships.expiresAt,
    })
    .from(memberships)
    .innerJoin(plans, eq(plans.id, memberships.planId))
    .where(
      and(
        eq(memberships.customerId, customerId),
        eq(memberships.status, "ACTIVE"),
        gt(memberships.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(memberships.expiresAt))
    .limit(1);
  return row ?? null;
}

export interface AppliedBenefit {
  /** Discount on the items total (paise). */
  discount: number;
  /** True when delivery is waived for the member. */
  freeDelivery: boolean;
  /** Delivery fee the customer is actually charged (0 if waived). */
  deliveryCharged: number;
}

/** Apply a member benefit to an items total + delivery fee. */
export function applyBenefit(
  benefit: MembershipBenefit | null,
  itemsTotal: number,
  deliveryFee: number,
): AppliedBenefit {
  if (!benefit) return { discount: 0, freeDelivery: false, deliveryCharged: deliveryFee };
  const discount =
    benefit.discountBps > 0 ? Math.round((itemsTotal * benefit.discountBps) / 10000) : 0;
  return {
    discount,
    freeDelivery: benefit.freeDelivery,
    deliveryCharged: benefit.freeDelivery ? 0 : deliveryFee,
  };
}
