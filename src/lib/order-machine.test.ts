import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertTransition,
  getAllowedTransitions,
  isTerminalStatus,
  type OrderStatus,
  type TransitionActor,
} from "./order-machine.js";
import { ConflictError, ForbiddenError } from "./errors.js";

const ALL_STATUSES: OrderStatus[] = [
  "PLACED",
  "SHOP_ACCEPTED",
  "PICKUP_OFFERED",
  "PICKUP_ASSIGNED",
  "PICKED_UP_FROM_CUSTOMER",
  "AT_SHOP",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "REJECTED_BY_SHOP",
];

const ALL_ACTORS: TransitionActor[] = [
  "CUSTOMER",
  "SHOP_OWNER",
  "RIDER",
  "ADMIN",
  "SYSTEM",
];

// The canonical rule table (domain contract §6–§8)
const LEGAL: Array<[OrderStatus, OrderStatus, TransitionActor[]]> = [
  ["PLACED", "SHOP_ACCEPTED", ["SHOP_OWNER"]],
  ["PLACED", "REJECTED_BY_SHOP", ["SHOP_OWNER", "SYSTEM"]],
  ["PLACED", "CANCELLED", ["CUSTOMER"]],
  ["SHOP_ACCEPTED", "PICKUP_OFFERED", ["SYSTEM"]],
  ["SHOP_ACCEPTED", "PICKUP_ASSIGNED", ["SYSTEM"]],
  ["PICKUP_OFFERED", "PICKUP_ASSIGNED", ["RIDER"]],
  ["PICKUP_OFFERED", "SHOP_ACCEPTED", ["RIDER", "SYSTEM"]],
  ["PICKUP_ASSIGNED", "PICKED_UP_FROM_CUSTOMER", ["RIDER"]],
  ["PICKED_UP_FROM_CUSTOMER", "AT_SHOP", ["RIDER"]],
  ["AT_SHOP", "READY", ["SHOP_OWNER"]],
  ["READY", "OUT_FOR_DELIVERY", ["SYSTEM"]],
  ["OUT_FOR_DELIVERY", "DELIVERED", ["RIDER"]],
];

describe("assertTransition — legal transitions", () => {
  for (const [from, to, actors] of LEGAL) {
    for (const actor of actors) {
      test(`${actor}: ${from} → ${to} is allowed`, () => {
        assert.doesNotThrow(() => assertTransition(from, to, actor));
      });
    }
  }
});

describe("assertTransition — actor enforcement", () => {
  for (const [from, to, actors] of LEGAL) {
    const denied = ALL_ACTORS.filter(
      (a) => a !== "ADMIN" && !actors.includes(a),
    );
    for (const actor of denied) {
      test(`${actor}: ${from} → ${to} is forbidden (403)`, () => {
        assert.throws(
          () => assertTransition(from, to, actor),
          ForbiddenError,
        );
      });
    }
  }
});

describe("assertTransition — illegal edges are conflicts (409)", () => {
  const ILLEGAL: Array<[OrderStatus, OrderStatus]> = [
    ["PLACED", "PICKUP_ASSIGNED"],          // skipping acceptance
    ["PLACED", "DELIVERED"],                 // skipping everything
    ["SHOP_ACCEPTED", "CANCELLED"],          // cancel only from PLACED
    ["SHOP_ACCEPTED", "REJECTED_BY_SHOP"],   // reject only from PLACED
    ["AT_SHOP", "OUT_FOR_DELIVERY"],         // must pass READY
    ["READY", "DELIVERED"],                  // must pass OUT_FOR_DELIVERY
    ["OUT_FOR_DELIVERY", "AT_SHOP"],         // no going backwards
    ["PICKUP_OFFERED", "PICKED_UP_FROM_CUSTOMER"], // must accept first
    ["PICKUP_ASSIGNED", "SHOP_ACCEPTED"],    // accepted offers don't go back
  ];

  for (const [from, to] of ILLEGAL) {
    for (const actor of ALL_ACTORS.filter((a) => a !== "ADMIN")) {
      test(`${actor}: ${from} → ${to} is a 409 conflict`, () => {
        assert.throws(() => assertTransition(from, to, actor), ConflictError);
      });
    }
  }
});

describe("assertTransition — terminal states are frozen", () => {
  const TERMINAL: OrderStatus[] = ["DELIVERED", "CANCELLED", "REJECTED_BY_SHOP"];
  for (const from of TERMINAL) {
    for (const to of ALL_STATUSES.filter((s) => s !== from)) {
      test(`non-admin cannot move ${from} → ${to}`, () => {
        assert.throws(
          () => assertTransition(from, to, "SHOP_OWNER"),
          ConflictError,
        );
      });
    }
  }

  test("isTerminalStatus matches the terminal set", () => {
    for (const s of ALL_STATUSES) {
      assert.equal(isTerminalStatus(s), TERMINAL.includes(s), s);
    }
  });
});

describe("assertTransition — ADMIN bypasses everything", () => {
  test("admin can perform any transition, even from terminal states", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        assert.doesNotThrow(() => assertTransition(from, to, "ADMIN"));
      }
    }
  });
});

describe("getAllowedTransitions", () => {
  test("returns the legal targets per actor", () => {
    assert.deepEqual(getAllowedTransitions("PLACED", "SHOP_OWNER").sort(), [
      "REJECTED_BY_SHOP",
      "SHOP_ACCEPTED",
    ]);
    assert.deepEqual(getAllowedTransitions("PLACED", "CUSTOMER"), ["CANCELLED"]);
    assert.deepEqual(getAllowedTransitions("PLACED", "RIDER"), []);
    assert.deepEqual(getAllowedTransitions("READY", "SYSTEM"), ["OUT_FOR_DELIVERY"]);
    assert.deepEqual(getAllowedTransitions("SHOP_ACCEPTED", "SYSTEM").sort(), [
      "PICKUP_ASSIGNED",
      "PICKUP_OFFERED",
    ]);
    assert.deepEqual(getAllowedTransitions("PICKUP_OFFERED", "RIDER").sort(), [
      "PICKUP_ASSIGNED",
      "SHOP_ACCEPTED",
    ]);
    assert.deepEqual(getAllowedTransitions("PICKUP_OFFERED", "SYSTEM"), ["SHOP_ACCEPTED"]);
  });

  test("admin sees every defined edge from a status", () => {
    assert.deepEqual(getAllowedTransitions("PLACED", "ADMIN").sort(), [
      "CANCELLED",
      "REJECTED_BY_SHOP",
      "SHOP_ACCEPTED",
    ]);
  });

  test("terminal states offer no transitions", () => {
    for (const s of ["DELIVERED", "CANCELLED", "REJECTED_BY_SHOP"] as OrderStatus[]) {
      for (const actor of ALL_ACTORS) {
        assert.deepEqual(getAllowedTransitions(s, actor), []);
      }
    }
  });
});
