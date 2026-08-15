import assert from "node:assert/strict";
import test from "node:test";

import { isTransientGatherBiteError, withOneTransientRetry } from "./retry";

test("one transient transport failure retries the same operation once", async () => {
  const attempts: number[] = [];
  const result = await withOneTransientRetry(async (attempt) => {
    attempts.push(attempt);
    if (attempt === 1) throw Object.assign(new Error("temporary"), { statusCode: 503 });
    return "ok";
  }, isTransientGatherBiteError);

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [1, 2]);
});
test("terminal and hard candidate failures are never transport-retried", async () => {
  for (const error of [
    Object.assign(new Error("bad request"), { statusCode: 400 }),
    { decision: "REJECT", disposition: "ADAPT_ORDER" },
    Object.assign(new Error("captcha"), { code: "CAPTCHA_REQUIRED" }),
  ]) {
    let attempts = 0;
    await assert.rejects(() => withOneTransientRetry(async () => {
      attempts += 1;
      throw error;
    }, isTransientGatherBiteError));
    assert.equal(attempts, 1);
  }
});

test("a second transient failure is returned after exactly two attempts", async () => {
  let attempts = 0;
  await assert.rejects(() => withOneTransientRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error("rate limited"), { statusCode: 429 });
  }, isTransientGatherBiteError));
  assert.equal(attempts, 2);
});

test("explicit abort, auth, CAPTCHA, anti-bot, and client barriers override contradictory retry hints", () => {
  const barriers = [
    { name: "AbortError", isRetryable: true, statusCode: 503 },
    { code: "CAPTCHA_REQUIRED", isRetryable: true, statusCode: 503 },
    { code: "ANTI_BOT_BLOCKED", isRetryable: true, statusCode: 429 },
    { code: "AUTHENTICATION_REQUIRED", isRetryable: true, statusCode: 503 },
    { statusCode: 401, isRetryable: true },
    { statusCode: 403, isRetryable: true },
    { statusCode: 400, isRetryable: true },
    { statusCode: 503, isRetryable: false },
  ];

  for (const barrier of barriers) assert.equal(isTransientGatherBiteError(barrier), false);
});
