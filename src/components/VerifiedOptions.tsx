import { PIZZA_PREFERENCE_LABELS } from "@/lib/types";
import type {
  CandidateEvidenceBundle,
  CandidateJourney,
  CandidatePizza,
  EvidenceCheck,
  OrganizerPizzaDisplayLine,
  VerifiedDominosOption,
} from "@/lib/gatherbite/contracts";

const STATUS_LABELS = {
  PASS: "Pass",
  FAIL: "Fail",
  UNKNOWN: "Unknown",
} as const;

function numericFact(check: EvidenceCheck, key: string): number | null {
  if (check.facts === null || typeof check.facts !== "object" || Array.isArray(check.facts)) return null;
  const value = (check.facts as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatWait(wait: { min: number; max: number } | null): string {
  return wait ? `${wait.min}–${wait.max} min` : "Unknown / unavailable";
}

export function verifiedTotal(option: VerifiedDominosOption): number | null {
  return numericFact(option.evidence.checks.budget, "totalCad")
    ?? numericFact(option.evidence.checks.budget, "verifiedTotalCad");
}

function toppingDescription(line: CandidatePizza): string {
  if (line.toppings.length === 0) return "No added toppings";
  return `Toppings ${line.toppings.map(({ code, quantity }) => `${code} × ${quantity}`).join(", ")}`;
}

function namedComponents(display: OrganizerPizzaDisplayLine, line: CandidatePizza): string {
  const sauce = line.sauceCode === null ? "No sauce" : display.sauceName ?? "Sauce name unavailable";
  const cheese = line.cheeseCode === null ? "No cheese" : display.cheeseName ?? "Cheese name unavailable";
  const toppings = display.toppings.length === 0
    ? "No added toppings"
    : display.toppings.map(({ name, quantity }) => `${name ?? "Topping name unavailable"} × ${quantity}`).join(", ");
  return `${sauce} · ${cheese} · ${toppings}`;
}

export function OrderLines({
  pizzas,
  displayLines,
}: {
  pizzas: readonly CandidatePizza[];
  displayLines?: readonly OrganizerPizzaDisplayLine[];
}) {
  const displayByLineId = new Map<string, OrganizerPizzaDisplayLine>(
    displayLines?.map((line) => [line.lineId, line] as const),
  );
  return (
    <ul className="order-lines">
      {pizzas.map((line) => {
        const display = displayByLineId.get(line.lineId);
        return (
          <li key={line.lineId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">
                {display
                  ? `${line.quantity} × ${display.productName ?? "Pizza name unavailable"}${display.variantName ? ` · ${display.variantName}` : " · Variant name unavailable"}`
                  : <>{line.quantity} × {line.sizeCode}&quot; {line.crustCode} pizza</>}
              </span>
              <span className="text-xs text-muted">{line.quantity * line.trustedSlicesPerPizza} verified slices</span>
            </div>
            {display && <p className="mt-1 text-sm leading-relaxed text-muted">{namedComponents(display, line)}</p>}
            {display ? (
              <details className="execution-details mt-2">
                <summary>Execution codes</summary>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Product {line.productCode} · Variant {line.variantCode} · Size {line.sizeCode} · Crust {line.crustCode}
                  {line.sauceCode ? ` · Sauce ${line.sauceCode}` : " · No sauce code"}
                  {line.cheeseCode ? ` · Cheese ${line.cheeseCode}` : " · No cheese code"}
                  {` · ${toppingDescription(line)}`}
                </p>
              </details>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Product {line.productCode} · Variant {line.variantCode}
                {line.sauceCode ? ` · Sauce ${line.sauceCode}` : " · No sauce code"}
                {line.cheeseCode ? ` · Cheese ${line.cheeseCode}` : " · No cheese code"}
                {` · ${toppingDescription(line)}`}
              </p>
            )}
            {line.purpose === "dietary-protected" && (
              <p className="mt-1 text-xs font-semibold text-success">
                Protected for {line.protectsGroupIds.join(", ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CheckBadge({ label, check }: { label: string; check: EvidenceCheck }) {
  const statusClass = check.status === "PASS"
    ? "evidence-pass"
    : check.status === "FAIL"
      ? "evidence-fail"
      : "evidence-unknown";
  return (
    <div className={`evidence-check ${statusClass}`} title={check.summary}>
      <span>{label}</span>
      <span>{STATUS_LABELS[check.status]}</span>
    </div>
  );
}

export function CheckGrid({ checks }: { checks: CandidateEvidenceBundle["checks"] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" aria-label="Independent verification checks">
      <CheckBadge label="Capacity" check={checks.capacity} />
      <CheckBadge label="Dietary" check={checks.dietary} />
      <CheckBadge label="Budget" check={checks.budget} />
      <CheckBadge label="Availability" check={checks.availability} />
    </div>
  );
}

function PreferenceSummary({ option }: { option: VerifiedDominosOption }) {
  const preference = option.evidence.preference;
  if (preference.requested.length === 0) {
    return <p className="text-sm text-muted">No pizza preferences requested; hard constraints drove the order.</p>;
  }
  return (
    <div className="text-sm leading-relaxed">
      <p>
        <span className="font-semibold">Preferences represented: </span>
        {preference.represented.length > 0
          ? preference.represented.map((value) => PIZZA_PREFERENCE_LABELS[value]).join(", ")
          : "None"}
      </p>
      {preference.unmet.map(({ preference: value, reason }) => (
        <p key={value} className="mt-1 text-muted">
          {PIZZA_PREFERENCE_LABELS[value]}: {reason}
        </p>
      ))}
    </div>
  );
}

function OptionCard({
  option,
  recommended,
  selected,
  onSelect,
}: {
  option: VerifiedDominosOption;
  recommended: boolean;
  selected: boolean;
  onSelect: (candidateId: string) => void;
}) {
  const total = verifiedTotal(option);
  const totalText = total === null ? "See verified budget evidence" : `$${total.toFixed(2)} CAD`;
  const providedSlices = option.candidate.pizzas.reduce(
    (sum, line) => sum + line.quantity * line.trustedSlicesPerPizza,
    0,
  );
  return (
    <article className={`result-option ${recommended ? "result-option-recommended" : ""} ${selected ? "result-option-selected" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">{recommended ? "GatherBite recommends" : "Verified alternative"}</p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">Domino&apos;s · Store {option.candidate.storeId}</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-muted">
            {option.storeAddress ?? "Address unavailable from the live store observation"}
          </p>
        </div>
        <span className="verified-pill">Verified by independent agent</span>
      </div>

      <div className="option-metrics">
        <div><span>Total</span><strong>{totalText}</strong></div>
        <div><span>Method</span><strong>{option.candidate.serviceMethod === "delivery" ? "Delivery" : "Carryout"}</strong></div>
        <div><span>Wait</span><strong>{formatWait(option.relevantWaitMinutes)}</strong></div>
        <div><span>Capacity</span><strong>{providedSlices} verified slices</strong></div>
      </div>

      <OrderLines pizzas={option.candidate.pizzas} displayLines={option.displayLines} />
      <CheckGrid checks={option.evidence.checks} />
      <PreferenceSummary option={option} />

      <details className="evidence-details">
        <summary>Why this passed</summary>
        <div className="mt-3 grid gap-2 text-sm text-muted">
          <p>{option.recommendationReason}</p>
          {Object.values(option.evidence.checks).map((check) => (
            <p key={check.code}><span className="font-medium text-foreground">{STATUS_LABELS[check.status]}:</span> {check.summary}</p>
          ))}
        </div>
      </details>

      <button
        type="button"
        className={selected ? "primary-action" : "secondary-action"}
        aria-pressed={selected}
        onClick={() => onSelect(option.candidate.candidateId)}
      >
        {selected ? "Selected option" : "Select this option"}
      </button>
    </article>
  );
}

function nonApproved(journey: CandidateJourney): boolean {
  return journey.outcome.status !== "DECIDED" || journey.outcome.decision.decision !== "APPROVE";
}

export function VerifiedOptions({
  recommended,
  alternatives,
  journeys,
  selectedCandidateId,
  onSelect,
}: {
  recommended: VerifiedDominosOption;
  alternatives: readonly VerifiedDominosOption[];
  journeys: readonly CandidateJourney[];
  selectedCandidateId: string | null;
  onSelect: (candidateId: string) => void;
}) {
  const checked = journeys.filter(nonApproved);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="verified-options-heading">
      <div>
        <p className="section-label">Verified options</p>
        <h2 id="verified-options-heading" className="mt-1 text-2xl font-semibold tracking-tight">Your best verified order</h2>
      </div>

      <OptionCard
        option={recommended}
        recommended
        selected={selectedCandidateId === recommended.candidate.candidateId}
        onSelect={onSelect}
      />

      {alternatives.length > 0 && (
        <details className="result-disclosure">
          <summary>See other verified options ({alternatives.length})</summary>
          <div className="mt-4 flex flex-col gap-4">
            {alternatives.map((option) => (
              <OptionCard
                key={`${option.candidate.candidateId}:${option.candidate.candidateVersion}`}
                option={option}
                recommended={false}
                selected={selectedCandidateId === option.candidate.candidateId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </details>
      )}

      {checked.length > 0 && (
        <details className="result-disclosure">
          <summary>What else GatherBite checked ({checked.length})</summary>
          <div className="mt-4 flex flex-col gap-3">
            {checked.map((journey) => {
              const decision = journey.outcome.status === "DECIDED" ? journey.outcome.decision : null;
              return (
                <article key={`${journey.candidate.candidateId}:${journey.candidate.candidateVersion}`} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">Store {journey.candidate.storeId} · Candidate {journey.candidate.candidateId}</p>
                    <span className={decision?.decision === "REJECT" ? "text-sm font-semibold text-danger" : "text-sm font-semibold text-muted"}>
                      {decision?.decision === "REJECT" ? "Rejected" : "Insufficient data"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {decision?.reasons[0] ?? (journey.outcome.status === "VERIFIER_ERROR" ? journey.outcome.reason : "Verification did not complete safely.")}
                  </p>
                  {journey.outcome.evidence && (
                    <div className="mt-3">
                      <CheckGrid checks={journey.outcome.evidence.checks} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
