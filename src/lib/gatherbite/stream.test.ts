import assert from "node:assert/strict";
import test from "node:test";

import { createGatherBiteStreamPostHandler } from "../../app/api/gatherbite/stream/route";
import type {
  GatherBiteEvaluation,
  GatherBiteInput,
  PublicGatherBiteEvent,
} from "./contracts";
import { createNdjsonParser } from "./events";

const input: GatherBiteInput = {
  attendees: 6,
  budgetCad: 100,
  serviceMethod: "delivery",
  deliveryAddress: {
    street: "73 Private Demo Avenue",
    city: "Charlottetown",
    province: "PE",
    postalCode: "C1A 1A1",
  },
  groups: [],
  pizzaPreferences: ["cheese"],
};

const empty: GatherBiteEvaluation = {
  recommended: null,
  alternatives: [],
  journeys: [],
  events: [],
  noViableReason: "No verified option.",
};

function request(body: unknown = input, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/gatherbite/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

async function readEvents(response: Response): Promise<{ events: PublicGatherBiteEvent[]; raw: string }> {
  const raw = await response.text();
  const parser = createNdjsonParser();
  return { events: [...parser.push(raw), ...parser.finish()], raw };
}

test("NDJSON handler streams ordered stages before exactly one final completion record", async () => {
  const post = createGatherBiteStreamPostHandler(async (_input, onEvent) => {
    onEvent({ type: "stage", stage: "observing", message: "Checking live Domino's options." });
    await Promise.resolve();
    onEvent({ type: "stage", stage: "planning", message: "Planning from live Domino's options." });
    onEvent({ type: "complete", result: empty });
    return empty;
  });

  const response = await post(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { events, raw } = await readEvents(response);
  assert.deepEqual(events.map((event) => event.type), ["stage", "stage", "complete"]);
  assert.equal(events.filter((event) => event.type === "complete").length, 1);
  for (const line of raw.trimEnd().split("\n")) assert.doesNotThrow(() => JSON.parse(line));
});

test("NDJSON handler adds one completion when an injected evaluator returns without emitting it", async () => {
  const post = createGatherBiteStreamPostHandler(async (_input, onEvent) => {
    onEvent({ type: "stage", stage: "comparing", message: "Comparing verified Domino's options." });
    return empty;
  });
  const { events } = await readEvents(await post(request()));
  assert.deepEqual(events.map((event) => event.type), ["stage", "complete"]);
});

test("streamed evaluator failures are typed generic public records", async () => {
  const post = createGatherBiteStreamPostHandler(async (_input, onEvent) => {
    onEvent({ type: "stage", stage: "observing", message: "Checking live Domino's options." });
    throw new Error("provider leaked private address and prompt");
  });
  const { events, raw } = await readEvents(await post(request()));
  assert.deepEqual(events, [
    { type: "stage", stage: "observing", message: "Checking live Domino's options." },
    { type: "error", message: "GatherBite could not complete this evaluation." },
  ]);
  assert.equal(raw.includes("provider leaked"), false);
});

test("response-body cancellation aborts live and model work", async () => {
  let observedSignal: AbortSignal | undefined;
  let resolveAbort!: () => void;
  const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
  const post = createGatherBiteStreamPostHandler(async (_input, _onEvent, _onTiming, signal) => {
    observedSignal = signal;
    return new Promise<GatherBiteEvaluation>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        resolveAbort();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  });

  const response = await post(request());
  assert.ok(response.body);
  await response.body.cancel();
  await aborted;
  assert.equal(observedSignal?.aborted, true);
});

test("request cancellation reaches the evaluator abort chain", async () => {
  const requestController = new AbortController();
  let resolveAbort!: () => void;
  const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
  const post = createGatherBiteStreamPostHandler(async (_input, _onEvent, _onTiming, signal) => {
    return new Promise<GatherBiteEvaluation>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        resolveAbort();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  });

  const response = await post(request(input, requestController.signal));
  requestController.abort();
  await aborted;
  await response.body?.cancel();
});

test("raw submitted delivery address bytes never appear in the stream", async () => {
  const post = createGatherBiteStreamPostHandler(async (_input, onEvent) => {
    onEvent({ type: "stage", stage: "observing", message: "Checking live Domino's options." });
    return empty;
  });
  const { raw } = await readEvents(await post(request()));
  assert.equal(raw.includes(input.deliveryAddress!.street), false);
  assert.equal(raw.includes(input.deliveryAddress!.postalCode), false);
});

test("invalid input stays a concise JSON error before streaming starts", async () => {
  let calls = 0;
  const post = createGatherBiteStreamPostHandler(async () => { calls += 1; return empty; });
  const response = await post(request({ attendees: 0 }));
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await response.json(), { error: "Number of people must be between 1 and 200." });
  assert.equal(calls, 0);
});
