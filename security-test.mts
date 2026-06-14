/**
 * Security probe suite.
 *
 * Creates a "victim" set (owner+shop+service, customer+order) and an
 * "attacker" set (second customer, second owner, approved rider) and
 * verifies the API enforces authentication, role separation, per-tenant
 * ownership (no IDOR), input validation, and image-URL hardening.
 *
 * Usage:
 *   E2E_ADMIN_PASSWORD=... npx tsx security-test.mts [baseUrl]
 *
 * Self-cleans its test data before and after, like e2e-test.mts.
 */
import "dotenv/config";
import { inArray, or } from "drizzle-orm";

const BASE = process.argv[2] ?? "http://localhost:5000";
const WEB_API_KEY =
  process.env.E2E_WEB_API_KEY ?? "AIzaSyBbN4y2Vnj3QLTMhjfwG3X_5DPP7232saE";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@rinzo.app";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("E2E_ADMIN_PASSWORD is not set");

const { firebaseAuth } = await import("./src/lib/firebase-admin.js");
if (!firebaseAuth) throw new Error("Firebase Admin SDK not initialised");
const { db } = await import("./src/db/client.js");
const schema = await import("./src/db/schema/index.js");

const PW = "Sec!test12345";
const EMAILS = {
  vOwner: "sec.vowner@rinzo.test",
  vRider: "sec.vrider@rinzo.test",
  vCustomer: "sec.vcustomer@rinzo.test",
  aOwner: "sec.aowner@rinzo.test",
  aRider: "sec.arider@rinzo.test",
  aCustomer: "sec.acustomer@rinzo.test",
};

let passed = 0;
let stepName = "";
function step(msg: string) {
  stepName = msg;
  console.log(`\n▶ ${msg}`);
}
function fail(msg: string): never {
  console.error(`\n❌ FAILED [${stepName}]: ${msg}`);
  process.exit(1);
}
function ok(msg: string) {
  passed++;
  console.log(`  ✔ ${msg}`);
}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
  ok(msg);
}

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (parsed && typeof parsed === "object" && parsed.error && typeof parsed.error === "object") {
    parsed = { ...parsed, ...parsed.error };
  }
  return { status: res.status, body: parsed };
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) fail(`Firebase sign-in failed for ${email}: ${await res.text()}`);
  return (await res.json()).idToken as string;
}

const IMG =
  "https://firebasestorage.googleapis.com/v0/b/rinzo-prod-54e65.firebasestorage.app/o/sec%2Fimg.jpg?alt=media";

async function cleanupDb(): Promise<void> {
  const testUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.email, Object.values(EMAILS)));
  const userIds = testUsers.map((u) => u.id);
  if (userIds.length === 0) return;

  const testShops = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(inArray(schema.shops.ownerId, userIds));
  const shopIds = testShops.map((s) => s.id);

  const orderFilter =
    shopIds.length > 0
      ? or(inArray(schema.orders.customerId, userIds), inArray(schema.orders.shopId, shopIds))!
      : inArray(schema.orders.customerId, userIds);
  const testOrders = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(orderFilter);
  const orderIds = testOrders.map((o) => o.id);

  if (orderIds.length > 0) {
    await db.delete(schema.reviews).where(inArray(schema.reviews.orderId, orderIds));
    await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.orderId, orderIds));
    await db.delete(schema.orderEvents).where(inArray(schema.orderEvents.orderId, orderIds));
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds));
    await db.delete(schema.refunds).where(inArray(schema.refunds.orderId, orderIds));
    await db.delete(schema.payments).where(inArray(schema.payments.orderId, orderIds));
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
  }
  if (shopIds.length > 0) {
    await db.delete(schema.shopPayouts).where(inArray(schema.shopPayouts.shopId, shopIds));
    await db.delete(schema.services).where(inArray(schema.services.shopId, shopIds));
    await db.delete(schema.favorites).where(inArray(schema.favorites.shopId, shopIds));
    await db.delete(schema.shops).where(inArray(schema.shops.id, shopIds));
  }
  const testRiders = await db
    .select({ id: schema.riders.id })
    .from(schema.riders)
    .where(inArray(schema.riders.userId, userIds));
  const riderIds = testRiders.map((r) => r.id);
  if (riderIds.length > 0) {
    await db.delete(schema.riderSettlements).where(inArray(schema.riderSettlements.riderId, riderIds));
    await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.entityId, riderIds));
    await db.delete(schema.riders).where(inArray(schema.riders.id, riderIds));
  }
  await db.delete(schema.addresses).where(inArray(schema.addresses.customerId, userIds));
  await db.delete(schema.favorites).where(inArray(schema.favorites.customerId, userIds));
  await db.delete(schema.pushTokens).where(inArray(schema.pushTokens.userId, userIds));
  await db.delete(schema.adminEvents).where(inArray(schema.adminEvents.targetId, userIds));
  await db.delete(schema.disputes).where(inArray(schema.disputes.raisedById, userIds));
  await db.delete(schema.users).where(inArray(schema.users.id, userIds));
}

