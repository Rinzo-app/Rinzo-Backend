import { Router } from "express";
import { authLimiter, writeLimiter } from "../middleware/rate-limit.js";
import { ordersRouter } from "./orders/index.js";
import { adminRouter } from "./admin/index.js";
import { authRouter } from "./auth/index.js";
import { riderRouter } from "./rider/index.js";
import { customerRouter } from "./customer/index.js";
import { shopRouter } from "./shop/index.js";
import { shopsRouter } from "./shops/index.js";
import { disputesRouter } from "./disputes/index.js";
import { addressesRouter } from "./addresses/index.js";
import { favoritesRouter } from "./favorites/index.js";

const apiRouter = Router();

// ── Rate limiters (applied at the sub-router level) ──────
apiRouter.use("/auth", authLimiter, authRouter);

// Write-limiter for all POST/PATCH/PUT/DELETE across every sub-router
apiRouter.use((req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});

apiRouter.use("/orders", ordersRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/rider", riderRouter);
apiRouter.use("/customer", customerRouter);
apiRouter.use("/shop", shopRouter);
apiRouter.use("/shops", shopsRouter);
apiRouter.use("/disputes", disputesRouter);
apiRouter.use("/addresses", addressesRouter);
apiRouter.use("/favorites", favoritesRouter);

export { apiRouter };
