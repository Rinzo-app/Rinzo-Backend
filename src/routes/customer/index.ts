import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import { authed } from "../../lib/typed-handler.js";
import { listCustomerOrders } from "../orders/orders.read.js";

const customerRouter = Router();

customerRouter.get(
  "/orders",
  requireAuth,
  requireRole("CUSTOMER"),
  authed(listCustomerOrders),
);

export { customerRouter };