async function cleanupFirebase(): Promise<void> {
  for (const email of Object.values(EMAILS)) {
    try {
      const u = await firebaseAuth!.getUserByEmail(email);
      await firebaseAuth!.deleteUser(u.uid);
    } catch {
      /* not found */
    }
  }
}

async function approveByEmail(role: string, email: string, adminToken: string) {
  const { body } = await api(
    "GET",
    `/api/admin/users?role=${role}&status=PENDING&limit=200`,
    adminToken,
  );
  const row = (body.data ?? []).find((u: any) => u.email === email);
  check(row, `admin can find PENDING ${email}`);
  const { status } = await api("POST", `/api/admin/users/${row.id}/approve`, adminToken);
  check(status === 200, `admin approves ${email}`);
  return row.id as string;
}

// ═════════════════════════════════════════════════════════
console.log(`\n🔒 Rinzo SECURITY probe — target: ${BASE}\n`);

await cleanupDb();
await cleanupFirebase();

step("Provision victim + attacker accounts");
for (const email of Object.values(EMAILS)) {
  // emailVerified so the verification gate doesn't block the happy paths.
  await firebaseAuth.createUser({ email, password: PW, emailVerified: true });
}
const adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
const t = {
  vOwner: await signIn(EMAILS.vOwner, PW),
  vRider: await signIn(EMAILS.vRider, PW),
  vCustomer: await signIn(EMAILS.vCustomer, PW),
  aOwner: await signIn(EMAILS.aOwner, PW),
  aRider: await signIn(EMAILS.aRider, PW),
  aCustomer: await signIn(EMAILS.aCustomer, PW),
};

// Register everyone
async function reg(path: string, token: string, body: unknown) {
  let r = await api("POST", path, token, body);
  // The register routes are rate-limited; back off and retry on 429.
  for (let i = 0; r.status === 429 && i < 4; i++) {
    console.log(`  … rate-limited on ${path}, waiting 60s`);
    await new Promise((res) => setTimeout(res, 60_000));
    r = await api("POST", path, token, body);
  }
  check(r.status === 201, `${path} → 201 (got ${r.status}: ${JSON.stringify(r.body)})`);
}
await reg("/api/auth/register/shop", t.vOwner, { name: "V Owner", phone: "9990010001" });
await reg("/api/auth/register/shop", t.aOwner, { name: "A Owner", phone: "9990010002" });
await reg("/api/auth/register/rider", t.vRider, { name: "V Rider", phone: "9990010003", vehicleType: "BIKE" });
await reg("/api/auth/register/rider", t.aRider, { name: "A Rider", phone: "9990010004", vehicleType: "BIKE" });
await reg("/api/auth/register/customer", t.vCustomer, { name: "V Customer", phone: "9990010005" });
await reg("/api/auth/register/customer", t.aCustomer, { name: "A Customer", phone: "9990010006" });

// Both owners create their shops BEFORE approval (owner approval needs a shop)
const { body: vShop } = await api("POST", "/api/shop", t.vOwner, {
  name: "Victim Laundry", phone: "9990010001", address: "1 Vic St, Bengaluru",
  latitude: 12.9716, longitude: 77.5946,
});
const vShopId = vShop.id;
await api("POST", "/api/shop", t.aOwner, {
  name: "Attacker Laundry", phone: "9990010002", address: "2 Atk St, Bengaluru",
  latitude: 12.9716, longitude: 77.5946,
});

