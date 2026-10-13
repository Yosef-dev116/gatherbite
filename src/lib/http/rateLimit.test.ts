import assert from "node:assert/strict";
import test from "node:test";

import {
  checkRateLimit,
  rateLimitKey,
  rateLimitedResponse,
  resetRateLimitState,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "./rateLimit";

test("requests under the limit are allowed and report remaining budget", () => {
  resetRateLimitState();
  const first = checkRateLimit("key-a", 1_000);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, RATE_LIMIT_MAX_REQUESTS - 1);

  const second = checkRateLimit("key-a", 1_050);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, RATE_LIMIT_MAX_REQUESTS - 2);
});

test("the request past the limit is refused with a positive Retry-After", () => {
  resetRateLimitState();
  for (let index = 0; index < RATE_LIMIT_MAX_REQUESTS; index += 1) {
    assert.equal(checkRateLimit("key-b", 1_000).allowed, true);
  }

  const refused = checkRateLimit("key-b", 1_000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.ok(refused.retryAfterSeconds >= 1);
});

test("a fresh window reopens once the previous one elapses", () => {
  resetRateLimitState();
  for (let index = 0; index < RATE_LIMIT_MAX_REQUESTS + 5; index += 1) {
    checkRateLimit("key-c", 1_000);
  }
  assert.equal(checkRateLimit("key-c", 1_000).allowed, false);
  assert.equal(checkRateLimit("key-c", 1_000 + RATE_LIMIT_WINDOW_MS).allowed, true);
});

test("counting is per key, so one caller cannot exhaust another's budget", () => {
  resetRateLimitState();
  for (let index = 0; index < RATE_LIMIT_MAX_REQUESTS + 1; index += 1) {
    checkRateLimit("noisy", 1_000);
  }
  assert.equal(checkRateLimit("noisy", 1_000).allowed, false);
  assert.equal(checkRateLimit("quiet", 1_000).allowed, true);
});

test("the key is the first forwarded hop, falling back to a shared bucket", () => {
  assert.equal(
    rateLimitKey(new Request("http://localhost/api/gatherbite", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" },
    })),
    "203.0.113.7",
  );
  assert.equal(
    rateLimitKey(new Request("http://localhost/api/gatherbite", {
      headers: { "x-real-ip": "203.0.113.9" },
    })),
    "203.0.113.9",
  );
  assert.equal(rateLimitKey(new Request("http://localhost/api/gatherbite")), "unidentified");
});

test("the refusal is non-cacheable and never leaks internals", async () => {
  const response = rateLimitedResponse(42);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "42");
  assert.deepEqual(await response.json(), {
    error: "Too many requests. Please wait a moment and try again.",
  });
});
