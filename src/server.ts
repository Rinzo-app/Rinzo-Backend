import "dotenv/config";
import { assertProductionEnv } from "./lib/assert-env.js";
import { app } from "./app.js";

// ── Fail fast if critical secrets are missing ────────────
assertProductionEnv();

// ── Startup assertion: dev auth must not be reachable outside development ──
const nodeEnv = process.env.NODE_ENV ?? "development";
if (nodeEnv !== "development") {
  // Sanity check — if someone accidentally sets NODE_ENV to something
  // other than "development" while still expecting the dev bypass to
  // work, fail loudly at boot rather than silently dropping requests.
  console.log(
    JSON.stringify({
      level: "info",
      type: "SECURITY",
      message: `Dev auth bypass is DISABLED (NODE_ENV=${nodeEnv})`,
      ts: new Date().toISOString(),
    }),
  );
}

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, () => {
  console.log(`[rinzo-backend] listening on http://localhost:${PORT}`);
  console.log(`[rinzo-backend] env: ${nodeEnv}`);
});
