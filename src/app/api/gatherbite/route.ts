import type { ZodError } from "zod";

import {
  GatherBiteInputSchema,
  type GatherBiteEvaluation,
  type GatherBiteInput,
} from "@/lib/gatherbite/contracts";
import { type EventSink } from "@/lib/gatherbite/events";
import {
  createDefaultGatherBiteDependencies,
  evaluateGatherBite,
} from "@/lib/gatherbite/orchestrator";
import { createTimingCollector, type TimingEntry } from "@/lib/gatherbite/timing";

export const runtime = "nodejs";

type RouteEvaluator = (
  input: GatherBiteInput,
  onEvent: EventSink | undefined,
  onTiming: (entry: TimingEntry) => void,
) => Promise<GatherBiteEvaluation>;

function validationMessage(error: ZodError): string {
  const path = error.issues[0]?.path.join(".") ?? "";
  if (path === "deliveryAddress") return "Enter a delivery address for Delivery or Either.";
  if (path === "attendees") return "Number of people must be between 1 and 200.";
  if (path === "budgetCad") return "Budget must be a positive number.";
  if (path.includes("groups") && path.includes("people")) return "Each dietary group needs at least 1 person.";
  if (path.includes("restrictions")) return "One of the dietary groups has an invalid restriction selected.";
  if (path.includes("pizzaPreferences")) return "One of the selected pizza preferences is invalid.";
  return "Please check your inputs and try again.";
}

const defaultEvaluator: RouteEvaluator = async (input, onEvent, onTiming) => evaluateGatherBite(
  input,
  createDefaultGatherBiteDependencies(onTiming),
  onEvent,
);

export function createGatherBitePostHandler(evaluator: RouteEvaluator = defaultEvaluator) {
  return async function post(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Please check your inputs and try again." }, { status: 400 });
    }

    const parsed = GatherBiteInputSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: validationMessage(parsed.error) }, { status: 400 });
    }

    const timing = createTimingCollector();
    try {
      const result = await evaluator(parsed.data, undefined, timing.record);
      return Response.json(result, { headers: { "Server-Timing": timing.serverTiming() } });
    } catch {
      return Response.json(
        { error: "GatherBite could not complete this evaluation." },
        { status: 500, headers: { "Server-Timing": timing.serverTiming() } },
      );
    }
  };
}

export const POST = createGatherBitePostHandler();
