import Link from "next/link";
import { getDominosStoreSnapshot } from "@/lib/restaurants/dominos";
import type { DominosStoreSnapshot } from "@/lib/restaurants/dominos";
import { compareDominosStores, describeDominosTradeoff } from "@/lib/restaurants/dominosCompare";
import type { DominosClassification, DominosComparisonResult } from "@/lib/restaurants/dominosCompare";
import { ALL_RESTRICTIONS, RESTRICTION_LABELS } from "@/lib/types";
import type { Restriction } from "@/lib/types";

// Live data changes constantly (deals, wait times, open status) — never
// bake this into a static build.
export const dynamic = "force-dynamic";

const STORE_IDS = ["10950", "10953"];

const CLASSIFICATION_BADGES: Record<DominosClassification, { label: string; className: string }> = {
  FULLY_VIABLE: { label: "Fully Viable", className: "bg-success-soft text-success" },
  VIABLE_BUT_OVER_BUDGET: { label: "Over Budget", className: "bg-accent-soft text-accent" },
  CLOSED_OR_UNAVAILABLE: { label: "Closed / Unavailable", className: "bg-danger-soft text-danger" },
  INSUFFICIENT_DIETARY_DATA: { label: "Insufficient Dietary Data", className: "bg-border text-foreground" },
  INSUFFICIENT_UNKNOWN_DATA: { label: "Insufficient Data", className: "bg-border text-foreground" },
};

function yesNoUnknown(value: boolean | null): string {
  return value === true ? "Yes" : value === false ? "No" : "Unknown";
}

function StoreCard({ snapshot, result }: { snapshot: DominosStoreSnapshot; result: DominosComparisonResult }) {
  const badge = CLASSIFICATION_BADGES[result.classification];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="font-semibold tracking-tight">Domino&apos;s — Store {snapshot.storeId}</h3>
          <p className="text-sm whitespace-pre-line text-muted">{snapshot.address ?? "Address unavailable"}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted">
        <div className="flex justify-between gap-3">
          <span>Open / online</span>
          <span className="text-foreground">
            {yesNoUnknown(snapshot.isOpen)} / {yesNoUnknown(snapshot.isOnlineNow)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Delivery / carryout</span>
          <span className="text-foreground">
            {yesNoUnknown(snapshot.deliveryAvailable)} / {yesNoUnknown(snapshot.carryoutAvailable)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Estimated wait</span>
          <span className="text-foreground">
            {result.waitMinutes ? `${result.waitMinutes.min}–${result.waitMinutes.max} min` : "Unavailable"}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border px-3.5 py-2.5 text-sm">
        {result.dealUsed ? (
          <>
            <p className="font-medium text-foreground">
              {result.dealUsed.quantity} × {result.dealUsed.name} (${result.dealUsed.price.toFixed(2)} ea) —{" "}
              {result.dealUsed.totalSlices} pizza slices
            </p>
            <p className="mt-0.5 text-muted">Estimated total for this group: ${result.estimatedTotalCad!.toFixed(2)}</p>
          </>
        ) : (
          <p className="text-muted">{result.reason ?? "No deterministic deal/price available for this store right now."}</p>
        )}
      </div>
    </div>
  );
}

export default async function CompareDominosPage({
  searchParams,
}: {
  searchParams: Promise<{ people?: string; budget?: string; dietary?: string; restriction?: string | string[] }>;
}) {
  const params = await searchParams;
  const people = Math.max(1, Number(params.people) || 18);
  const budget = Math.max(1, Number(params.budget) || 120);
  const rawRestrictions = Array.isArray(params.restriction)
    ? params.restriction
    : params.restriction
      ? [params.restriction]
      : [];
  const dietaryRestrictions = rawRestrictions.filter((value): value is Restriction =>
    ALL_RESTRICTIONS.includes(value as Restriction)
  );
  const hasLegacyUnknownDietaryGroup = params.dietary === "true" && dietaryRestrictions.length === 0;

  const snapshots = await Promise.all(STORE_IDS.map((id) => getDominosStoreSnapshot(id)));
  const results = compareDominosStores(snapshots, {
    people,
    budget,
    dietaryRestrictions,
    hasDietaryGroups: hasLegacyUnknownDietaryGroup,
  });
  const tradeoff = describeDominosTradeoff(results);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header>
        <p className="text-xs font-semibold tracking-widest text-accent uppercase">GatherBite debug view</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Compare Nearby Domino&apos;s</h1>
        <p className="mt-1.5 text-sm text-muted">
          Live adapter diagnostics. The core GatherBite experience evaluates these stores from the main page.
        </p>
        <Link href="/" className="mt-1 inline-block text-sm text-accent hover:underline">
          ← Back to GatherBite
        </Link>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Group Requirements</h2>
        <form className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">People</span>
              <input
                type="number"
                name="people"
                min={1}
                max={200}
                defaultValue={people}
                className="rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Budget ($ CAD)</span>
              <input
                type="number"
                name="budget"
                min={1}
                defaultValue={budget}
                className="rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-accent"
              />
            </label>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Dietary restrictions</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_RESTRICTIONS.map((restriction) => (
                <label key={restriction} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
                  <input
                    type="checkbox"
                    name="restriction"
                    value={restriction}
                    defaultChecked={dietaryRestrictions.includes(restriction)}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  <span>{RESTRICTION_LABELS[restriction]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-[#c04a1a]"
            >
              Update
            </button>
          </div>
        </form>
      </section>

      {hasLegacyUnknownDietaryGroup && (
        <div className="rounded-lg border border-border bg-surface px-3.5 py-3 text-sm text-muted">
          This legacy URL says a dietary group exists but does not identify its restrictions. Results remain
          <span className="font-medium text-foreground"> Insufficient Dietary Data</span> rather than guessing.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {snapshots.map((snapshot, i) => (
          <StoreCard key={snapshot.storeId} snapshot={snapshot} result={results[i]} />
        ))}
      </div>

      {tradeoff.kind === "real-tradeoff" && (
        <div className="rounded-lg border border-accent bg-accent-soft px-3.5 py-3 text-sm text-accent">
          <p className="font-semibold">Both stores are fully viable — a real tradeoff, not a forced winner:</p>
          <p className="mt-1.5">Save ${tradeoff.savingsCad.toFixed(2)} with Store {tradeoff.cheaperStoreId}</p>
          <p>vs.</p>
          <p>Save ~{tradeoff.savingsMinutes} min with Store {tradeoff.fasterStoreId}</p>
        </div>
      )}
      {tradeoff.kind === "same-price-faster" && (
        <div className="rounded-lg border border-accent bg-accent-soft px-3.5 py-3 text-sm text-accent">
          Same estimated price — Store {tradeoff.fasterStoreId} is ~{tradeoff.savingsMinutes} min faster than Store{" "}
          {tradeoff.slowerStoreId}.
        </div>
      )}
      {tradeoff.kind === "no-tradeoff" && (
        <div className="rounded-lg border border-success bg-success-soft px-3.5 py-3 text-sm text-success">
          Store {tradeoff.winnerStoreId} is fully viable and isn&apos;t more expensive or slower than the other
          option — no real tradeoff to weigh here.
        </div>
      )}
    </div>
  );
}
