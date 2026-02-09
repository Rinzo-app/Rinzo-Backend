import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { createDispute } from "./disputes.handler.js";

const disputesRouter = Router();

// POST /api/disputes — customer, shop-owner, or rider raises a dispute
disputesRouter.post(
  "/",
  requireAuth,
  requireRole("CUSTOMER", "SHOP_OWNER", "RIDER"),
  createDispute as any,
);

export { disputesRouter };
