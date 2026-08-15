"use client";

import { useState } from "react";
import { PIZZA_PREFERENCE_LABELS } from "@/lib/types";
import type { DominosTradeoff } from "@/lib/restaurants/dominosCompare";
import type {
  ProviderCheck,
  ProviderCheckStatus,
  ProviderOption,
  ProviderResultStatus,
} from "@/lib/gatherbite";

const STATUS_STYLES: Record<ProviderResultStatus, { label: string; className: string }> = {
  viable: { label: "Viable", className: "bg-success-soft text-success" },
  "not-viable": { label: "Not viable", className: "bg-danger-soft text-danger" },
  "insufficient-data": { label: "Insufficient data", className: "bg-border text-foreground" },
};

const CHECK_STYLES: Record<ProviderCheckStatus, { label: string; className: string }> = {
  pass: { label: "Pass", className: "text-success" },
  fail: { label: "Fail", className: "text-danger" },
  unknown: { label: "Unknown", className: "text-muted" },
};

function formatWait(wait: { min: number; max: number } | null): string {
  return wait ? `${wait.min}–${wait.max} min` : "Unknown / unavailable";
}

function CheckRow({ label, value }: { label: string; value: ProviderCheck }) {
  const style = CHECK_STYLES[value.status];
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold tracking-wide uppercase">
        <span className="text-muted">{label}</span>
        <span className={style.className}>{style.label}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{value.detail}</p>
    </div>
  );
}

