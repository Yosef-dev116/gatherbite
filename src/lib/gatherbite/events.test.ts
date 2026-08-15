import assert from "node:assert/strict";
import test from "node:test";

import {
  createEventCollector,
  createNdjsonParser,
  encodeNdjsonEvent,
  publicEvaluationError,
} from "./events";

test("split NDJSON chunks reassemble", () => {
  const parser = createNdjsonParser();
  assert.deepEqual(parser.push('{"type":"stage"'), []);
  const events = parser.push('}\n');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: "stage" });
});

test("NDJSON parser preserves multiple complete lines and trailing data", () => {
  const parser = createNdjsonParser();
  const first = parser.push(
    '{"type":"stage","stage":"planning","message":"Planning"}\n{"type":"candidate","candidateId":"c1","summary":"Pizza"}\n{"type":"stage","stage":"verifying","message":"partial',
  );
  assert.equal(first.length, 2);
  assert.deepEqual(parser.push(' verification"}\n'), [
    { type: "stage", stage: "verifying", message: "partial verification" },
  ]);
});

test("event collector emits only public event values", () => {
  const collector = createEventCollector();
  const event = { type: "candidate", candidateId: "c1", summary: "2 pizzas" } as const;
  collector.emit(event);
  assert.deepEqual(collector.events(), [event]);
  collector.emit({ type: "stage", stage: "verifying", message: "Checking" });
  assert.equal(collector.events().length, 2);
});

test("encoding is one NDJSON line", () => {
  const event = { type: "stage", stage: "observing", message: "Observing" } as const;
  assert.equal(new TextDecoder().decode(encodeNdjsonEvent(event)), `${JSON.stringify(event)}\n`);
});

test("evaluation errors are generic and do not leak thrown data", () => {
  const event = publicEvaluationError(new Error("private prompt address secret"));
  assert.deepEqual(event, { type: "error", message: "GatherBite could not complete this evaluation." });
  assert.equal(JSON.stringify(event).includes("private"), false);
});
