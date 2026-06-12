// Approve the phone-test owner (phone.owner@rinzo.test).
import "dotenv/config";
const KEY = "AIzaSyBbN4y2Vnj3QLTMhjfwG3X_5DPP7232saE";
const BASE = "https://rinzo-backend.onrender.com";

const auth = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@rinzo.app",
      password: process.env.E2E_ADMIN_PASSWORD,
      returnSecureToken: true,
    }),
  },
).then((r) => r.json());
if (!auth.idToken) throw new Error("admin signin failed");

const users = await fetch(`${BASE}/api/admin/users?role=SHOP_OWNER&status=PENDING`, {
  headers: { Authorization: `Bearer ${auth.idToken}` },
}).then((r) => r.json());
const list = Array.isArray(users) ? users : (users.users ?? users.data ?? []);
const target = list.find((u: any) => u.email === "phone.owner@rinzo.test");
if (!target) throw new Error("pending phone owner not found: " + JSON.stringify(list).slice(0, 200));

const ap = await fetch(`${BASE}/api/admin/users/${target.id}/approve`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth.idToken}` },
});
console.log("approve →", ap.status, JSON.stringify(await ap.json().catch(() => null)).slice(0, 120));
process.exit(0);
