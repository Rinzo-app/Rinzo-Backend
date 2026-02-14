import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { authed } from "../../lib/typed-handler.js";
import {
  registerCustomer,
  registerShop,
  registerRider,
  getMe,
} from "./auth.handler.js";

const authRouter = Router();

authRouter.post("/register/customer", registerCustomer);
authRouter.post("/register/shop", registerShop);
authRouter.post("/register/rider", registerRider);
authRouter.get("/me", requireAuth, authed(getMe));

export { authRouter };
