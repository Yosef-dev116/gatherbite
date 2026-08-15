import type { CartPreparationResult, CartPreparationStatus } from "@/lib/cart/contracts";

/**
 * Deliberately duplicated here rather than imported from
 * `@/lib/cart/prepareCart` (server code — Groq client, live Domino's
 * fetchers) so this client component never pulls server-only dependencies
 * into the browser bundle. The shape must stay in sync with
 * `CartEventSink`'s event parameter in `src/lib/cart/prepareCart.ts`.
 */
export interface CartEvent {
  type: "cart-stage" | "cart-blocked" | "cart-complete";
  message: string;
}

export type CartPreparationUiState =
  | { phase: "loading"; events: CartEvent[] }
  | { phase: "done"; events: CartEvent[]; result: CartPreparationResult }
  | { phase: "error"; message: string };

const OFFICIAL_ORDER_URL = "https://www.dominos.ca/en/pages/order/?route=1";

type Tone = "success" | "warning" | "danger" | "neutral";

const STATUS_META: Record<CartPreparationStatus, { headline: string; tone: Tone }> = {
  PREPARED_AND_VERIFIED: {
    headline: "Your official Domino's cart is ready and independently verified.",
    tone: "success",
  },
  PREPARED_AND_OBSERVED: {
    headline: "A cart was observed but could not be independently verified.",
    tone: "warning",
  },
  NEEDS_HUMAN_CAPTCHA: {
    headline: "Domino's asked for a CAPTCHA check — GatherBite never automates that.",
    tone: "warning",
  },
  NEEDS_HUMAN_LOGIN: {
    headline: "Domino's asked you to sign in — GatherBite never automates login.",
    tone: "warning",
  },
  CART_MISMATCH: {
    headline: "The prepared cart did not match your approved selection.",
    tone: "danger",
  },
  SESSION_NOT_TRANSFERABLE: {
    headline: "A matching cart was built, but the session could not be handed off to you.",
    tone: "warning",
  },
  AUTOMATION_UNAVAILABLE: {
    headline: "Automated cart preparation is unavailable right now.",
    tone: "warning",
  },
  TIMED_OUT: {
    headline: "Cart preparation took too long and stopped safely.",
    tone: "warning",
  },
  FALLBACK_READY: {
    headline: "GatherBite could not automate this cart — use your order guide instead.",
    tone: "neutral",
  },
};

const TONE_CLASSES: Record<Tone, string> = {
  success: "border-success/35 bg-success-soft",
  warning: "border-accent/35 bg-accent-soft",
  danger: "border-danger/35 bg-danger-soft",
  neutral: "border-border bg-background",
};

function StageList({ events }: { events: CartEvent[] }) {
  const stages = events.filter((event): event is CartEvent & { type: "cart-stage" } => event.type === "cart-stage");
  if (stages.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1 text-xs text-muted" aria-label="Cart preparation stages">
      {stages.map((event, index) => (
        <li key={`${index}-${event.message}`}>{event.message}</li>
      ))}
    </ol>
  );
}

export function CartPreparation({ state }: { state: CartPreparationUiState }) {
  if (state.phase === "loading") {
    return (
      <section className="rounded-xl border border-border bg-background p-4" aria-live="polite" aria-busy="true">
        <div className="flex items-center gap-2">
          <span className="working-dot" aria-hidden="true" />
          <p className="text-sm font-semibold">Preparing your official Domino&apos;s cart…</p>
        </div>
        <div className="mt-2">
          <StageList events={state.events} />
        </div>
      </section>
    );
  }

  if (state.phase === "error") {
    return (
      <section role="alert" className="rounded-xl border border-danger/35 bg-danger-soft p-4 text-sm">
        <p className="font-semibold text-danger">Cart preparation could not be completed.</p>
        <p className="mt-1 text-danger">{state.message}</p>
        <p className="mt-3 text-foreground">
          You can still order directly from Domino&apos;s yourself:{" "}
          <a
            className="font-semibold underline"
            href={OFFICIAL_ORDER_URL}
            target="_blank"
            rel="noreferrer"
          >
            dominos.ca
          </a>
        </p>
      </section>
    );
  }

  const { result, events } = state;
  const meta = STATUS_META[result.status];
  const succeeded = result.status === "PREPARED_AND_VERIFIED";

  return (
    <section className={`rounded-xl border p-4 ${TONE_CLASSES[meta.tone]}`} aria-live="polite">
      <StageList events={events} />
      <p className="mt-2 font-semibold">{meta.headline}</p>
      {result.reason && <p className="mt-1 text-sm text-muted">{result.reason}</p>}

      {result.status === "CART_MISMATCH" && result.comparison && result.comparison.mismatches.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {result.comparison.mismatches.map((mismatch, index) => (
            <li key={`${mismatch.field}-${index}`}>{mismatch.message}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {succeeded && result.handoffUrl && (
          <a className="primary-action text-center" href={result.handoffUrl} target="_blank" rel="noreferrer">
            Continue to Domino&apos;s checkout.
          </a>
        )}
        {!succeeded && (
          <a
            className="primary-action text-center"
            href={result.fallback.officialUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Domino&apos;s with my order guide.
          </a>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Review the official cart and complete payment yourself.
      </p>

      {!succeeded && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Order guide details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-muted">
            {result.fallback.completeCopyText}
          </pre>
        </details>
      )}
    </section>
  );
}
