import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeDeliveryFee } from "./delivery-fee.js";
import {
  DELIVERY_RATE_PER_KM,
  MIN_DELIVERY_FEE,
  FALLBACK_DELIVERY_FEE,
} from "../config/delivery.js";

describe("computeDeliveryFee", () => {
  test("normal distance: round trip × rate", () => {
    // 3 km one-way → 6 km round trip → 6 × ₹10 = ₹60 (6000 paise)
    assert.equal(computeDeliveryFee(3000), 6 * DELIVERY_RATE_PER_KM);
  });

  test("tiny distance is floored at the minimum fee", () => {
    // 100 m one-way → 0.2 km round trip → ₹2 computed → floored to ₹10
    assert.equal(computeDeliveryFee(100), MIN_DELIVERY_FEE);
  });

  test("zero distance still charges the minimum", () => {
    assert.equal(computeDeliveryFee(0), MIN_DELIVERY_FEE);
  });

  test("missing coordinates fall back to the flat fee — never free", () => {
    assert.equal(computeDeliveryFee(null), FALLBACK_DELIVERY_FEE);
    assert.equal(computeDeliveryFee(Number.NaN), FALLBACK_DELIVERY_FEE);
    assert.equal(computeDeliveryFee(Number.POSITIVE_INFINITY), FALLBACK_DELIVERY_FEE);
  });

  test("result is always integer paise and positive", () => {
    for (const d of [1, 333, 1234.56, 9999, 50_000]) {
      const fee = computeDeliveryFee(d);
      assert.ok(Number.isInteger(fee), `fee for ${d} not integer`);
      assert.ok(fee >= MIN_DELIVERY_FEE, `fee for ${d} below minimum`);
    }
  });
});
