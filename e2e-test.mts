/**
 * End-to-end order lifecycle test.
 *
 * Exercises the full business flow through the public API exactly as
 * the apps do — registration, shop onboarding, admin approval, rider
 * activation, order placement, auto-assignment, and every status
 * transition to DELIVERED — plus a few negative checks.
 *
 * Usage:
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npx tsx e2e-test.mts [baseUrl]
 *
 * baseUrl defaults to http://localhost:5000. Requires the backend's
 * .env (Firebase Admin credentials + DATABASE_URL) for test-user
 * management and cleanup. Test data is removed afterwards.
 */
import "dotenv/config";
import { inArray, eq, or } from "drizzle-orm";

const BASE = process.argv[2] ?? "http://localhost:5000";
const WEB_API_KEY =
  process.env.E2E_WEB_API_KEY ?? "AIzaSyBbN4y2Vnj3QLTMhjfwG3X_5DPP7232saE";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@rinzo.app";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("E2E_ADMIN_PASSWORD is not set");

const { firebaseAuth } = await import("./src/lib/firebase-admin.js");
if (!firebaseAuth) throw new Error("Firebase Admin SDK not initialised");
const { db, pool } = await import("./src/db/client.js");
const schema = await import("./src/db/schema/index.js");

const PW = "E2e!test12345";
const EMAILS = {
  owner: "e2e.owner@rinzo.test",
  rider: "e2e.rider@rinzo.test",
  customer: "e2e.customer@rinzo.test",
};

let step = 0;
function log(msg: string) {
  console.log(`[${String(++step).padStart(2, "0")}] ${msg}`);
}
function fail(msg: string): never {
  console.error(`\n❌ FAILED at step ${step}: ${msg}`);
  process.exit(1);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
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
  // Error responses are { error: { code, message } } — flatten for assertions
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

/** Remove all rows belonging to the e2e test users (idempotent). */
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
      ? or(
          inArray(schema.orders.customerId, userIds),
          inArray(schema.orders.shopId, shopIds),
        )!
      : inArray(schema.orders.customerId, userIds);
  const testOrders = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(orderFilter);
  const orderIds = testOrders.map((o) => o.id);

  if (orderIds.length > 0) {
    await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.orderId, orderIds));
    await db.delete(schema.orderEvents).where(inArray(schema.orderEvents.orderId, orderIds));
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds));
    await db.delete(schema.refunds).where(inArray(schema.refunds.orderId, orderIds));
    await db.delete(schema.payments).where(inArray(schema.payments.orderId, orderIds));
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
  }
  if (shopIds.length > 0) {
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
    await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.entityId, riderIds));
    await db.delete(schema.riders).where(inArray(schema.riders.id, riderIds));
  }
  await db.delete(schema.addresses).where(inArray(schema.addresses.customerId, userIds));
  await db.delete(schema.favorites).where(inArray(schema.favorites.customerId, userIds));
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
      // not found — fine
    }
  }
}

/** Poll an order until it reaches `expected` status (auto-assign is async). */
async function waitForStatus(
  orderId: string,
  token: string,
  expected: string,
  timeoutMs = 15_000,
): Promise<any> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    const { status, body } = await api("GET", `/api/orders/${orderId}`, token);
    assert(status === 200, `GET order returned ${status}: ${JSON.stringify(body)}`);
    last = body.status;
    if (last === expected) return body;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`Order never reached ${expected} (still ${last} after ${timeoutMs}ms)`);
}

// ═════════════════════════════════════════════════════════
console.log(`\n🧪 Rinzo E2E — target: ${BASE}\n`);

log("Pre-clean leftovers from previous runs");
await cleanupDb();
await cleanupFirebase();

log("Create Firebase test users (owner, rider, customer)");
for (const email of Object.values(EMAILS)) {
  await firebaseAuth.createUser({ email, password: PW });
}

log("Sign in admin + test users");
const adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
const ownerToken = await signIn(EMAILS.owner, PW);
const riderToken = await signIn(EMAILS.rider, PW);
const customerToken = await signIn(EMAILS.customer, PW);

// ── Owner onboarding ──────────────────────────────────────
log("Register shop owner → expect PENDING user");
{
  const { status, body } = await api("POST", "/api/auth/register/shop", ownerToken, {
    name: "E2E Owner",
    phone: "9990001111",
  });
  assert(status === 201, `register/shop → ${status}: ${JSON.stringify(body)}`);
  assert(body.status === "PENDING", `owner user status should be PENDING, got ${body.status}`);
}

