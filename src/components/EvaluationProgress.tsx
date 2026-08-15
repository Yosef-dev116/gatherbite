import type { PublicGatherBiteEvent } from "@/lib/gatherbite/contracts";

const EVENT_LABELS = {
  observing: "Live stores",
  planning: "Planner",
  verifying: "Independent verification",
  adapting: "Adapting",
  comparing: "Comparison",
} as const;

export function EvaluationProgress({
  events,
  busy,
}: {
  events: readonly PublicGatherBiteEvent[];
  busy: boolean;
}) {
  const visibleEvents = events.filter((event) =>
    event.type === "stage" || event.type === "candidate" || event.type === "decision");
  if (!busy && visibleEvents.length === 0) return null;

  return (
    <section className="form-card evaluation-progress" aria-live="polite" aria-busy={busy}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">GatherBite is working</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            {busy ? "Evaluating real options" : "Evaluation complete"}
          </h2>
        </div>
        {busy && <span className="working-dot" aria-label="Evaluation in progress" />}
      </div>

      {visibleEvents.length === 0 ? (
        <p className="text-sm text-muted">Starting the live evaluation…</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Actual evaluation events">
          {visibleEvents.map((event, index) => {
            const rejected = event.type === "decision" && event.decision === "REJECT";
            const approved = event.type === "decision" && event.decision === "APPROVE";
            const label = event.type === "stage"
              ? EVENT_LABELS[event.stage]
              : event.type === "candidate"
                ? "Candidate proposed"
                : `Verification Agent ${event.decision === "APPROVE" ? "approved" : "rejected"}`;
            const message = event.type === "stage"
              ? event.message
              : event.type === "candidate"
                ? event.summary
                : event.reason;
            return (
              <li
                key={`${event.type}-${event.type === "stage" ? event.stage : event.candidateId}-${index}`}
                className={`evaluation-entry ${rejected ? "evaluation-entry-rejected" : approved ? "evaluation-entry-approved" : ""}`}
              >
                <span className="evaluation-event-dot" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed">{message}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