await approveByEmail("SHOP_OWNER", EMAILS.vOwner, adminToken);
await approveByEmail("SHOP_OWNER", EMAILS.aOwner, adminToken);
await approveByEmail("RIDER", EMAILS.aRider, adminToken);

const { body: vSvc } = await api("POST", "/api/shop/services", t.vOwner, {
  name: "Wash", price: 5000, pricingType: "PER_KG", isActive: true,
});
const vServiceId = vSvc.id;

// Victim customer places an order at the victim shop
const orderRes = await api("POST", "/api/orders", t.vCustomer, {
  shopId: vShopId,
  items: [{ serviceId: vServiceId, quantity: 2 }],
  pickupAddress: "1 Vic St, Bengaluru", deliveryAddress: "1 Vic St, Bengaluru",
  pickupLat: 12.9716, pickupLng: 77.5946,
  idempotencyKey: `sec-${Date.now()}`,
});
const vOrder = orderRes.body?.order ?? orderRes.body;
check(vOrder?.id, `victim order created (got ${orderRes.status})`);
const vOrderId = vOrder.id;

// ── 1. Authentication ────────────────────────────────────
step("Authentication");
{
  let r = await api("GET", `/api/orders/${vOrderId}`);
  check(r.status === 401, `no token → 401 (got ${r.status})`);

  r = await api("GET", `/api/orders/${vOrderId}`, "garbage.token.value");
  check(r.status === 401, `malformed token → 401 (got ${r.status})`);

  // Dev bypass header must be ignored everywhere this suite runs.
  r = await api("GET", `/api/orders/${vOrderId}`, undefined);
  const r2 = await fetch(`${BASE}/api/orders/${vOrderId}`, {
    headers: { "X-Dev-User-Id": "00000000-0000-0000-0000-000000000000" },
  });
  check(r2.status === 401, `X-Dev-User-Id without bearer → 401 (got ${r2.status})`);
  void r;
}

// ── 2. Cross-tenant IDOR ─────────────────────────────────
step("Cross-tenant ownership (IDOR)");
{
  let r = await api("GET", `/api/orders/${vOrderId}`, t.aCustomer);
  check(r.status === 403, `other customer GET victim order → 403 (got ${r.status})`);

  r = await api("GET", `/api/orders/${vOrderId}`, t.aOwner);
  check(r.status === 403, `other owner GET victim order → 403 (got ${r.status})`);

  r = await api("POST", `/api/orders/${vOrderId}/cancel`, t.aCustomer);
  check(r.status === 403 || r.status === 404, `other customer cancel victim order → 403/404 (got ${r.status})`);

  r = await api("PATCH", `/api/shop/services/${vServiceId}`, t.aOwner, { price: 1 });
  check(r.status === 403 || r.status === 404, `other owner edits victim service → 403/404 (got ${r.status})`);

  r = await api("DELETE", `/api/shop/services/${vServiceId}`, t.aOwner);
  check(r.status === 403 || r.status === 404, `other owner deletes victim service → 403/404 (got ${r.status})`);

  r = await api("POST", `/api/rider/orders/${vOrderId}/pickup`, t.aRider);
  check(r.status === 403 || r.status === 409, `unassigned rider pickup → 403/409 (got ${r.status})`);

  r = await api("POST", `/api/rider/orders/${vOrderId}/deliver`, t.aRider, { deliveryProofUrl: IMG });
  check(r.status === 403 || r.status === 409, `unassigned rider deliver → 403/409 (got ${r.status})`);

  // Victim service still intact
  const { body: svcs } = await api("GET", "/api/shop/services", t.vOwner);
  const stillThere = (svcs ?? []).find((s: any) => s.id === vServiceId);
  check(stillThere && stillThere.price === 5000, "victim service untouched after attacks");
}