log("Owner creates shop → expect PENDING shop");
let shopId: string;
{
  const { status, body } = await api("POST", "/api/shop", ownerToken, {
    name: "E2E Laundry",
    phone: "9990001111",
    address: "42 Test Street, Bengaluru",
    latitude: 12.9716,
    longitude: 77.5946,
  });
  assert(status === 201, `create shop → ${status}: ${JSON.stringify(body)}`);
  assert(body.status === "PENDING", `shop should be PENDING, got ${body.status}`);
  shopId = body.id;
}

log("Negative: customer must NOT see unapproved shop");
{
  const { body } = await api("GET", "/api/shops?limit=100", customerToken);
  // customer isn't registered yet → 401; register first below. Use admin instead.
  const { body: list } = await api("GET", "/api/shops?limit=100", adminToken);
  const found = (list.data ?? []).some((s: any) => s.id === shopId);
  assert(!found, "PENDING shop is visible to browsers — should be hidden");
  void body;
}

log("Admin approves shop owner → user ACTIVE, shop APPROVED");
let ownerUserId: string;
{
  const { body: pending } = await api(
    "GET",
    "/api/admin/users?role=SHOP_OWNER&status=PENDING&limit=100",
    adminToken,
  );
  const ownerRow = (pending.data ?? []).find((u: any) => u.email === EMAILS.owner);
  assert(ownerRow, "owner not found in admin PENDING list");
  ownerUserId = ownerRow.id;
  const { status, body } = await api(
    "POST",
    `/api/admin/users/${ownerRow.id}/approve`,
    adminToken,
  );
  assert(status === 200, `approve owner → ${status}: ${JSON.stringify(body)}`);
  const { body: settings } = await api("GET", "/api/shop/settings", ownerToken);
  assert(settings.status === "APPROVED", `shop should be APPROVED, got ${settings.status}`);
}

log("Owner adds a service");
let serviceId: string;
{
  const { status, body } = await api("POST", "/api/shop/services", ownerToken, {
    name: "Wash & Fold",
    price: 5000,
    pricingType: "PER_KG",
    isActive: true,
  });
  assert(status === 201 || status === 200, `create service → ${status}: ${JSON.stringify(body)}`);
  serviceId = body.id;
  assert(serviceId, "service id missing");
}

// ── Rider onboarding ──────────────────────────────────────
log("Register rider → expect PENDING");
{
  const { status, body } = await api("POST", "/api/auth/register/rider", riderToken, {
    name: "E2E Rider",
    phone: "9990002222",
    vehicleType: "BIKE",
  });
  assert(status === 201, `register/rider → ${status}: ${JSON.stringify(body)}`);
  assert(body.status === "PENDING", `rider user should be PENDING, got ${body.status}`);
}

log("Negative: PENDING rider cannot toggle availability (403)");
{
  const { status, body } = await api("POST", "/api/rider/availability", riderToken, {
    isAvailable: true,
  });
  assert(
    status === 403 && body.code === "ERR_RIDER_NOT_APPROVED",
    `expected 403 ERR_RIDER_NOT_APPROVED, got ${status}: ${JSON.stringify(body)}`,
  );
}

log("Admin approves rider → rider entity ACTIVE");
{
  const { body: pending } = await api(
    "GET",
    "/api/admin/users?role=RIDER&status=PENDING&limit=100",
    adminToken,
  );
  const riderRow = (pending.data ?? []).find((u: any) => u.email === EMAILS.rider);
  assert(riderRow, "rider not found in admin PENDING list");
  const { status } = await api("POST", `/api/admin/users/${riderRow.id}/approve`, adminToken);
  assert(status === 200, `approve rider → ${status}`);
  const { body: profile } = await api("GET", "/api/rider/profile", riderToken);
  assert(profile.status === "ACTIVE", `rider entity should be ACTIVE, got ${profile.status}`);
}

log("Rider sends location + goes available");
{
  let r = await api("POST", "/api/rider/location", riderToken, { lat: 12.972, lng: 77.595 });
  assert(r.status === 200, `rider location → ${r.status}: ${JSON.stringify(r.body)}`);
  r = await api("POST", "/api/rider/availability", riderToken, { isAvailable: true });
  assert(r.status === 200, `rider availability → ${r.status}: ${JSON.stringify(r.body)}`);
}

