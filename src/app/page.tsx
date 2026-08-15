"use client";

import { useEffect, useRef, useState } from "react";

import { GroupRequirementsForm } from "@/components/GroupRequirementsForm";
import {
  GatherBiteEvaluationSchema,
  type GatherBiteEvaluation,
  type GatherBiteInput,
  type PublicGatherBiteEvent,
} from "@/lib/gatherbite/contracts";
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
    if (!response.ok) throw new PublicRequestError(await responseError(response));
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

function evaluationStatus(events: readonly PublicGatherBiteEvent[]): string | null {
  const latest = events.at(-1);
  if (!latest) return null;
  if (latest.type === "stage") return latest.message;
  if (latest.type === "candidate") return latest.summary;
  if (latest.type === "decision") return latest.reason;
  if (latest.type === "error") return latest.message;
  return "Evaluation complete.";
}

export default function Home() {
  const [input, setInput] = useState<GatherBiteInput | null>(null);
  const [events, setEvents] = useState<PublicGatherBiteEvent[]>([]);
  const [evaluation, setEvaluation] = useState<GatherBiteEvaluation | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [cartState, setCartState] = useState<{ status: "idle"; candidateId: string | null }>({
    status: "idle",
    candidateId: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function evaluate(nextInput: GatherBiteInput) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setInput(nextInput);
    setEvents([]);
    setEvaluation(null);
    setSelectedCandidateId(null);
    setCartState({ status: "idle", candidateId: null });
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

  const status = evaluationStatus(events);
  const recommended = evaluation?.recommended ?? null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <header className="max-w-2xl">
        <p className="eyebrow">GatherBite</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
          The AI agent that figures out how to feed your group.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          Tell us what your group needs. GatherBite checks live public restaurant data and independently verifies the hard constraints before you decide.
        </p>
      </header>

      <ol className="workflow-steps" aria-label="GatherBite workflow">
        <li><span>1</span>Group requirements</li>
        <li><span>2</span>Verified options</li>
        <li><span>3</span>Your decision</li>
      </ol>

      <GroupRequirementsForm busy={busy} onSubmit={evaluate} />

      {(busy || status) && (
        <section className="form-card" aria-live="polite" aria-busy={busy}>
          <p className="eyebrow">GatherBite is working</p>
          <p className="mt-2 text-sm font-medium">{status ?? "Starting evaluation…"}</p>
        </section>
      )}

      {error && <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</p>}

      {evaluation && (
        <section className="form-card" aria-labelledby="verified-options-heading">
          <div>
            <p className="eyebrow">Verified options</p>
            <h2 id="verified-options-heading" className="mt-1 text-xl font-semibold tracking-tight">
              {recommended ? "A verified option is ready" : "No option passed every check"}
            </h2>
          </div>
          {recommended ? (
            <div className="rounded-xl border border-success bg-success-soft p-4">
              <p className="font-semibold">Domino&apos;s store {recommended.candidate.storeId}</p>
              <p className="mt-1 text-sm text-muted">{recommended.recommendationReason}</p>
              <button type="button" className="secondary-action mt-3" onClick={() => {
                setSelectedCandidateId(recommended.candidate.candidateId);
                setCartState({ status: "idle", candidateId: recommended.candidate.candidateId });
              }}>Review this option</button>
            </div>
          ) : <p className="text-sm leading-relaxed text-muted">{evaluation.noViableReason}</p>}
        </section>
      )}

      {recommended && selectedCandidateId === recommended.candidate.candidateId && (
        <section className="form-card" aria-labelledby="decision-heading">
          <div>
            <p className="eyebrow">Your decision</p>
            <h2 id="decision-heading" className="mt-1 text-xl font-semibold tracking-tight">Review before continuing</h2>
          </div>
          <p className="text-sm text-muted">
            Your verified option is selected. Cart preparation remains {cartState.status}; you remain responsible for final review and payment.
          </p>
          <button type="button" className="secondary-action self-start" onClick={() => {
            setSelectedCandidateId(null);
            setCartState({ status: "idle", candidateId: null });
          }}>Change selection</button>
        </section>
      )}

      <p className="pb-3 text-center text-xs leading-relaxed text-muted">
        Live public data can change. GatherBite does not claim a restaurant partnership or medical allergy safety, and never completes payment for you.
        {input ? ` Last request: ${input.attendees} people.` : ""}
      </p>
    </main>
  );
}
