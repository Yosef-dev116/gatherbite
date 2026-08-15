import assert from "node:assert/strict";
import test from "node:test";

import { getDominosStoreSnapshot } from "./dominos";

const PROFILE = "/profile";
const MENU = "/menu";

function profile() {
  return {
    AddressDescription: "386 University Ave, Charlottetown, PE",
    IsOpen: true,
    IsOnlineNow: true,
    AllowDeliveryOrders: true,
    AllowCarryoutOrders: true,
  };
}

function menu() {
  return { Coupons: {}, Products: {}, Variants: {}, Toppings: {} };
}

interface Reply { status?: number; body?: unknown; retryAfter?: string; error?: Error }

async function withSequencedFetch<T>(
  replies: { profile: Reply[]; menu: Reply[] },
  run: (calls: { profile: number; menu: number }) => Promise<T>,
): Promise<T> {
  const original = global.fetch;
  const calls = { profile: 0, menu: 0 };
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    const key = url.includes(PROFILE) ? "profile" : url.includes(MENU) ? "menu" : null;
    if (!key) throw new Error("unexpected URL");
    const index = calls[key]++;
    const reply = replies[key][index] ?? replies[key].at(-1);
    if (!reply) throw new Error(`missing ${key} reply`);
    if (reply.error) throw reply.error;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(reply.retryAfter === undefined ? {} : { "Retry-After": reply.retryAfter }),
      json: async () => reply.body,
    } as Response;
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    global.fetch = original;
  }
}

test("a transient failed endpoint retries once without duplicating the successful endpoint and honors Retry-After", async () => {
  await withSequencedFetch({
    profile: [{ body: profile() }],
    menu: [{ status: 503, retryAfter: "0.02" }, { body: menu() }],
  }, async (calls) => {
    const startedAt = performance.now();
    const snapshot = await getDominosStoreSnapshot("10950");
    assert.equal(snapshot.status, "ok");
    assert.equal(calls.profile, 1);
    assert.equal(calls.menu, 2);
    assert.equal(performance.now() - startedAt >= 15, true);
  });
});

test("a hard client response is not retried and remains a fail-closed partial snapshot", async () => {
  await withSequencedFetch({
    profile: [{ body: profile() }],
    menu: [{ status: 404 }, { body: menu() }],
  }, async (calls) => {
    const snapshot = await getDominosStoreSnapshot("10950");
    assert.equal(calls.profile, 1);
    assert.equal(calls.menu, 1);
    assert.equal(snapshot.status, "partial");
    assert.equal(snapshot.errors.some((error) => error.includes("HTTP 404")), true);
  });
});

test("a transient endpoint remains partial and UNKNOWN-safe after exactly one exhausted retry", async () => {
  await withSequencedFetch({
    profile: [{ body: profile() }],
    menu: [{ status: 503 }, { status: 503 }, { body: menu() }],
  }, async (calls) => {
    const snapshot = await getDominosStoreSnapshot("10950");
    assert.equal(calls.profile, 1);
    assert.equal(calls.menu, 2);
    assert.equal(snapshot.status, "partial");
    assert.deepEqual(snapshot.deals, []);
    assert.equal(snapshot.errors.some((error) => error.includes("HTTP 503")), true);
  });
});

test("an explicit caller abort is never retried even when the fetch error resembles a timeout", async () => {
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
  const controller = new AbortController();
  controller.abort();
  await withSequencedFetch({
    profile: [{ error: aborted }, { body: profile() }],
    menu: [{ error: aborted }, { body: menu() }],
  }, async (calls) => {
    const snapshot = await getDominosStoreSnapshot("10950", undefined, controller.signal);
    assert.equal(calls.profile, 1);
    assert.equal(calls.menu, 1);
    assert.equal(snapshot.status, "failed");
  });
});

test("caller cancellation interrupts Retry-After waiting without a second endpoint fetch", async () => {
  const controller = new AbortController();
  await withSequencedFetch({
    profile: [{ body: profile() }],
    menu: [{ status: 503, retryAfter: "10" }, { body: menu() }],
  }, async (calls) => {
    const startedAt = performance.now();
    setTimeout(() => controller.abort(), 10);
    const snapshot = await getDominosStoreSnapshot("10950", undefined, controller.signal);
    assert.equal(calls.profile, 1);
    assert.equal(calls.menu, 1);
    assert.equal(snapshot.status, "partial");
    assert.equal(performance.now() - startedAt < 500, true);
  });
});