// ── Customer journey ──────────────────────────────────────
log("Register customer → expect ACTIVE immediately");
{
  const { status, body } = await api("POST", "/api/auth/register/customer", customerToken, {
    name: "E2E Customer",
  });
  assert(status === 201, `register/customer → ${status}: ${JSON.stringify(body)}`);
  assert(body.status === "ACTIVE", `customer should be ACTIVE, got ${body.status}`);
}

log("Customer browses shops → approved shop is visible");
{
  const { status, body } = await api("GET", "/api/shops?limit=100", customerToken);
  assert(status === 200, `list shops → ${status}`);
  assert(
    (body.data ?? []).some((s: any) => s.id === shopId),
    "approved shop not visible to customer",
  );
}

log("Customer places an order (COD, with idempotency key)");
let orderId: string;
const orderKey = `e2e-key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
{
  const { status, body } = await api("POST", "/api/orders", customerToken, {
    shopId,
    items: [{ serviceId, quantity: 2 }],
    pickupAddress: "12 Customer Lane, Bengaluru",
    deliveryAddress: "12 Customer Lane, Bengaluru",
    pickupLat: 12.97,
    pickupLng: 77.593,
    idempotencyKey: orderKey,
  });
  assert(status === 201, `create order → ${status}: ${JSON.stringify(body)}`);
  orderId = body.order.id;
  assert(body.order.status === "PLACED", `order should be PLACED, got ${body.order.status}`);
  assert(body.order.totalAmount === 10000, `total should be 10000, got ${body.order.totalAmount}`);
  assert(body.order.deliveryFee > 0, "delivery fee should be > 0 (coords were sent)");
  assert(body.payment?.status === "PENDING", "COD payment should be auto-created as PENDING");
}

log("Replaying the same idempotency key returns the SAME order (no duplicate)");
{
  const { status, body } = await api("POST", "/api/orders", customerToken, {
    shopId,
    items: [{ serviceId, quantity: 2 }],
    pickupAddress: "12 Customer Lane, Bengaluru",
    deliveryAddress: "12 Customer Lane, Bengaluru",
    pickupLat: 12.97,
    pickupLng: 77.593,
    idempotencyKey: orderKey,
  });
  assert(status === 200, `replay should be 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.order.id === orderId, `replay returned a different order: ${body.order.id}`);
}

log("Owner accepts → auto-assign should move it to PICKUP_ASSIGNED");
{
  const { status, body } = await api("POST", `/api/orders/${orderId}/accept`, ownerToken);
  assert(status === 200, `accept → ${status}: ${JSON.stringify(body)}`);
  const order = await waitForStatus(orderId, ownerToken, "PICKUP_ASSIGNED");
  assert(order.riderId, "riderId not set after auto-assign");
}

log("Negative: customer cannot cancel after acceptance (409)");
{
  const { status } = await api("POST", `/api/orders/${orderId}/cancel`, customerToken);
  assert(status === 409, `late cancel should be 409, got ${status}`);
}

log("Negative: owner cannot reject after acceptance (409)");
{
  const { status } = await api("POST", `/api/orders/${orderId}/reject`, ownerToken, {
    rejectionReason: "EMERGENCY",
  });
  assert(status === 409, `late reject should be 409, got ${status}`);
}

log("Rider picks up from customer → PICKED_UP_FROM_CUSTOMER");
{
  const { status, body } = await api("POST", `/api/rider/orders/${orderId}/pickup`, riderToken);
  assert(status === 200, `pickup → ${status}: ${JSON.stringify(body)}`);
}

log("Rider drops at shop → AT_SHOP");
{
  const { status } = await api("POST", `/api/rider/orders/${orderId}/dropoff`, riderToken);
  assert(status === 200, `dropoff → ${status}`);
}

log("Owner marks ready → auto-dispatch should move it to OUT_FOR_DELIVERY");
{
  const { status } = await api("POST", `/api/orders/${orderId}/ready`, ownerToken);
  assert(status === 200, `ready → ${status}`);
  await waitForStatus(orderId, ownerToken, "OUT_FOR_DELIVERY");
}

