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
