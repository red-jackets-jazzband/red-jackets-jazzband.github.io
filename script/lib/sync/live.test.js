import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveChannel, parsePushed } from "./live.js";

function fakeSocket() {
  return { closed: false, close() { this.closed = true; } };
}

function harness() {
  const h = { sockets: [], versions: [], timers: [], fail: false };
  /** @type {any} */
  const options = {
    connect: async () => {
      if (h.fail) throw new Error("offline");
      const socket = fakeSocket();
      h.sockets.push(socket);
      return socket;
    },
    onVersion: (v) => { h.versions.push(v); },
    schedule: (fn, ms) => { h.timers.push({ fn, ms }); return h.timers.length; },
    cancel: () => {},
  };
  h.channel = createLiveChannel(options);
  return h;
}

test("parsePushed accepts a version and nothing else", () => {
  assert.equal(parsePushed('{"version":4}'), 4);
  assert.equal(parsePushed("pong"), null);
  assert.equal(parsePushed('{"version":"4"}'), null);
  assert.equal(parsePushed('{"version":-1}'), null);
});

test("pushed versions reach the owner", async () => {
  const h = harness();
  await h.channel.start();
  h.sockets[0].onmessage({ data: '{"version":3}' });
  h.sockets[0].onmessage({ data: "pong" });
  assert.deepEqual(h.versions, [3]);
  assert.equal(h.channel.isOpen(), true);
});

test("a dropped socket reconnects with a doubling delay, reset once open", async () => {
  const h = harness();
  await h.channel.start();
  h.sockets[0].onclose();
  assert.equal(h.timers[0].ms, 1000);
  h.fail = true;
  h.timers[0].fn();
  await new Promise((r) => { setImmediate(r); });
  assert.equal(h.timers[1].ms, 2000);
  h.fail = false;
  h.timers[1].fn();
  await new Promise((r) => { setImmediate(r); });
  h.sockets[1].onopen();
  h.sockets[1].onclose();
  assert.equal(h.timers[2].ms, 1000);
});

test("stop closes the socket and nothing reconnects", async () => {
  const h = harness();
  await h.channel.start();
  h.channel.stop();
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.channel.isOpen(), false);
  assert.equal(h.timers.length, 0);
});

test("a socket that arrives after stop is closed, not kept", async () => {
  const h = harness();
  const pending = h.channel.start();
  h.channel.stop();
  await pending;
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.channel.isOpen(), false);
});
