"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import type { CartEvent, CartPreparationUiState } from "@/components/CartPreparation";
import { EvaluationProgress } from "@/components/EvaluationProgress";
import { GatherBiteResults, reduceDecisionState } from "@/components/GatherBiteResults";
import { GroupRequirementsForm } from "@/components/GroupRequirementsForm";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { buildGuidedHandoff } from "@/lib/cart/dominosCartFallback";
import type { CartPreparationResult } from "@/lib/cart/contracts";
import {
  GatherBiteEvaluationSchema,
  type GatherBiteEvaluation,
  type GatherBiteInput,
  type PublicGatherBiteEvent,
  type VerifiedDominosOption,
} from "@/lib/gatherbite/contracts";
import { DEMO_EVALUATION, DEMO_INPUT } from "@/lib/gatherbite/demoFixture";
import { createNdjsonParser } from "@/lib/gatherbite/events";

interface EvaluationRequestOptions {
  fetchImpl?: typeof fetch;
  onEvent: (event: PublicGatherBiteEvent) => void;
  signal?: AbortSignal;
}

class PublicRequestError extends Error {}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Never expose an untrusted response body.
  }
  return "GatherBite could not complete this evaluation.";
}

async function requestJsonFallback(
  input: GatherBiteInput,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<GatherBiteEvaluation> {
  const response = await fetchImpl("/api/gatherbite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new PublicRequestError(await responseError(response));
  const parsed = GatherBiteEvaluationSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("GatherBite returned an invalid evaluation.");
  return parsed.data;
}

/** Use JSON only when streaming failed before an event could start an evaluation. */
export async function requestGatherBiteEvaluation(
  input: GatherBiteInput,
  options: EvaluationRequestOptions,
): Promise<GatherBiteEvaluation> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let receivedEvents = 0;

  try {
    const response = await fetchImpl("/api/gatherbite/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: options.signal,
    });
    if (!response.ok) {
      if (response.status === 400) {
        throw new PublicRequestError(await responseError(response));
      }
      throw new Error("Streaming is unavailable.");
    }
    if (!response.body) throw new Error("Streaming is unavailable.");

    const parser = createNdjsonParser();
    const reader = response.body.getReader();
    let completed: GatherBiteEvaluation | null = null;
    const accept = (events: PublicGatherBiteEvent[]) => {
      for (const event of events) {
        receivedEvents += 1;
        options.onEvent(event);
        if (event.type === "complete") completed = event.result;
        if (event.type === "error") throw new Error(event.message);
      }
    };
    const acceptChunk = (chunk: Uint8Array) => {
      let start = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 0x0a) continue;
        accept(parser.push(chunk.subarray(start, index + 1)));
        start = index + 1;
      }
      if (start < chunk.length) accept(parser.push(chunk.subarray(start)));
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acceptChunk(value);
    }
    accept(parser.finish());
    if (!completed) throw new Error("GatherBite could not complete this evaluation.");
    return completed;
  } catch (error) {
    if (error instanceof PublicRequestError) throw error;
    if (options.signal?.aborted) throw error;
    if (receivedEvents > 0) throw new Error("GatherBite could not complete this evaluation.");

    const result = await requestJsonFallback(input, fetchImpl, options.signal);
    options.onEvent({ type: "complete", result });
    return result;
  }
}

interface CartPreparationResponse {
  events: CartEvent[];
  result: CartPreparationResult;
}

function isCartPreparationResponse(value: unknown): value is CartPreparationResponse {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.events)
    && record.result !== null
    && typeof record.result === "object"
    && typeof (record.result as { status?: unknown }).status === "string";
}

/** POSTs the organizer's selected candidate for fresh re-verification and cart preparation. Never trusts the client's own copy of the candidate beyond sending it for the server to independently re-check. */
async function requestCartPreparation(
  option: VerifiedDominosOption,
  organizerInput: GatherBiteInput,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<CartPreparationResponse> {
  const response = await fetchImpl("/api/gatherbite/cart/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate: option.candidate, input: organizerInput }),
    signal,
  });
  if (!response.ok) throw new Error(await responseError(response));
  const body: unknown = await response.json();
  if (!isCartPreparationResponse(body)) throw new Error("GatherBite returned an invalid cart preparation result.");
  return body;
}

