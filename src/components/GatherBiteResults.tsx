"use client";

import type { GatherBiteEvaluation } from "@/lib/gatherbite/contracts";
import { DecisionReview, type CartIntent } from "./DecisionReview";
import { VerificationJourney } from "./VerificationJourney";
import { VerifiedOptions } from "./VerifiedOptions";

export interface DecisionState {
  selectedCandidateId: string | null;
  cartIntent: CartIntent;
}

export type DecisionAction =
  | { type: "select"; candidateId: string }
  | { type: "prepare" }
  | { type: "clear" };

export function reduceDecisionState(state: DecisionState, action: DecisionAction): DecisionState {
  if (action.type === "select") {
    return { selectedCandidateId: action.candidateId, cartIntent: "idle" };
  }
  if (action.type === "prepare") {
    return state.selectedCandidateId === null ? state : { ...state, cartIntent: "requested" };
  }
  return { selectedCandidateId: null, cartIntent: "idle" };
}

function NoViableResult({ evaluation }: { evaluation: GatherBiteEvaluation }) {
  return (
    <section className="form-card" aria-labelledby="no-viable-heading">
      <div>
        <p className="eyebrow">Verified options</p>
        <h2 id="no-viable-heading" className="mt-1 text-2xl font-semibold tracking-tight">No verified option yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          GatherBite stopped instead of guessing: {evaluation.noViableReason ?? "The available evidence could not prove every hard constraint."}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-background p-4">
        <h3 className="font-semibold">Safe adjustments to try</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
          <li>Increase the maximum budget if price was the blocker.</li>
          <li>Try Carryout or Either if delivery serviceability was unavailable.</li>
          <li>Try again later if live menu or availability evidence was unknown.</li>
          <li>Keep every dietary need unchanged; GatherBite never weakens them automatically.</li>
        </ul>
      </div>
    </section>
  );
}

export function GatherBiteResults({
  evaluation,
  selectedCandidateId,
  cartIntent,
  onSelect,
  onChangeSelection,
  onPrepareCart,
}: {
  evaluation: GatherBiteEvaluation;
  selectedCandidateId: string | null;
  cartIntent: CartIntent;
  onSelect: (candidateId: string) => void;
  onChangeSelection: () => void;
  onPrepareCart: () => void;
}) {
  const approved = evaluation.recommended
    ? [evaluation.recommended, ...evaluation.alternatives]
    : [];
  const selected = approved.find(({ candidate }) => candidate.candidateId === selectedCandidateId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <VerificationJourney journeys={evaluation.journeys} />
      {evaluation.recommended ? (
        <VerifiedOptions
          recommended={evaluation.recommended}
          alternatives={evaluation.alternatives}
          journeys={evaluation.journeys}
          selectedCandidateId={selectedCandidateId}
          onSelect={onSelect}
        />
      ) : (
        <NoViableResult evaluation={evaluation} />
      )}
      {selected && (
        <DecisionReview
          option={selected}
          cartIntent={cartIntent}
          onChange={onChangeSelection}
          onPrepareCart={onPrepareCart}
        />
      )}
    </div>
  );
}
