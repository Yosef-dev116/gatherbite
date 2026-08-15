import type { ZodError } from "zod";

import {
  GatherBiteInputSchema,
  type GatherBiteEvaluation,
  type GatherBiteInput,
} from "@/lib/gatherbite/contracts";
import {
  encodeNdjsonEvent,
  isCompleteEvaluationEvent,
  publicEvaluationError,
  type EventSink,
} from "@/lib/gatherbite/events";
import {
  createDefaultGatherBiteDependencies,
  evaluateGatherBite,
} from "@/lib/gatherbite/orchestrator";
import { createTimingCollector, type TimingEntry } from "@/lib/gatherbite/timing";

export const runtime = "nodejs";

export type StreamRouteEvaluator = (
  input: GatherBiteInput,
  onEvent: EventSink,
  onTiming: (entry: TimingEntry) => void,
  signal: AbortSignal,
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

const defaultEvaluator: StreamRouteEvaluator = async (input, onEvent, onTiming, signal) => evaluateGatherBite(
  input,
  createDefaultGatherBiteDependencies(onTiming),
  onEvent,
  signal,
);

export function createGatherBiteStreamPostHandler(evaluator: StreamRouteEvaluator = defaultEvaluator) {
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

    const evaluationController = new AbortController();
    const abortEvaluation = () => evaluationController.abort();
    if (request.signal.aborted) abortEvaluation();
    else request.signal.addEventListener("abort", abortEvaluation, { once: true });

    let open = true;
    let completed = false;
    const timing = createTimingCollector();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send: EventSink = (event) => {
          if (!open || completed) return;
          controller.enqueue(encodeNdjsonEvent(event));
          if (isCompleteEvaluationEvent(event)) completed = true;
        };

        void evaluator(parsed.data, send, timing.record, evaluationController.signal)
          .then((result) => {
            if (!completed) send({ type: "complete", result });
          })
          .catch((error) => {
            if (!completed) send(publicEvaluationError(error));
          })
          .finally(() => {
            request.signal.removeEventListener("abort", abortEvaluation);
            if (open) {
              open = false;
              controller.close();
            }
          });
      },
      cancel() {
        open = false;
        request.signal.removeEventListener("abort", abortEvaluation);
        abortEvaluation();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

export const POST = createGatherBiteStreamPostHandler();
