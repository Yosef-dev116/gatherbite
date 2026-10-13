import type { CandidateJourney, EvidenceCheck } from "@/lib/gatherbite/contracts";
import { CheckGrid, OrderLines } from "./VerifiedOptions";

function outcomeLabel(journey: CandidateJourney): string {
  if (journey.outcome.status === "VERIFIER_ERROR") return "Verification could not complete safely";
  return journey.outcome.decision.decision === "APPROVE"
    ? "Verification Agent approved"
    : "Verification Agent rejected";
}

function outcomeReason(journey: CandidateJourney): string {
  if (journey.outcome.status === "VERIFIER_ERROR") return journey.outcome.reason;
  return journey.outcome.decision.reasons.join(" ") || "No additional reason was supplied.";
}

function allChecks(journey: CandidateJourney): EvidenceCheck[] {
  return journey.outcome.evidence ? Object.values(journey.outcome.evidence.checks) : [];
}

export function VerificationJourney({ journeys }: { journeys: readonly CandidateJourney[] }) {
  if (journeys.length === 0) return null;
  const hasAdaptation = journeys.some((journey) => journey.adaptedFromCandidateId !== null);
  const heading = hasAdaptation
    ? "Proposed, checked, then adapted"
    : "Proposed and independently verified";
  return (
    <section className="form-card" aria-labelledby="verification-journey-heading">
      <div>
        <p className="section-label">The Magic Pass</p>
        <h2 id="verification-journey-heading" className="mt-1 text-2xl font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="mt-2 text-sm text-muted">The Planner cannot approve its own order. Each candidate goes to an independent Verification Agent.</p>
      </div>

      <div className="flex flex-col gap-3">
        {journeys.map((journey) => {
          const rejected = journey.outcome.status === "DECIDED" && journey.outcome.decision.decision === "REJECT";
          const approved = journey.outcome.status === "DECIDED" && journey.outcome.decision.decision === "APPROVE";
          const outcomeClass = rejected
            ? "rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger"
            : approved
              ? "rounded-lg bg-success-soft px-3 py-2.5 text-sm text-success"
              : "rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted";
          return (
            <details
              key={`${journey.candidate.candidateId}:${journey.candidate.candidateVersion}`}
              open={rejected || journey.adaptedFromCandidateId !== null}
              className={`verification-journey ${rejected ? "verification-rejected" : approved ? "verification-approved" : "verification-unknown"}`}
            >
              <summary>
                <span>
                  <span className="block text-xs font-semibold tracking-wide text-muted uppercase">
                    Candidate {journey.candidate.candidateId} · v{journey.candidate.candidateVersion}
                  </span>
                  <span className="mt-0.5 block font-semibold">{outcomeLabel(journey)}</span>
                </span>
                <span className={rejected ? "text-danger" : approved ? "text-success" : "text-muted"}>
                  {rejected ? "Rejected" : approved ? "Approved" : "Unknown"}
                </span>
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                {journey.adaptedFromCandidateId && (
                  <p className="adaptation-link">Adapted after {journey.adaptedFromCandidateId} was rejected.</p>
                )}
                <OrderLines pizzas={journey.candidate.pizzas} />
                {journey.outcome.evidence && <CheckGrid checks={journey.outcome.evidence.checks} />}
                <div className={outcomeClass}>
                  <span className="font-semibold">{outcomeLabel(journey)}: </span>{outcomeReason(journey)}
                </div>
                <details className="evidence-details">
                  <summary>Exact verification evidence</summary>
                  <div className="mt-3 grid gap-2 text-sm text-muted">
                    {allChecks(journey).map((check) => (
                      <p key={check.code}><span className="font-medium text-foreground">{check.status}:</span> {check.summary}</p>
                    ))}
                  </div>
                </details>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
