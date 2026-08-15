import type { PublicGatherBiteEvent } from "./contracts";

/** A sink for the intentionally small, public evaluation event contract. */
export type EventSink = (event: PublicGatherBiteEvent) => void;

export interface EventCollector {
  emit: EventSink;
  sink: EventSink;
  events: () => PublicGatherBiteEvent[];
}

/**
 * Collects events without exposing a mutable internal array. Event payloads
 * are already constrained by PublicGatherBiteEvent; callers should construct
 * them from public ids and summaries rather than request data.
 */
export function createEventCollector(): EventCollector {
  const collected: PublicGatherBiteEvent[] = [];
  const emit: EventSink = (event) => {
    collected.push(event);
  };

  return {
    emit,
    sink: emit,
    events: () => collected.slice(),
  };
}

/** Encode one public event as a transport-friendly NDJSON record. */
export function encodeNdjsonEvent(event: PublicGatherBiteEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export interface NdjsonParser {
  push(chunk: string | Uint8Array): PublicGatherBiteEvent[];
  finish(): PublicGatherBiteEvent[];
}

/**
 * Incrementally parses newline-delimited public events. A chunk may end in
 * the middle of a JSON record, so the incomplete suffix is retained until the
 * next push or finish call.
 */
export function createNdjsonParser(): NdjsonParser {
  let pending = "";

  const parseCompleteLines = (): PublicGatherBiteEvent[] => {
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    const events: PublicGatherBiteEvent[] = [];
    for (const line of lines) {
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.trim() === "") continue;
      // The stream endpoint emits this same public contract. Keeping parsing
      // separate from request handling prevents arbitrary request objects from
      // being serialized by this helper.
      events.push(JSON.parse(trimmed) as PublicGatherBiteEvent);
    }
    return events;
  };

  return {
    push(chunk) {
      pending += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk, { stream: true });
      return parseCompleteLines();
    },
    finish() {
      if (pending.trim() === "") {
        pending = "";
        return [];
      }
      const finalLine = pending;
      pending = "";
      return [JSON.parse(finalLine) as PublicGatherBiteEvent];
    },
  };
}

/** Do not expose thrown provider/model text to a browser or event stream. */
export function publicEvaluationError(
  _error: unknown,
): Extract<PublicGatherBiteEvent, { type: "error" }> {
  return { type: "error", message: "GatherBite could not complete this evaluation." };
}
