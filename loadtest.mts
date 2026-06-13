/**
 * Lightweight, read-only load test.
 *
 * Fires concurrent GET requests in waves against the endpoints real
 * users hit most (health + shop browse), and reports throughput,
 * error rate, and latency percentiles. No writes — safe to run against
 * production. Auth uses one admin Firebase token (reused, not re-minted).
 *
 * Usage:
 *   E2E_ADMIN_PASSWORD=... npx tsx loadtest.mts [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:5000";
const WEB_API_KEY =
  process.env.E2E_WEB_API_KEY ?? "AIzaSyBbN4y2Vnj3QLTMhjfwG3X_5DPP7232saE";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@rinzo.app";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("E2E_ADMIN_PASSWORD is not set");

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`sign-in failed: ${await res.text()}`);
  return (await res.json()).idToken as string;
}

interface Result { ms: number; status: number; ok: boolean }

async function oneRequest(path: string, token?: string): Promise<Result> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    // Drain the body so the connection is fully released.
    await res.text();
    return { ms: performance.now() - t0, status: res.status, ok: res.ok };
  } catch {
    return { ms: performance.now() - t0, status: 0, ok: false };
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Keep `concurrency` requests in flight for `durationMs`. */
async function wave(
  label: string,
  path: string,
  concurrency: number,
  durationMs: number,
  token?: string,
) {
  const results: Result[] = [];
  const deadline = Date.now() + durationMs;
  async function worker() {
    while (Date.now() < deadline) {
      results.push(await oneRequest(path, token));
    }
  }
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wallSec = (performance.now() - start) / 1000;

  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok);
  const statusCounts: Record<string, number> = {};
  for (const r of results) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  console.log(`\n── ${label}  (concurrency ${concurrency}, ${durationMs / 1000}s) ──`);
  console.log(`  requests   : ${results.length}`);
  console.log(`  throughput : ${(results.length / wallSec).toFixed(1)} req/s`);
  console.log(`  errors     : ${errors.length} (${((errors.length / results.length) * 100).toFixed(2)}%)`);
  console.log(`  status     : ${JSON.stringify(statusCounts)}`);
  console.log(`  latency ms : min ${lat[0]?.toFixed(0)} | p50 ${pct(lat, 50).toFixed(0)} | p95 ${pct(lat, 95).toFixed(0)} | p99 ${pct(lat, 99).toFixed(0)} | max ${lat[lat.length - 1]?.toFixed(0)}`);
  return { count: results.length, errorRate: errors.length / results.length, p95: pct(lat, 95) };
}

// ═════════════════════════════════════════════════════════
console.log(`\n🏋️  Rinzo LOAD TEST (read-only) — target: ${BASE}\n`);

const token = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);

console.log("Warming up (wakes a cold Render instance)…");
for (let i = 0; i < 3; i++) await oneRequest("/health");

// 1. Health — pure app/runtime throughput, no DB, no auth
await wave("GET /health", "/health", 10, 10_000);
await wave("GET /health", "/health", 30, 10_000);

// 2. Shop browse — authenticated DB read (the customer home screen)
await wave("GET /api/shops?limit=100", "/api/shops?limit=100", 10, 10_000, token);
await wave("GET /api/shops?limit=100", "/api/shops?limit=100", 25, 15_000, token);

console.log("\n✅ Load test complete.\n");
process.exit(0);
