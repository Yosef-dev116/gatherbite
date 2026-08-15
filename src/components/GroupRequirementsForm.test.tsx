import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "../app/page";
import type {
  GatherBiteEvaluation,
  GatherBiteInput,
  PublicGatherBiteEvent,
} from "../lib/gatherbite/contracts";

const input: GatherBiteInput = {
  attendees: 8,
  budgetCad: 90,
  serviceMethod: "carryout",
  groups: [],
  pizzaPreferences: [],
};

const emptyEvaluation: GatherBiteEvaluation = {
  recommended: null,
  alternatives: [],
  journeys: [],
  events: [],
  noViableReason: "No verified option.",
};

test("the organizer starts with blank essentials and progressive optional needs", () => {
  const html = renderToStaticMarkup(createElement(Home));

  assert.match(html, /name="attendees"[^>]*value=""/);
  assert.match(html, /name="budgetCad"[^>]*value=""/);
  assert.match(html, /<input(?=[^>]*value="either")(?=[^>]*checked="")[^>]*>/);
  assert.match(html, /name="street"/);
  assert.equal(html.includes("data-dietary-group="), false);
  assert.match(html, /Add dietary need/);
  assert.match(html, /aria-pressed="false"[^>]*>Meat lovers</);
  assert.match(html, /Find my verified order/);

  for (const removedCopy of [
    "Night Shift",
    "PEI IT Alliance",
    "Little Caesars",
    "fixed-store",
    "adapter debug",
  ]) {
    assert.equal(html.includes(removedCopy), false, `removed copy leaked: ${removedCopy}`);
  }
});

test("the stream client falls back exactly once when streaming fails before any event", async () => {
  const pageModule = await import("../app/page");
  const requestEvaluation = (pageModule as unknown as {
    requestGatherBiteEvaluation?: (
      input: GatherBiteInput,
      options: {
        fetchImpl: typeof fetch;
        onEvent: (event: PublicGatherBiteEvent) => void;
      },
    ) => Promise<GatherBiteEvaluation>;
  }).requestGatherBiteEvaluation;
  assert.equal(typeof requestEvaluation, "function");
  if (!requestEvaluation) return;

  const calls: string[] = [];
  const seen: PublicGatherBiteEvent[] = [];
  const fetchImpl: typeof fetch = async (resource) => {
    calls.push(String(resource));
    if (calls.length === 1) return new Response(null, { status: 200 });
    return Response.json(emptyEvaluation);
  };

  const result = await requestEvaluation(input, {
    fetchImpl,
    onEvent: (event) => seen.push(event),
  });

  assert.deepEqual(calls, ["/api/gatherbite/stream", "/api/gatherbite"]);
  assert.deepEqual(result, emptyEvaluation);
  assert.deepEqual(seen, [{ type: "complete", result: emptyEvaluation }]);
});

test("the stream client never starts a duplicate evaluation after a public event", async () => {
  const pageModule = await import("../app/page");
  const requestEvaluation = (pageModule as unknown as {
    requestGatherBiteEvaluation?: (
      input: GatherBiteInput,
      options: {
        fetchImpl: typeof fetch;
        onEvent: (event: PublicGatherBiteEvent) => void;
      },
    ) => Promise<GatherBiteEvaluation>;
  }).requestGatherBiteEvaluation;
  assert.equal(typeof requestEvaluation, "function");
  if (!requestEvaluation) return;

  const calls: string[] = [];
  const seen: PublicGatherBiteEvent[] = [];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        '{"type":"stage","stage":"observing","message":"Checking live options."}\nnot-json\n',
      ));
      controller.close();
    },
  });
  const fetchImpl: typeof fetch = async (resource) => {
    calls.push(String(resource));
    return new Response(body, { status: 200 });
  };

  await assert.rejects(
    requestEvaluation(input, {
      fetchImpl,
      onEvent: (event) => seen.push(event),
    }),
    /could not complete/i,
  );
  assert.deepEqual(calls, ["/api/gatherbite/stream"]);
  assert.deepEqual(seen, [
    { type: "stage", stage: "observing", message: "Checking live options." },
  ]);
});

test("a typed server-side stream error fails closed without JSON fallback", async () => {
  const pageModule = await import("../app/page");
  const requestEvaluation = (pageModule as unknown as {
    requestGatherBiteEvaluation: (
      input: GatherBiteInput,
      options: {
        fetchImpl: typeof fetch;
        onEvent: (event: PublicGatherBiteEvent) => void;
      },
    ) => Promise<GatherBiteEvaluation>;
  }).requestGatherBiteEvaluation;
  const calls: string[] = [];
  const seen: PublicGatherBiteEvent[] = [];
  const fetchImpl: typeof fetch = async (resource) => {
    calls.push(String(resource));
    return new Response(
      '{"type":"error","message":"GatherBite could not complete this evaluation."}\n',
      { status: 200 },
    );
  };

  await assert.rejects(
    requestEvaluation(input, { fetchImpl, onEvent: (event) => seen.push(event) }),
    /could not complete/i,
  );
  assert.deepEqual(calls, ["/api/gatherbite/stream"]);
  assert.deepEqual(seen, [
    { type: "error", message: "GatherBite could not complete this evaluation." },
  ]);
});
