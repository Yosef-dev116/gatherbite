#!/usr/bin/env tsx
/**
 * Task 17, Step 4 — opt-in, network-dependent deployed-latency timing check.
 *
 * THIS SCRIPT IS NOT PART OF `npm test`. It requires an already-deployed
 * GatherBite URL (Task 18/19's job — no deployment exists at the time this
 * script was written) and makes one real HTTP request against it. Run it
 * manually:
 *
 *   npm run test:live -- --url=https://your-deployment.example.com
 *   GATHERBITE_LIVE_URL=https://your-deployment.example.com npm run test:live
 *   npm run test:live -- --url=... --stream
 *   npm run test:live -- --url=... --body='{"attendees":2,"budgetCad":40,"serviceMethod":"carryout","groups":[],"pizzaPreferences":[]}'
 *
 * Usage / flags:
 *   --url=<base url>       Deployed base URL. Also settable via GATHERBITE_LIVE_URL.
 *                          Required — this script never guesses a deployment.
 *   --body=<json>          A GatherBiteInput JSON object as the organizer
 *                          request body. Also settable via
 *                          GATHERBITE_LIVE_REQUEST_BODY. When omitted, a small
 *                          built-in safe carryout example (no delivery
 *                          address, no PII) is used.
 *   --stream                Hit /api/gatherbite/stream (NDJSON) instead of the
 *                          plain JSON /api/gatherbite route. The streaming
 *                          route does not currently set a Server-Timing
 *                          header; this is reported explicitly rather than
 *                          fabricated.
 *   --path=<path>           Override the request path (defaults to
 *                          /api/gatherbite, or /api/gatherbite/stream with --stream).
 *
 * Privacy discipline: whatever request body is used (including any delivery
 * address in a caller-supplied --body/GATHERBITE_LIVE_REQUEST_BODY) lives
 * only in a local variable for the single request this script makes. It is
 * never written to stdout, stderr, or any log — this script only ever prints
 * response-derived facts: the Server-Timing header, total duration, option
 * count, and the public decision sequence.
 */
import type { GatherBiteEvaluation, GatherBiteInput, PublicGatherBiteEvent } from "../src/lib/gatherbite/contracts";

interface CliOptions {
  baseUrl: string;
  path: string;
  stream: boolean;
  requestBody: GatherBiteInput;
}

/** No delivery address, no PII — safe to construct from source. */
const DEFAULT_SAFE_REQUEST: GatherBiteInput = {
  attendees: 4,
  budgetCad: 80,
  serviceMethod: "carryout",
  groups: [{ id: "vegetarian", people: 2, restrictions: ["vegetarian"] }],
  pizzaPreferences: ["pepperoni"],
};

function parseCliOptions(argv: string[]): CliOptions {
  const flags = new Map<string, string>();
  const booleanFlags = new Set<string>();
  for (const arg of argv) {
    if (arg === "--stream") {
      booleanFlags.add("stream");
      continue;
    }
    const match = /^--([a-z-]+)=([\s\S]*)$/.exec(arg);
    if (match) flags.set(match[1], match[2]);
  }

  const baseUrl = flags.get("url") ?? process.env.GATHERBITE_LIVE_URL ?? "";
  if (!baseUrl) {
    throw new Error(
      "A deployed base URL is required: pass --url=<https://...> or set "
      + "GATHERBITE_LIVE_URL. This script never guesses a deployment target.",
    );
  }

  const stream = booleanFlags.has("stream");
  const path = flags.get("path") ?? (stream ? "/api/gatherbite/stream" : "/api/gatherbite");

  const rawBody = flags.get("body") ?? process.env.GATHERBITE_LIVE_REQUEST_BODY ?? null;
  const requestBody: GatherBiteInput = rawBody ? (JSON.parse(rawBody) as GatherBiteInput) : DEFAULT_SAFE_REQUEST;

  return { baseUrl: baseUrl.replace(/\/+$/, ""), path, stream, requestBody };
}

function countOptions(result: GatherBiteEvaluation): number {
  return (result.recommended ? 1 : 0) + result.alternatives.length;
}

function decisionSequence(events: PublicGatherBiteEvent[]): Array<{ candidateId: string; decision: "APPROVE" | "REJECT" }> {
  return events
    .filter((event): event is Extract<PublicGatherBiteEvent, { type: "decision" }> => event.type === "decision")
    .map((event) => ({ candidateId: event.candidateId, decision: event.decision }));
}

async function runJsonCheck(options: CliOptions): Promise<void> {
  const url = `${options.baseUrl}${options.path}`;
  const startedAt = performance.now();
  // `options.requestBody` (which may carry a delivery address) is used only
  // here, for this one request, and is never logged.
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.requestBody),
  });
  const serverTiming = response.headers.get("server-timing");
  const body = await response.json() as GatherBiteEvaluation | { error: string };
  const totalDurationMs = performance.now() - startedAt;

  console.log(`status: ${response.status}`);
  console.log(`Server-Timing: ${serverTiming ?? "(not present)"}`);
  console.log(`total duration: ${totalDurationMs.toFixed(1)}ms`);

  if ("error" in body) {
    console.log("response was an error; no options to report.");
    process.exitCode = response.ok ? 0 : 1;
    return;
  }

  console.log(`option count: ${countOptions(body)}`);
  console.log(`decision sequence: ${JSON.stringify(decisionSequence(body.events))}`);
}

async function runStreamCheck(options: CliOptions): Promise<void> {
  const url = `${options.baseUrl}${options.path}`;
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.requestBody),
  });

  console.log(`status: ${response.status}`);
  console.log("Server-Timing: not applicable (the streaming endpoint does not set this header)");

  if (!response.ok || !response.body) {
    const totalDurationMs = performance.now() - startedAt;
    console.log(`total duration: ${totalDurationMs.toFixed(1)}ms`);
    console.log("response body was unavailable; no options to report.");
    process.exitCode = 1;
    return;
  }

  const decisions: Array<{ candidateId: string; decision: "APPROVE" | "REJECT" }> = [];
  let optionCount = 0;
  let buffer = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
      if (!line) continue;
      const event = JSON.parse(line) as PublicGatherBiteEvent;
      if (event.type === "decision") decisions.push({ candidateId: event.candidateId, decision: event.decision });
      if (event.type === "complete") optionCount = countOptions(event.result);
    }
  }

  const totalDurationMs = performance.now() - startedAt;
  console.log(`total duration: ${totalDurationMs.toFixed(1)}ms`);
  console.log(`option count: ${optionCount}`);
  console.log(`decision sequence: ${JSON.stringify(decisions)}`);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.stream) await runStreamCheck(options);
  else await runJsonCheck(options);
}

main().catch((error) => {
  // Redact: never print the caught error verbatim — it could echo request/
  // response internals from a fetch failure. Report failure only.
  console.error("check-gatherbite-live failed unexpectedly. See process exit code.");
  void error;
  process.exitCode = 1;
});
