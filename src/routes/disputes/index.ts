import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { authed } from "../../lib/typed-handler.js";
import { createDispute, listMyDisputes, getDisputeCategories } from "./disputes.handler.js";

const disputesRouter = Router();

// GET /api/disputes/categories — canonical list (auth required)
disputesRouter.get("/categories", requireAuth, getDisputeCategories);

// GET /api/disputes — list disputes raised by the authenticated user
disputesRouter.get(
  "/",
  requireAuth,
  requireRole("CUSTOMER", "SHOP_OWNER", "RIDER"),
  authed(listMyDisputes),
);

// POST /api/disputes — customer, shop-owner, or rider raises a dispute
disputesRouter.post(
  "/",
  requireAuth,
  requireRole("CUSTOMER", "SHOP_OWNER", "RIDER"),
  authed(createDispute),
);

export { disputesRouter };
