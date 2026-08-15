import { PIZZA_PREFERENCE_LABELS } from "@/lib/types";
import type { VerifiedDominosOption } from "@/lib/gatherbite/contracts";
import { CheckGrid, formatWait, OrderLines, verifiedTotal } from "./VerifiedOptions";

export type CartIntent = "idle" | "requested";

export function DecisionReview({
  option,
  cartIntent,
  onChange,
  onPrepareCart,
}: {
  option: VerifiedDominosOption;
  cartIntent: CartIntent;
  onChange: () => void;
  onPrepareCart: () => void;
}) {
  const total = verifiedTotal(option);
  const preference = option.evidence.preference;
  return (
    <section id="your-decision" className="form-card decision-review scroll-mt-5" aria-labelledby="decision-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Your decision</p>
          <h2 id="decision-heading" className="mt-1 text-2xl font-semibold tracking-tight">Review the exact verified order</h2>
        </div>
        <span className="verified-pill">Selected · Verified</span>
      </div>

      <div className="rounded-xl bg-accent-soft p-4">
        <p className="font-semibold">Domino&apos;s · Store {option.candidate.storeId}</p>
        <p className="mt-1 whitespace-pre-line text-sm text-muted">
          {option.storeAddress ?? "Address unavailable from the live store observation"}
        </p>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <p><span className="block text-xs text-muted">Method</span><strong className="capitalize">{option.candidate.serviceMethod}</strong></p>
          <p><span className="block text-xs text-muted">Verified total</span><strong>{total === null ? "See budget evidence" : `$${total.toFixed(2)} CAD`}</strong></p>
          <p><span className="block text-xs text-muted">Wait</span><strong>{formatWait(option.relevantWaitMinutes)}</strong></p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Exact configuration</h3>
        <OrderLines pizzas={option.candidate.pizzas} />
      </div>

      <CheckGrid checks={option.evidence.checks} />
      <div className="grid gap-2 rounded-xl border border-border bg-background p-4 text-sm text-muted">
        <p><span className="font-semibold text-foreground">Capacity:</span> {option.evidence.checks.capacity.summary}</p>
        <p><span className="font-semibold text-foreground">Dietary:</span> {option.evidence.checks.dietary.summary}</p>
        <p><span className="font-semibold text-foreground">Budget:</span> {option.evidence.checks.budget.summary}</p>
      </div>

      {preference.requested.length > 0 && (
        <div className="rounded-xl border border-border p-4 text-sm">
          <p className="font-semibold">Preference handling</p>
          <p className="mt-1 text-muted">
            Requested {preference.requested.map((value) => PIZZA_PREFERENCE_LABELS[value]).join(", ")}.
            {preference.represented.length > 0
              ? ` Represented ${preference.represented.map((value) => PIZZA_PREFERENCE_LABELS[value]).join(", ")}.`
              : " No preference was deterministically represented."}
          </p>
          {preference.unmet.map(({ preference: value, reason }) => (
            <p key={value} className="mt-1 text-muted">{PIZZA_PREFERENCE_LABELS[value]}: {reason}</p>
          ))}
        </div>
      )}

      {cartIntent === "requested" && (
        <p role="status" className="rounded-xl border border-accent bg-accent-soft px-4 py-3 text-sm text-accent">
          Cart preparation is the next verified step. No restaurant cart has been created yet.
        </p>
      )}

      <button
        type="button"
        className="primary-action"
        onClick={onPrepareCart}
        disabled={cartIntent === "requested"}
      >
        {cartIntent === "requested" ? "Cart preparation requested" : "Prepare my Domino's cart"}
      </button>
      <p className="text-center text-xs leading-relaxed text-muted">
        You review the official cart and complete payment. GatherBite never submits or pays for an order.
      </p>
      <button type="button" className="self-center text-sm font-semibold text-accent hover:underline" onClick={onChange}>
        Change selected option
      </button>
    </section>
  );
}
