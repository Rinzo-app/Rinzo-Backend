import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { listCustomerOrders } from "../orders/orders.read.js";

const customerRouter = Router();

customerRouter.get(
  "/orders",
  requireAuth,
  requireRole("CUSTOMER"),
  listCustomerOrders as any,
);

export { customerRouter };
