import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { authLimiter } from "../../middleware/rate-limit.js";
import { authed } from "../../lib/typed-handler.js";
import {
  registerCustomer,
  registerShop,
  registerRider,
  getMe,
  updateMe,
} from "./auth.handler.js";
import { deleteAccount } from "./account.handler.js";

const authRouter = Router();

// Strict limiter on registration only — /me is called by every app on
// startup and must not share the 5/min budget (mobile NAT groups many
// users behind one IP).
authRouter.post("/register/customer", authLimiter, registerCustomer);
authRouter.post("/register/shop", authLimiter, registerShop);
authRouter.post("/register/rider", authLimiter, registerRider);
authRouter.get("/me", requireAuth, authed(getMe));
authRouter.patch("/me", requireAuth, authed(updateMe));
authRouter.delete("/me", requireAuth, authed(deleteAccount));

export { authRouter };
