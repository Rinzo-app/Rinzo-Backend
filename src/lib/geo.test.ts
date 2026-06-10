import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { haversineDistance } from "./geo.js";

describe("haversineDistance", () => {
  test("zero distance for identical points", () => {
    assert.equal(haversineDistance(12.97, 77.59, 12.97, 77.59), 0);
  });

  test("one degree of latitude ≈ 111.2 km", () => {
    const d = haversineDistance(0, 0, 1, 0);
    assert.ok(Math.abs(d - 111_195) < 200, `got ${d}`);
  });

  test("symmetric: A→B equals B→A", () => {
    const ab = haversineDistance(12.9716, 77.5946, 13.0827, 80.2707);
    const ba = haversineDistance(13.0827, 80.2707, 12.9716, 77.5946);
    assert.ok(Math.abs(ab - ba) < 1e-6);
  });

  test("Bengaluru → Chennai ≈ 290 km (sanity)", () => {
    const d = haversineDistance(12.9716, 77.5946, 13.0827, 80.2707);
    assert.ok(d > 270_000 && d < 310_000, `got ${d}`);
  });
});