// ── 3. Role escalation ───────────────────────────────────
step("Role escalation (wrong role for action)");
{
  let r = await api("POST", "/api/shop/services", t.vCustomer, { name: "x", price: 1, pricingType: "PER_KG" });
  check(r.status === 403, `customer creates service → 403 (got ${r.status})`);

  r = await api("POST", `/api/rider/orders/${vOrderId}/accept`, t.vCustomer);
  check(r.status === 403, `customer accepts rider offer → 403 (got ${r.status})`);

  r = await api("POST", `/api/admin/users/${vShopId}/approve`, t.vCustomer);
  check(r.status === 403, `customer hits admin approve → 403 (got ${r.status})`);

  r = await api("POST", `/api/admin/riders/${vShopId}/reject-documents`, t.aOwner, { reason: "x" });
  check(r.status === 403, `owner hits admin reject-documents → 403 (got ${r.status})`);

  r = await api("GET", "/api/admin/users?role=RIDER&limit=10", t.vCustomer);
  check(r.status === 403, `customer lists admin users → 403 (got ${r.status})`);

  // Owner cannot weigh/advance an order at a shop they don't own
  r = await api("POST", `/api/orders/${vOrderId}/weigh`, t.aOwner, { items: [] });
  check(r.status === 403 || r.status === 404, `other owner weighs victim order → 403/404 (got ${r.status})`);
}

// ── 4. Image-URL hardening ───────────────────────────────
step("Image-URL hardening (reject non-Storage URLs)");
{
  let r = await api("PATCH", "/api/shop/settings", t.vOwner, { imageUrl: "https://evil.example.com/x.jpg" });
  check(r.status === 400, `shop imageUrl external host → 400 (got ${r.status})`);

  r = await api("POST", "/api/shop/services", t.vOwner, {
    name: "y", price: 100, pricingType: "PER_KG", imageUrl: "https://evil.example.com/x.jpg",
  });
  check(r.status === 400, `service imageUrl external host → 400 (got ${r.status})`);

  r = await api("PATCH", "/api/rider/documents", t.vRider, { dlImageUrl: "https://evil.example.com/x.jpg" });
  check(r.status === 400, `rider doc external host → 400 (got ${r.status})`);

  r = await api("PATCH", "/api/rider/documents", t.vRider, { dlImageUrl: "javascript:alert(1)" });
  check(r.status === 400, `rider doc javascript: scheme → 400 (got ${r.status})`);

  // The legit bucket URL is accepted
  r = await api("PATCH", "/api/shop/settings", t.vOwner, { imageUrl: IMG });
  check(r.status === 200 && r.body.imageUrl === IMG, `valid Storage imageUrl → 200 + saved`);
}

// ── 5. Input validation ──────────────────────────────────
step("Input validation");
{
  let r = await api("POST", "/api/shop/services", t.vOwner, { name: "z", price: -100, pricingType: "PER_KG" });
  check(r.status === 400, `negative price → 400 (got ${r.status})`);

  r = await api("POST", "/api/shop/services", t.vOwner, { name: "z", price: 5000, pricingType: "FREE_LUNCH" });
  check(r.status === 400, `invalid pricingType → 400 (got ${r.status})`);

  r = await api("POST", "/api/shop/services", t.vOwner, { name: "a".repeat(5000), price: 5000, pricingType: "PER_KG" });
  check(r.status === 400, `oversized name → 400 (got ${r.status})`);

  r = await api("GET", "/api/orders/not-a-uuid", t.vCustomer);
  check(r.status === 400, `malformed UUID → 400 (got ${r.status})`);

  // SQL-injection-style string must be safely rejected — never 200, never
  // a 500. 400 (parseUUID) locally; an edge WAF may return 403 on prod.
  r = await api("GET", "/api/orders/' OR 1=1 --", t.vCustomer);
  check(
    [400, 403, 404].includes(r.status),
    `SQLi-style id safely rejected, not 200/500 (got ${r.status})`,
  );

  r = await api("GET", "/api/shops?limit=99999", t.vCustomer);
  check(r.status === 400 || r.status === 200, `huge limit handled (got ${r.status})`);
}

// ── 6. Approval gating ───────────────────────────────────
step("Approval / status gating");
{
  // vRider was never approved → cannot go available
  const r = await api("POST", "/api/rider/availability", t.vRider, { isAvailable: true });
  check(r.status === 403, `unapproved rider availability → 403 (got ${r.status})`);
}

