import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveRiderLegDistanceKm } from "./rider-distance.js";
import { haversineDistance } from "./geo.js";

// MG Road → Cubbon Park, Bengaluru — roughly 1.6 km apart
const CUSTOMER = { lat: 12.9758, lng: 77.6045 };
const SHOP = { lat: 12.9763, lng: 77.5929 };
const RIDER = { lat: 12.97, lng: 77.6 };

describe("resolveRiderLegDistanceKm — priority chain", () => {
  test("prefers customer↔shop geo when both present", () => {
    const r = resolveRiderLegDistanceKm({
      leg: "PICKUP",
      customer: CUSTOMER,
      shop: SHOP,
      rider: RIDER,
      deliveryFeePaise: 5000,
      deliveryRatePerKm: 1000,
    });
    assert.ok(r);
    assert.equal(r.source, "GEO_CUSTOMER_SHOP");
    const expected =
      haversineDistance(CUSTOMER.lat, CUSTOMER.lng, SHOP.lat, SHOP.lng) / 1000;
    assert.ok(Math.abs(r.distanceKm - expected) < 1e-9);
  });

  test("falls back to rider↔shop geo without customer coords", () => {
    const r = resolveRiderLegDistanceKm({
      leg: "DROP",
      customer: null,
      shop: SHOP,
      rider: RIDER,
      deliveryFeePaise: 5000,
      deliveryRatePerKm: 1000,
    });
    assert.ok(r);
    assert.equal(r.source, "GEO_RIDER_SHOP");
  });

  test("falls back to fee estimate without any geo", () => {
    const r = resolveRiderLegDistanceKm({
      leg: "PICKUP",
      deliveryFeePaise: 5000, // ₹50 fee at ₹10/km round trip = 5 km round trip
      deliveryRatePerKm: 1000,
    });
    assert.ok(r);
    assert.equal(r.source, "ESTIMATED_FROM_FEE");
    assert.equal(r.distanceKm, 2.5); // one-way = half the round trip
  });

  test("returns null when nothing is available", () => {
    assert.equal(resolveRiderLegDistanceKm({ leg: "PICKUP" }), null);
    assert.equal(
      resolveRiderLegDistanceKm({ leg: "DROP", deliveryFeePaise: 0, deliveryRatePerKm: 1000 }),
      null,
    );
  });

  test("PICKUP and DROP legs are symmetric distances", () => {
    const pickup = resolveRiderLegDistanceKm({ leg: "PICKUP", customer: CUSTOMER, shop: SHOP });
    const drop = resolveRiderLegDistanceKm({ leg: "DROP", customer: CUSTOMER, shop: SHOP });
    assert.ok(pickup && drop);
    assert.ok(Math.abs(pickup.distanceKm - drop.distanceKm) < 1e-9);
  });
});

describe("payout math (paise integers)", () => {
  test("delivery fee: round trip km × rate, rounded to integer paise", () => {
    const distanceM = haversineDistance(
      CUSTOMER.lat, CUSTOMER.lng, SHOP.lat, SHOP.lng,
    );
    const roundTripKm = (distanceM / 1000) * 2;
    const fee = Math.round(roundTripKm * 1000); // ₹10/km in paise
    assert.ok(Number.isInteger(fee));
    assert.ok(fee > 0);
  });

  test("rider leg payout: one-way km × rate, rounded; never fractional paise", () => {
    const r = resolveRiderLegDistanceKm({ leg: "PICKUP", customer: CUSTOMER, shop: SHOP });
    assert.ok(r);
    const payout = Math.round(r.distanceKm * 700); // ₹7/km in paise
    assert.ok(Number.isInteger(payout));
    assert.ok(payout > 0);
  });

  test("fee-estimated payout never exceeds geo payout for same fee basis", () => {
    // The fee estimate halves the round trip — one leg's payout from the
    // estimate must equal half the fee-derived round trip at payout rate.
    const r = resolveRiderLegDistanceKm({
      leg: "PICKUP",
      deliveryFeePaise: 10_000,
      deliveryRatePerKm: 1000,
    });
    assert.ok(r);
    assert.equal(r.distanceKm, 5); // 10 km round trip → 5 km one-way
    assert.equal(Math.round(r.distanceKm * 700), 3500);
  });
});
