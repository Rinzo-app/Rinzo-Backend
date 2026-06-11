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

const { pool } = await import("./src/db/client.js");
const ord = await pool.query(
  `select o.id, o.status from orders o join users u on u.id = o.customer_id
   where u.email = 'emu.customer@rinzo.test' order by o.created_at desc limit 1`,
);
const rid = await pool.query(
  `select r.id, r.status, r.is_available from riders r join users u on u.id = r.user_id
   where u.email = 'emu.rider@rinzo.test'`,
);
console.log("order:", JSON.stringify(ord.rows[0]), "| rider:", JSON.stringify(rid.rows[0]));
await pool.end();

const res = await fetch(`${BASE}/api/admin/orders/${ord.rows[0].id}/assign-pickup`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth.idToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ riderId: rid.rows[0].id }),
});
const body = await res.json().catch(() => null);
console.log("assign-pickup →", res.status, JSON.stringify(body).slice(0, 160));
process.exit(0);
