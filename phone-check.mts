import "dotenv/config";
const { pool } = await import("./src/db/client.js");
const o = await pool.query(
  `select o.id, o.status, o.offer_expires_at, o.declined_rider_ids, ru.email as rider_email
   from orders o left join riders r on r.id = o.rider_id left join users ru on ru.id = r.user_id
   where o.created_at > now() - interval '30 minutes' order by o.created_at desc limit 3`,
);
console.log("ORDERS:", JSON.stringify(o.rows, null, 1));
const r = await pool.query(
  `select u.email, r.status, r.is_available, r.last_lat, r.last_lng
   from riders r join users u on u.id = r.user_id order by u.created_at`,
);
console.log("RIDERS:", JSON.stringify(r.rows, null, 1));
await pool.end();