export default function Home() {
  const [input, setInput] = useState<GatherBiteInput | null>(null);
  const [events, setEvents] = useState<PublicGatherBiteEvent[]>([]);
  const [evaluation, setEvaluation] = useState<GatherBiteEvaluation | null>(null);
  const [decision, dispatchDecision] = useReducer(reduceDecisionState, {
    selectedCandidateId: null,
    cartIntent: "idle",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cartPreparation, setCartPreparation] = useState<CartPreparationUiState | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const cartRequest = useRef<AbortController | null>(null);

  function showDemo() {
    activeRequest.current?.abort();
    cartRequest.current?.abort();
    activeRequest.current = null;
    cartRequest.current = null;
    setError(null);
    setBusy(false);
    setIsDemo(true);
    setInput(DEMO_INPUT);
    setEvents(DEMO_EVALUATION.events);
    setEvaluation(DEMO_EVALUATION);
    dispatchDecision({ type: "clear" });
    setCartPreparation(null);
  }

  useEffect(() => () => {
    activeRequest.current?.abort();
    cartRequest.current?.abort();
  }, []);

  async function evaluate(nextInput: GatherBiteInput) {
    activeRequest.current?.abort();
    cartRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setIsDemo(false);
    setInput(nextInput);
    setEvents([]);
    setEvaluation(null);
    dispatchDecision({ type: "clear" });
    setCartPreparation(null);
    setError(null);
    setBusy(true);

    try {
      const result = await requestGatherBiteEvaluation(nextInput, {
        signal: controller.signal,
        onEvent: (event) => {
          if (activeRequest.current !== controller) return;
          setEvents((current) => [...current, event]);
          if (event.type === "complete") setEvaluation(event.result);
        },
      });
      if (activeRequest.current === controller) setEvaluation(result);
    } catch (caught) {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      setError(caught instanceof Error ? caught.message : "GatherBite could not complete this evaluation.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  async function prepareCart(option: VerifiedDominosOption) {
    if (!input) return;
    cartRequest.current?.abort();
    cartRequest.current = null;

    if (isDemo) {
      // DEMO MODE never calls the real cart-preparation API or a live
      // model. buildGuidedHandoff is a pure, already-reviewed function
      // (Task 14/16), so this renders the real guided-handoff presentation
      // path against simulated data only.
      const result: CartPreparationResult = {
        status: "FALLBACK_READY",
        actualCart: null,
        comparison: null,
        handoffUrl: null,
        fallback: buildGuidedHandoff(option.candidate),
        reason: "DEMO MODE — simulated data; no live cart was prepared.",
      };
      setCartPreparation({ phase: "done", events: [], result });
      return;
    }

    const controller = new AbortController();
    cartRequest.current = controller;
    setCartPreparation({ phase: "loading", events: [] });

    try {
      const { events: cartEvents, result } = await requestCartPreparation(option, input, fetch, controller.signal);
      if (cartRequest.current === controller) setCartPreparation({ phase: "done", events: cartEvents, result });
    } catch (caught) {
      if (controller.signal.aborted || cartRequest.current !== controller) return;
      setCartPreparation({
        phase: "error",
        message: caught instanceof Error ? caught.message : "Cart preparation could not be completed.",
      });
    } finally {
      if (cartRequest.current === controller) cartRequest.current = null;
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-7 px-4 pb-6 pt-7 sm:px-6 sm:pb-8 sm:pt-7">
        <header className="max-w-2xl py-2 sm:py-5">
          <p className="section-label">Verified group ordering</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            Feed the whole group, without the guesswork.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            Share the hard constraints once. GatherBite checks live public restaurant data, tests every candidate, and leaves the final decision with you.
          </p>
        </header>

        <ol className="workflow-steps" aria-label="GatherBite workflow">
          <li><span>1</span>Group requirements</li>
          <li><span>2</span>Verified options</li>
          <li><span>3</span>Your decision</li>
        </ol>

        <GroupRequirementsForm busy={busy} onSubmit={evaluate} />

        <button
        type="button"
        onClick={showDemo}
        disabled={busy}
        className="self-start rounded-lg border border-dashed border-muted px-3 py-2 text-xs font-medium text-muted transition hover:border-foreground hover:text-foreground disabled:opacity-50"
        >
          View demo (simulated data, not a live order)
        </button>

        {isDemo && (
        <p role="status" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          DEMO MODE — this is simulated data for demonstration purposes only. It was not checked against live Domino&apos;s data or a live model, and no real order or cart was prepared.
        </p>
        )}

        <EvaluationProgress events={events} busy={busy} />

        {error && <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</p>}

        {evaluation && (
        <GatherBiteResults
          evaluation={evaluation}
          selectedCandidateId={decision.selectedCandidateId}
          cartIntent={decision.cartIntent}
          onSelect={(candidateId) => {
            cartRequest.current?.abort();
            cartRequest.current = null;
            setCartPreparation(null);
            dispatchDecision({ type: "select", candidateId });
          }}
          onChangeSelection={() => {
            cartRequest.current?.abort();
            cartRequest.current = null;
            setCartPreparation(null);
            dispatchDecision({ type: "clear" });
          }}
          onPrepareCart={(option) => {
            dispatchDecision({ type: "prepare" });
            void prepareCart(option);
          }}
          cartPreparationState={cartPreparation}
        />
        )}

        <aside className="trust-note" aria-label="Important ordering information">
          <strong>You stay in control.</strong>
          <span>
            Live public data can change. GatherBite is not affiliated with a restaurant, does not guarantee medical allergy safety, and never completes payment.
            {input ? ` Last request: ${input.attendees} people.` : ""}
          </span>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