function VerificationTrail({ option }: { option: ProviderOption }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3.5 py-3">
      <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Verification trail</h4>
      <ol className="mt-2.5 flex flex-col gap-2.5">
        {option.verificationEvents.map((event, index) => {
          const dot = event.kind === "success" ? "bg-success" : event.kind === "failure" ? "bg-danger" : "bg-accent";
          return (
            <li key={`${option.id}-event-${index}`} className="flex gap-2.5 text-sm">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <div className="min-w-0">
                <p className={event.kind === "failure" ? "font-medium text-danger" : event.kind === "success" ? "font-medium text-success" : "text-foreground"}>
                  {event.label}
                </p>
                {event.detail && <p className="mt-0.5 break-words text-xs leading-relaxed text-muted">{event.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ProviderCard({
  option,
  selected,
  onSelect,
}: {
  option: ProviderOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = STATUS_STYLES[option.status];

  return (
    <article className={`flex flex-col gap-4 rounded-xl border bg-surface p-5 sm:p-6 ${selected ? "border-accent ring-2 ring-accent/15" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-accent uppercase">Store {option.storeId}</p>
          <h3 className="text-lg font-semibold tracking-tight">{option.restaurant}</h3>
          <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{option.address ?? "Address unavailable"}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      {option.reason && (
        <div className={`rounded-lg px-3.5 py-2.5 text-sm ${option.status === "not-viable" ? "bg-danger-soft text-danger" : "bg-border text-foreground"}`}>
          <span className="font-semibold">Why this option did not pass: </span>{option.reason}
        </div>
      )}

      {option.orderItems.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Candidate order</h4>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border px-3.5">
            {option.orderItems.map((item, index) => (
              <li key={`${option.id}-item-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                <span><span className="font-medium">{item.quantity} ×</span> {item.name}</span>
                <span className="text-muted">
                  {item.totalSlices === null ? "capacity unknown" : `${item.totalSlices} slices`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {option.preference.status !== "not-requested" && (
        <div className="rounded-lg border border-border px-3.5 py-2.5 text-sm">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Soft preferences</p>
          <p className="mt-1 text-muted">{option.preference.detail}</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <CheckRow label="Enough food" value={option.checks.capacity} />
        <CheckRow label="Dietary" value={option.checks.dietary} />
        <CheckRow label="Budget" value={option.checks.budget} />
        <CheckRow label="Availability" value={option.checks.availability} />
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-accent-soft px-3.5 py-3 text-sm">
        <div>
          <p className="text-xs text-muted">Estimated total</p>
          <p className="mt-0.5 font-semibold text-accent">
            {option.estimatedTotalCad === null ? "Unknown" : `$${option.estimatedTotalCad.toFixed(2)}`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Delivery</p>
          <p className="mt-0.5 font-medium">{formatWait(option.waits.delivery)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Carryout</p>
          <p className="mt-0.5 font-medium">{formatWait(option.waits.carryout)}</p>
        </div>
      </div>

      <VerificationTrail option={option} />

      <button
        type="button"
        onClick={onSelect}
        disabled={option.status !== "viable"}
        className="rounded-lg border border-accent px-4 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-transparent"
      >
        {selected ? "Selected for human review ✓" : option.status === "viable" ? "Select this option" : "Selection unavailable"}
      </button>
    </article>
  );
}

function FinalReview({ option, onChange }: { option: ProviderOption; onChange: () => void }) {
  const badge = STATUS_STYLES[option.status];

  return (
    <section id="your-decision" className="flex scroll-mt-6 flex-col gap-5 rounded-xl border-2 border-accent bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-accent uppercase">Your decision</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {option.restaurant} · Store {option.storeId}
          </h2>
          <p className="mt-1 text-sm text-muted">Final review before leaving GatherBite</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase ${badge.className}`}>
          Selected · {badge.label}
        </span>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Selected order</h3>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border px-3.5">
          {option.orderItems.map((item) => (
            <li key={`${option.id}-review-${item.itemId}`} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
              <span>
                <span className="font-semibold">{item.quantity} ×</span> {item.name}
                {item.unitPriceCad !== null && (
                  <span className="text-muted"> · ${item.unitPriceCad.toFixed(2)} each</span>
                )}
              </span>
              <span className="font-medium tabular-nums">
                {item.lineTotalCad === null ? "Price unknown" : `$${item.lineTotalCad.toFixed(2)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <CheckRow label="Enough food" value={option.checks.capacity} />
        <CheckRow label="Dietary" value={option.checks.dietary} />
      </div>

      <div className="grid gap-3 rounded-lg bg-accent-soft px-4 py-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted">Estimated total</p>
          <p className="mt-0.5 text-lg font-semibold text-accent">
            {option.estimatedTotalCad === null ? "Unknown" : `$${option.estimatedTotalCad.toFixed(2)} CAD`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Delivery wait</p>
          <p className="mt-0.5 text-lg font-semibold">{formatWait(option.waits.delivery)}</p>
        </div>
      </div>

      {option.preference.status !== "not-requested" && (
        <div className="rounded-lg border border-border px-3.5 py-3 text-sm">
          <p className="font-medium">
            Requested: {option.preference.requested.map((preference) => PIZZA_PREFERENCE_LABELS[preference]).join(", ")}
          </p>
          <p className="mt-1 text-muted">{option.preference.detail}</p>
        </div>
      )}

      {option.externalOrderUrl ? (
        <>
          <a
            href={option.externalOrderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-[#c04a1a]"
          >
            Continue to restaurant · Review order
          </a>
          <p className="text-center text-xs leading-relaxed text-muted">
            Opens the restaurant&apos;s ordering page. Review the configuration and final checkout total yourself;
            GatherBite does not purchase or pay.
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-background px-3.5 py-3 text-sm text-muted">
          <p className="font-medium text-foreground">Direct ordering link unavailable</p>
          <p className="mt-1">
            GatherBite has no verified customer-ordering destination for this provider. Use the selected order above
            to continue with the restaurant manually; no checkout has been started.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onChange}
        className="self-center text-sm font-medium text-accent hover:underline"
      >
        Change selected option
      </button>
    </section>
  );
}

function Tradeoff({ tradeoff }: { tradeoff: DominosTradeoff }) {
  if (tradeoff.kind === "not-applicable") return null;

  let text: string;
  if (tradeoff.kind === "real-tradeoff") {
    text = `Both Domino's stores passed. Store ${tradeoff.cheaperStoreId} saves $${tradeoff.savingsCad.toFixed(2)}; Store ${tradeoff.fasterStoreId} saves about ${tradeoff.savingsMinutes} minutes.`;
  } else if (tradeoff.kind === "same-price-faster") {
    text = `Both Domino's stores passed at the same estimated price. Store ${tradeoff.fasterStoreId} is about ${tradeoff.savingsMinutes} minutes faster.`;
  } else {
    text = `Both Domino's stores passed. Store ${tradeoff.winnerStoreId} is not more expensive or slower based on the known data.`;
  }

  return (
    <div className="rounded-xl border border-accent bg-accent-soft px-4 py-3 text-sm text-accent">
      <p className="font-semibold">Tradeoff between verified choices</p>
      <p className="mt-1">{text}</p>
    </div>
  );
}

export function GatherBiteResults({
  options,
  dominosTradeoff,
}: {
  options: ProviderOption[];
  dominosTradeoff: DominosTradeoff;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const viableCount = options.filter((option) => option.status === "viable").length;
  const selectedOption = options.find((option) => option.id === selectedId && option.status === "viable") ?? null;

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-xl border border-accent bg-surface p-5 sm:p-6">
        <p className="text-xs font-semibold tracking-widest text-accent uppercase">The magic pass</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">The AI proposes. It doesn&apos;t decide.</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          GatherBite evaluated {options.length} store option{options.length === 1 ? "" : "s"}. Every viable label requires deterministic dietary, capacity, and budget checks; unknown evidence stays unknown.
        </p>
        <p className="mt-2 text-sm font-medium text-foreground">
          {viableCount === 0 ? "No option passed every required check." : `${viableCount} option${viableCount === 1 ? "" : "s"} passed and remain available for your decision.`}
        </p>
      </div>

      <Tradeoff tradeoff={dominosTradeoff} />

      <div className="flex flex-col gap-4">
        {options.map((option) => (
          <ProviderCard
            key={option.id}
            option={option}
            selected={selectedId === option.id}
            onSelect={() => setSelectedId(option.id)}
          />
        ))}
      </div>

      {selectedOption && <FinalReview option={selectedOption} onChange={() => setSelectedId(null)} />}

      <p className="text-center text-xs leading-relaxed text-muted">
        GatherBite does not purchase, pay, or check out automatically. You remain responsible for the final restaurant order.
      </p>
    </section>
  );
}
