import { test } from "node:test";
import assert from "node:assert/strict";
import { holdLease, releaseLease, LEASE_MS } from "./lease.js";

function makeStorage() {
  const data = {};
  return {
    getItem: (k) => { return Object.hasOwn(data, k) ? data[k] : null; },
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

test("one tab holds the lease; another waits until it lapses or is released", () => {
  const storage = makeStorage();
  assert.equal(holdLease(storage, "a", 0), true);
  assert.equal(holdLease(storage, "b", 1000), false);
  assert.equal(holdLease(storage, "a", 5000), true); // renewed
  assert.equal(holdLease(storage, "b", 5000 + LEASE_MS - 1), false);
  assert.equal(holdLease(storage, "b", 5000 + LEASE_MS), true); // lapsed
  releaseLease(storage, "a"); // not the holder: no effect
  assert.equal(holdLease(storage, "a", 5000 + LEASE_MS + 1), false);
  releaseLease(storage, "b");
  assert.equal(holdLease(storage, "a", 5000 + LEASE_MS + 2), true);
});

test("a corrupt lease is taken over", () => {
  const storage = makeStorage();
  storage.setItem("rj.sync.lease", "nonsense");
  assert.equal(holdLease(storage, "a", 0), true);
});
