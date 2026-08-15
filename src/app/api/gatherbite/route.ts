import { NextResponse } from "next/server";
import { buildOrder } from "@/lib/agent";
import { normalizeGatherBiteResults, buildDominosRequirements } from "@/lib/gatherbite";
import { OrderInputSchema, describeValidationError } from "@/lib/order-input-schema";
import { getDominosStoreSnapshot } from "@/lib/restaurants/dominos";
import type { AgentTimingEvent } from "@/lib/agent";
import type { DominosTimingEvent } from "@/lib/restaurants/dominos";
import { compareDominosStores, describeDominosTradeoff } from "@/lib/restaurants/dominosCompare";

const DOMINOS_STORE_IDS = ["10950", "10953"];

interface TimingEntry {
  name: string;
  durationMs: number;
  description: string;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function serverTimingHeader(entries: TimingEntry[]): string {
  return entries
    .map((entry) => `${entry.name};dur=${roundMilliseconds(entry.durationMs)};desc="${entry.description}"`)
    .join(", ");
}

function failureMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The provider evaluation did not complete.";
}

export async function POST(request: Request) {
  const requestStartedAt = performance.now();
  const timings: TimingEntry[] = [];
  const recordTiming = (name: string, durationMs: number, description: string) => {
    timings.push({ name, durationMs, description });
  };
  const recordAgentTiming = (event: AgentTimingEvent) => {
    if (event.stage === "groq-total") {
      recordTiming("groq", event.durationMs, "Little Caesars Groq tool loop");
      return;
    }
    const tools = event.toolNames?.length ? `: ${event.toolNames.join("+")}` : "";
    recordTiming(
      `groq_${event.stepNumber ?? timings.length + 1}`,
      event.durationMs,
      `Groq model round ${event.stepNumber ?? "?"}${tools}`
    );
  };
  const recordDominosTiming = (event: DominosTimingEvent) => {
    recordTiming(
      `dom_${event.storeId}_${event.stage}`,
      event.durationMs,
      `Domino's ${event.storeId} ${event.stage}`
    );
  };

  const body = await request.json();
  const parsed = OrderInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: describeValidationError(parsed.error) }, { status: 400 });
  }

  const input = parsed.data as Parameters<typeof buildOrder>[0];
  const groupPeopleSum = input.groups.reduce((sum, group) => sum + group.people, 0);
  if (groupPeopleSum > input.attendees) {
    return NextResponse.json(
      { error: `Dietary group headcounts (${groupPeopleSum}) exceed total attendees (${input.attendees}).` },
      { status: 400 }
    );
  }

  const littleCaesarsStartedAt = performance.now();
  const littleCaesarsPromise = (process.env.GROQ_API_KEY
    ? buildOrder(input, { onTiming: recordAgentTiming })
    : Promise.reject(new Error("The Little Caesars planning agent is unavailable because GROQ_API_KEY is not configured.")))
    .finally(() => {
      recordTiming("little_caesars", performance.now() - littleCaesarsStartedAt, "Little Caesars evaluation");
    });
  const dominosStartedAt = performance.now();
  const dominosPromise = Promise.all(
    DOMINOS_STORE_IDS.map((storeId) => getDominosStoreSnapshot(storeId, recordDominosTiming))
  ).finally(() => {
    recordTiming("dominos", performance.now() - dominosStartedAt, "Domino's live evaluation");
  });
  const [littleCaesarsSettled, dominosSettled] = await Promise.allSettled([
    littleCaesarsPromise,
    dominosPromise,
  ]);

  const littleCaesarsResult = littleCaesarsSettled.status === "fulfilled" ? littleCaesarsSettled.value : null;
  const littleCaesarsUnavailableReason =
    littleCaesarsSettled.status === "rejected" ? failureMessage(littleCaesarsSettled.reason) : undefined;

  const snapshots = dominosSettled.status === "fulfilled" ? dominosSettled.value : [];
  const dominosRequirements = buildDominosRequirements(input);
  const comparisonStartedAt = performance.now();
  const dominosResults = compareDominosStores(snapshots, dominosRequirements);
  const dominosTradeoff = describeDominosTradeoff(dominosResults);
  recordTiming("dom_compare", performance.now() - comparisonStartedAt, "Domino's deterministic comparison");

  const normalizationStartedAt = performance.now();
  const result = normalizeGatherBiteResults(
    input,
    littleCaesarsResult,
    littleCaesarsUnavailableReason,
    snapshots,
    dominosResults,
    dominosTradeoff
  );
  recordTiming("normalize", performance.now() - normalizationStartedAt, "Provider normalization");
  recordTiming("total", performance.now() - requestStartedAt, "GatherBite request");

  console.info(
    "[GatherBite timing]",
    timings.map((entry) => `${entry.name}=${roundMilliseconds(entry.durationMs)}ms`).join(" ")
  );

  return NextResponse.json(result, {
    headers: { "Server-Timing": serverTimingHeader(timings) },
  });
}
