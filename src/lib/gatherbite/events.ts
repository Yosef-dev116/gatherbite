import { GatherBiteEvaluationSchema, type PublicGatherBiteEvent } from "./contracts";
import { z } from "zod";

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

// The shared contract intentionally uses regular Zod objects for ergonomic
// server-side parsing. Stream input is a trust boundary, so the parser uses
// strict public variants and rejects extra keys instead of silently stripping
// them. The complete result still delegates its known shape to the shared
// recursive schema.
const StrictPublicGatherBiteEventSchema: z.ZodType<PublicGatherBiteEvent> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage"),
    stage: z.enum(["observing", "planning", "verifying", "adapting", "comparing"]),
    message: z.string(),
  }).strict(),
  z.object({
    type: z.literal("candidate"),
    candidateId: z.string().min(1),
    summary: z.string(),
  }).strict(),
  z.object({
    type: z.literal("decision"),
    candidateId: z.string().min(1),
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string(),
  }).strict(),
  z.object({ type: z.literal("complete"), result: GatherBiteEvaluationSchema }).strict(),
  z.object({ type: z.literal("error"), message: z.string() }).strict(),
]);

/**
 * Incrementally parses newline-delimited public events. A chunk may end in
 * the middle of a JSON record, so the incomplete suffix is retained until the
 * next push or finish call.
 */
export function createNdjsonParser(): NdjsonParser {
  let pending = "";
  const decoder = new TextDecoder();

  const parseLine = (line: string): PublicGatherBiteEvent | null => {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.trim() === "") return null;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid public GatherBite event.");
    }
    const parsed = StrictPublicGatherBiteEventSchema.safeParse(value);
    if (!parsed.success) throw new Error("Invalid public GatherBite event.");
    return parsed.data;
  };

  const parseCompleteLines = (): PublicGatherBiteEvent[] => {
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    const events: PublicGatherBiteEvent[] = [];
    for (const line of lines) {
      const event = parseLine(line);
      if (event) events.push(event);
    }
    return events;
  };

  return {
    push(chunk) {
      pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      return parseCompleteLines();
    },
    finish() {
      pending += decoder.decode();
      if (pending.trim() === "") {
        pending = "";
        return [];
      }
      const finalLine = pending;
      pending = "";
      const event = parseLine(finalLine);
      return event ? [event] : [];
    },
  };
}

/** Do not expose thrown provider/model text to a browser or event stream. */
export function publicEvaluationError(
  _error: unknown,
): Extract<PublicGatherBiteEvent, { type: "error" }> {
  return { type: "error", message: "GatherBite could not complete this evaluation." };
}