log("Rider delivers → DELIVERED");
{
  const { status } = await api("POST", `/api/rider/orders/${orderId}/deliver`, riderToken);
  assert(status === 200, `deliver → ${status}`);
}

log("Verify final order, full event trail, and rider earnings");
{
  const { body: order } = await api("GET", `/api/orders/${orderId}`, adminToken);
  assert(order.status === "DELIVERED", `final status ${order.status}`);
  assert(
    order.payment?.amount === order.totalAmount + order.platformFee + order.deliveryFee,
    "payment amount mismatch",
  );

  const { body: events } = await api("GET", `/api/orders/${orderId}/events`, adminToken);
  const trail = events.map((e: any) => e.toStatus).join(" → ");
  console.log(`     trail: ${trail}`);
  const expected = [
    "PLACED",
    "SHOP_ACCEPTED",
    "PICKUP_ASSIGNED",
    "PICKED_UP_FROM_CUSTOMER",
    "AT_SHOP",
    "READY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ];
  assert(
    JSON.stringify(events.map((e: any) => e.toStatus)) === JSON.stringify(expected),
    "event trail does not match the canonical state machine",
  );

  const { body: earnings } = await api("GET", "/api/rider/earnings", riderToken);
  console.log(`     rider earnings: ${JSON.stringify(earnings).slice(0, 200)}`);
}

// ── Suspension semantics ──────────────────────────────────
log("Suspension: customer places a second order (stays PLACED)");
let order2Id: string;
{
  const { status, body } = await api("POST", "/api/orders", customerToken, {
    shopId,
    items: [{ serviceId, quantity: 1 }],
    pickupAddress: "12 Customer Lane, Bengaluru",
    deliveryAddress: "12 Customer Lane, Bengaluru",
    pickupLat: 12.97,
    pickupLng: 77.593,
  });
  assert(status === 201, `second order → ${status}: ${JSON.stringify(body)}`);
  order2Id = body.order.id;
}

log("Impact endpoint reports the PLACED order before suspension");
{
  const { status, body } = await api(
    "GET",
    `/api/admin/users/${ownerUserId}/impact`,
    adminToken,
  );
  assert(status === 200, `impact → ${status}: ${JSON.stringify(body)}`);
  assert(body.totalActiveOrders === 1, `expected 1 active order, got ${body.totalActiveOrders}`);
  assert(body.placedWillBeCancelled === 1, `expected 1 cancellable, got ${body.placedWillBeCancelled}`);
}

log("Suspend owner → PLACED order auto-cancelled, shop hidden, owner blocked");
{
  const { status, body } = await api(
    "POST",
    `/api/admin/users/${ownerUserId}/suspend`,
    adminToken,
  );
  assert(status === 200, `suspend → ${status}: ${JSON.stringify(body)}`);
  assert(
    body.cancelledPlacedOrders === 1,
    `expected cancelledPlacedOrders=1, got ${body.cancelledPlacedOrders}`,
  );

  const { body: order2 } = await api("GET", `/api/orders/${order2Id}`, adminToken);
  assert(order2.status === "CANCELLED", `order2 should be CANCELLED, got ${order2.status}`);

  const { body: list } = await api("GET", "/api/shops?limit=100", customerToken);
  assert(
    !(list.data ?? []).some((s: any) => s.id === shopId),
    "suspended shop still visible to customers",
  );

  const { status: ownerStatus, body: ownerBody } = await api(
    "GET",
    "/api/shop/settings",
    ownerToken,
  );
  assert(
    ownerStatus === 403 && ownerBody.code === "ERR_SUSPENDED",
    `owner should be blocked with ERR_SUSPENDED, got ${ownerStatus}: ${JSON.stringify(ownerBody)}`,
  );
}

log("Reinstate owner → shop APPROVED and visible again");
{
  const { status } = await api(
    "POST",
    `/api/admin/users/${ownerUserId}/approve`,
    adminToken,
  );
  assert(status === 200, `reinstate → ${status}`);
  const { body: settings } = await api("GET", "/api/shop/settings", ownerToken);
  assert(settings.status === "APPROVED", `shop should be APPROVED again, got ${settings.status}`);
}

log("Cleanup: remove all test data (db + firebase)");
await cleanupDb();
await cleanupFirebase();

console.log("\n✅ E2E PASSED — full order lifecycle works end to end\n");
await pool.end();
process.exit(0);
