import { Router } from "express";
import { authLimiter, writeLimiter } from "../middleware/rate-limit.js";
import { ordersRouter } from "./orders/index.js";
import { adminRouter } from "./admin/index.js";
import { authRouter } from "./auth/index.js";
import { riderRouter } from "./rider/index.js";
import { customerRouter } from "./customer/index.js";
import { shopRouter } from "./shop/index.js";
import { disputesRouter } from "./disputes/index.js";

const apiRouter = Router();

// ── Rate limiters (applied at the sub-router level) ──────
apiRouter.use("/auth", authLimiter, authRouter);

// Write-limiter for all POST/PATCH across every sub-router
apiRouter.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PATCH") {
    return writeLimiter(req, res, next);
  }
  next();
});

apiRouter.use("/orders", ordersRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/rider", riderRouter);
apiRouter.use("/customer", customerRouter);
apiRouter.use("/shop", shopRouter);
apiRouter.use("/disputes", disputesRouter);

export { apiRouter };
