import assert from "node:assert/strict";
import test from "node:test";

import { JsonBodyError, readJsonBody } from "./readJsonBody";

test("readJsonBody accepts an application/json request", async () => {
  const result = await readJsonBody(new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ attendees: 8 }),
  }));

  assert.deepEqual(result, { attendees: 8 });
});

test("readJsonBody rejects unsupported media types", async () => {
  await assert.rejects(
    readJsonBody(new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    })),
    (error: unknown) => error instanceof JsonBodyError && error.status === 415,
  );
});

test("readJsonBody requires an explicit JSON content type", async () => {
  await assert.rejects(
    readJsonBody(new Request("https://example.test", {
      method: "POST",
      body: new TextEncoder().encode("{}"),
    })),
    (error: unknown) => error instanceof JsonBodyError && error.status === 415,
  );
});

test("readJsonBody rejects a body once it crosses the byte limit", async () => {
  await assert.rejects(
    readJsonBody(new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "x".repeat(128) }),
    }), 32),
    (error: unknown) => error instanceof JsonBodyError && error.status === 413,
  );
});

test("readJsonBody never exposes malformed parser text", async () => {
  await assert.rejects(
    readJsonBody(new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })),
    (error: unknown) => error instanceof JsonBodyError
      && error.status === 400
      && error.message === "Please check your inputs and try again.",
  );
});
