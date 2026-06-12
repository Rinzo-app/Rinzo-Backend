import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeWeighedTotal,
  decideAdjustment,
  AUTO_APPROVE_INCREASE_PCT,
} from "./weighing.js";

describe("computeWeighedTotal", () => {
  test("multiplies unit price by fractional kg and rounds per line", () => {
    // ₹60/kg (6000 paise) × 2.5 kg = ₹150 (15000 paise)
    assert.equal(computeWeighedTotal([{ price: 6000, actualQuantity: 2.5 }]), 15000);
  });

  test("sums multiple items", () => {
    assert.equal(
      computeWeighedTotal([
        { price: 6000, actualQuantity: 1.2 },  // 7200
        { price: 2000, actualQuantity: 3 },    // 6000
      ]),
      13200,
    );
  });

  test("rounds line totals to integer paise", () => {
    // 333 paise × 1.5 = 499.5 → 500
    assert.equal(computeWeighedTotal([{ price: 333, actualQuantity: 1.5 }]), 500);
  });
});

describe("decideAdjustment", () => {
  test("decreases always apply", () => {
    assert.equal(decideAdjustment(10000, 7000), "APPLY");
  });

  test("equal total applies", () => {
    assert.equal(decideAdjustment(10000, 10000), "APPLY");
  });

  test("increase at exactly the threshold applies", () => {
    const baseline = 10000;
    const atThreshold = baseline + (baseline * AUTO_APPROVE_INCREASE_PCT) / 100;
    assert.equal(decideAdjustment(baseline, atThreshold), "APPLY");
  });

  test("increase above the threshold needs approval", () => {
    assert.equal(decideAdjustment(10000, 12001), "NEEDS_APPROVAL");
    assert.equal(decideAdjustment(6000, 15000), "NEEDS_APPROVAL"); // 2.5x
  });

  test("small increase applies", () => {
    assert.equal(decideAdjustment(10000, 10500), "APPLY");
  });
});