// ── 7. Admin settings (configurable pricing) ─────────────
step("Admin settings");
{
  let r = await api("GET", "/api/admin/settings", adminToken);
  check(
    r.status === 200 && typeof r.body.deliveryRatePerKm === "number",
    `admin reads settings (got ${r.status})`,
  );

  r = await api("PATCH", "/api/admin/settings", adminToken, { platformFee: 1500 });
  check(r.status === 200 && r.body.platformFee === 1500, `admin updates platform fee (got ${r.status})`);
  // restore default so we don't skew prod pricing
  await api("PATCH", "/api/admin/settings", adminToken, { platformFee: 1000 });

  r = await api("GET", "/api/admin/settings", t.vCustomer);
  check(r.status === 403, `non-admin cannot read settings (got ${r.status})`);

  r = await api("PATCH", "/api/admin/settings", adminToken, { commissionBps: 99999 });
  check(r.status === 400, `out-of-range commission rejected (got ${r.status})`);
}

// ── 8. Email-verification gate ───────────────────────────
step("Email-verification gate");
{
  // Capture vCustomer's user id while still verified.
  const me = await api("GET", "/api/auth/me", t.vCustomer);
  const vCustomerId = me.body?.id;

  // Flip vCustomer to unverified, re-sign-in to get a token without the
  // claim, and confirm order placement is blocked.
  const u = await firebaseAuth!.getUserByEmail(EMAILS.vCustomer);
  await firebaseAuth!.updateUser(u.uid, { emailVerified: false });
  const staleToken = await signIn(EMAILS.vCustomer, PW);
  let r = await api("POST", "/api/orders", staleToken, {
    shopId: vShopId,
    items: [{ serviceId: vServiceId, quantity: 1 }],
    pickupAddress: "1 Vic St, Bengaluru",
    deliveryAddress: "1 Vic St, Bengaluru",
    pickupLat: 12.9716,
    pickupLng: 77.5946,
  });
  check(
    r.status === 403 && r.body.code === "ERR_EMAIL_NOT_VERIFIED",
    `unverified customer can't place order → 403 (got ${r.status}: ${r.body.code})`,
  );

  // A non-admin cannot use the verify-email override.
  r = await api("POST", `/api/admin/users/${vCustomerId}/verify-email`, staleToken);
  check(r.status === 403, `non-admin verify-email override → 403 (got ${r.status})`);

  // Admin override marks the email verified.
  r = await api("POST", `/api/admin/users/${vCustomerId}/verify-email`, adminToken);
  check(r.status === 200, `admin verify-email override → 200 (got ${r.status})`);

  await firebaseAuth!.updateUser(u.uid, { emailVerified: true });
}

// ── 9. Account deletion ──────────────────────────────────
step("Account deletion");
{
  // Admin-delete is admin-only and respects the active-order guard.
  const ar = await api("GET", "/api/auth/me", t.aRider);
  let r = await api("POST", `/api/admin/users/${ar.body?.id}/delete`, t.vOwner);
  check(r.status === 403, `non-admin admin-delete → 403 (got ${r.status})`);
  const vo = await api("GET", "/api/auth/me", t.vOwner);
  r = await api("POST", `/api/admin/users/${vo.body?.id}/delete`, adminToken);
  check(r.status === 409, `admin-delete with active order → 409 (got ${r.status})`);

  // vCustomer has an in-flight order → self-deletion blocked
  r = await api("DELETE", "/api/auth/me", t.vCustomer);
  check(r.status === 409, `self-delete with active order → 409 (got ${r.status})`);

  // aCustomer has no orders → deletion succeeds, then can't authenticate
  const me = await api("GET", "/api/auth/me", t.aCustomer);
  const aCustomerId = me.body?.id;
  r = await api("DELETE", "/api/auth/me", t.aCustomer);
  check(r.status === 200, `delete clean account → 200 (got ${r.status})`);
  r = await api("GET", "/api/auth/me", t.aCustomer);
  check(r.status === 401, `deleted account can't authenticate → 401 (got ${r.status})`);
  // Row is anonymized (email nulled) so cleanup-by-email won't catch it.
  if (aCustomerId) await db.delete(schema.users).where(inArray(schema.users.id, [aCustomerId]));
}

step("Cleanup");
await cleanupDb();
await cleanupFirebase();
ok("test data removed");

console.log(`\n✅ SECURITY probe PASSED — ${passed} checks\n`);
process.exit(0);
