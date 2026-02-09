import { Router } from "express";
import {
  registerCustomer,
  registerShop,
  registerRider,
} from "./auth.handler.js";

const authRouter = Router();

authRouter.post("/register/customer", registerCustomer);
authRouter.post("/register/shop", registerShop);
authRouter.post("/register/rider", registerRider);

export { authRouter };
