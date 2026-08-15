import { verifyObservedDominosCandidate } from "../gatherbite/agentLoop";
import type { DominosObservationContext } from "../agents/dominosPlanner";
import { runDominosVerifier } from "../agents/dominosVerifier";
import {
  DominosCandidateSchema,
  type CandidatePizza,
  type DominosCandidate,
  type GatherBiteInput,
} from "../gatherbite/contracts";
import { SUPPORTED_STORE_IDS } from "../gatherbite/orchestrator";
import { isTransientGatherBiteError, withOneTransientRetry } from "../gatherbite/retry";
import { VERIFIER_MODEL } from "../groq";
import {
  buildDominosCatalog,
  observeSupportedDominosStores,
} from "../restaurants/dominosCatalog";
import { checkDominosServiceability } from "../restaurants/dominosServiceability";
import { compareDominosCart } from "./dominosCartComparator";
import { createDominosCartExecutor } from "./dominosCartExecutor";
import { buildGuidedHandoff } from "./dominosCartFallback";
import type {
  ActualDominosCart,
  CartPreparationResult,
  CartPreparationStatus,
  DominosCartExecutor,
} from "./contracts";

/**
 * Thrown when `candidateInput` fails `DominosCandidateSchema` validation.
 * There is no valid candidate to build a `GuidedOrderHandoff` fallback from
 * in this case, so this is the one path out of `prepareSelectedDominosCart`
 * that rejects instead of resolving with a `CartPreparationResult` — the
 * caller (the route) is expected to translate this into a 400 response, the
 * same way the existing GatherBite routes reject invalid request bodies.
 */
export class InvalidCartCandidateError extends Error {
  constructor() {
    super("The selected order could not be validated.");
    this.name = "InvalidCartCandidateError";
  }
}

export interface PrepareCartDependencies {
  refreshObservation: (input: GatherBiteInput) => Promise<DominosObservationContext>;
  verifyCandidate: typeof runDominosVerifier;
  executor: DominosCartExecutor;
  compareCart: typeof compareDominosCart;
  verifyActualCart: typeof runDominosVerifier;
}

export type CartEventSink = (event: {
  type: "cart-stage" | "cart-blocked" | "cart-complete";
  message: string;
}) => void;

/**
 * Converts an actually observed cart into a fresh, verifiable
 * `DominosCandidate` — but only once every field the comparator does not
 * already cover has live evidence behind it. `compareDominosCart` already
 * proved every field it checks (store, method, coupons, pricing, and every
 * per-line product/variant/quantity/size/crust/sauce/cheese/topping) equals
 * the expected candidate's; the one field it never checks is
 * `trustedSlicesPerPizza`, so that is re-derived here from the *refreshed*
 * catalog's live variant data rather than copied from the expected
 * candidate. `lineId`/`purpose`/`protectsGroupIds` are organizer-supplied
 * dietary classification, not observed evidence, and nothing else could
 * supply them, so they are carried over from the corresponding expected
 * line. Returns null (a mismatch, never a guess) when the observed store,
 * method, item count, any required per-line field, or live trusted-slice
 * evidence for an observed variant is missing.
 */
function buildObservedCandidate(
  expected: DominosCandidate,
  actual: ActualDominosCart,
  observation: DominosObservationContext,
): DominosCandidate | null {
  if (actual.storeId === null || actual.serviceMethod === null) return null;

  const catalog = observation.catalogs.get(actual.storeId);
  const snapshot = observation.snapshots.find((entry) => entry.storeId === actual.storeId);
  if (!catalog || !snapshot) return null;

  if (actual.items.length !== expected.pizzas.length) return null;

  const pizzas: CandidatePizza[] = [];
  for (let index = 0; index < actual.items.length; index += 1) {
    const item = actual.items[index]!;
    const expectedLine = expected.pizzas[index]!;
    if (!item.productCode || !item.variantCode || !item.sizeCode || !item.crustCode) return null;

    const variant = catalog.variantsByCode.get(item.variantCode);
    if (!variant || variant.trustedSlices === null) return null;

    pizzas.push({
      lineId: expectedLine.lineId,
      quantity: item.quantity,
      productCode: item.productCode,
      variantCode: item.variantCode,
      sizeCode: item.sizeCode,
      crustCode: item.crustCode,
      sauceCode: item.sauceCode,
      cheeseCode: item.cheeseCode,
      toppings: item.toppings.map((topping) => ({ code: topping.code, quantity: topping.quantity })),
      purpose: expectedLine.purpose,
      protectsGroupIds: expectedLine.protectsGroupIds,
      trustedSlicesPerPizza: variant.trustedSlices,
    });
  }

  const observedCandidate: DominosCandidate = {
    candidateId: expected.candidateId,
    candidateVersion: expected.candidateVersion + 1,
    snapshotVersion: `${snapshot.storeId}:${snapshot.fetchedAt}`,
    storeId: actual.storeId,
    serviceMethod: actual.serviceMethod,
    dealCodes: actual.couponCodes,
    pizzas,
    expectedPricing: {
      subtotalCad: actual.subtotalCad,
      taxCad: actual.taxCad,
      feesCad: actual.feesCad,
      totalCad: actual.totalCad,
    },
  };

  return DominosCandidateSchema.safeParse(observedCandidate).success ? observedCandidate : null;
}

/**
 * Re-verifies an untrusted, client-returned candidate against fresh live
 * evidence, executes only after a fresh independent APPROVE, strictly
 * compares the actual official cart the executor observed, and — only on a
 * zero-mismatch comparison — runs a second, independent Verifier pass over
 * the actually observed cart. `PREPARED_AND_VERIFIED` is reachable only when
 * both passes return APPROVE; every other path exits with a non-success
 * status and the exact guided-handoff fallback so the organizer always has a
 * safe way forward. `candidateInput` is never trusted: it is parsed fresh,
 * every fact it claims is re-checked against live data, and no verdict is
 * ever read from it or accepted alongside it.
 */
export async function prepareSelectedDominosCart(
  candidateInput: unknown,
  input: GatherBiteInput,
  deps: PrepareCartDependencies,
  onEvent?: CartEventSink,
): Promise<CartPreparationResult> {
  const emit = (type: "cart-stage" | "cart-blocked" | "cart-complete", message: string): void => {
    onEvent?.({ type, message });
  };

  const parsedCandidate = DominosCandidateSchema.safeParse(candidateInput);
  if (!parsedCandidate.success) {
    emit("cart-blocked", "The selected order could not be validated.");
    throw new InvalidCartCandidateError();
  }
  // `expectedCandidate` is untrusted client input past schema shape checks
  // only. Every fact it claims — quantity, topping, store, method, price —
  // must be re-verified against fresh live evidence below before anything
  // is executed; nothing here is treated as already approved.
  const expectedCandidate: DominosCandidate = parsedCandidate.data;
  const fallback = buildGuidedHandoff(expectedCandidate);

  function blocked(
    status: Exclude<CartPreparationStatus, "PREPARED_AND_VERIFIED">,
    reason: string,
    extra: Partial<Pick<CartPreparationResult, "actualCart" | "comparison" | "handoffUrl">> = {},
  ): CartPreparationResult {
    emit("cart-blocked", reason);
    return {
      status,
      actualCart: extra.actualCart ?? null,
      comparison: extra.comparison ?? null,
      handoffUrl: extra.handoffUrl ?? null,
      fallback,
      reason,
    };
  }

  emit("cart-stage", "Checking your selection against live Domino's data.");
  let preObservation: DominosObservationContext;
  try {
    preObservation = await deps.refreshObservation(input);
  } catch {
    return blocked("AUTOMATION_UNAVAILABLE", "Live Domino's data could not be refreshed for this selection.");
  }

  emit("cart-stage", "Independent verification is checking your selection.");
  const preVerify = await verifyObservedDominosCandidate({
    input,
    candidate: expectedCandidate,
    observation: preObservation,
    verifierModel: VERIFIER_MODEL,
    verifyCandidate: deps.verifyCandidate,
  });

  if (preVerify.status !== "DECIDED" || preVerify.decision.decision !== "APPROVE") {
    const reason = preVerify.status === "DECIDED"
      ? (preVerify.decision.reasons[0] ?? "The selection could not be independently approved.")
      : preVerify.reason;
    return blocked("FALLBACK_READY", reason);
  }

  emit("cart-stage", "Building the official Domino's cart.");
  const executionResult = await deps.executor.prepare({ candidate: expectedCandidate, organizerInput: input });

  if (executionResult.status !== "PREPARED_AND_OBSERVED" || !executionResult.actualCart) {
    emit("cart-blocked", executionResult.reason ?? "The official cart could not be prepared.");
    return executionResult;
  }

  emit("cart-stage", "Comparing the prepared cart against your approved selection.");
  const actualCart = executionResult.actualCart;
  const comparison = deps.compareCart(expectedCandidate, actualCart);
  if (!comparison.matches) {
    return blocked(
      "CART_MISMATCH",
      "The prepared cart did not match your approved selection.",
      { actualCart, comparison },
    );
  }

  emit("cart-stage", "Re-checking live data before final verification.");
  let postObservation: DominosObservationContext;
  try {
    postObservation = await deps.refreshObservation(input);
  } catch {
    return blocked(
      "AUTOMATION_UNAVAILABLE",
      "Live Domino's data could not be refreshed after preparing the cart.",
      { actualCart, comparison },
    );
  }

  const observedCandidate = buildObservedCandidate(expectedCandidate, actualCart, postObservation);
  if (!observedCandidate) {
    return blocked(
      "CART_MISMATCH",
      "The prepared cart is missing evidence GatherBite needs to verify it safely.",
      { actualCart, comparison },
    );
  }

  emit("cart-stage", "Independent verification is checking the prepared cart.");
  const postVerify = await verifyObservedDominosCandidate({
    input,
    candidate: observedCandidate,
    observation: postObservation,
    verifierModel: VERIFIER_MODEL,
    verifyCandidate: deps.verifyActualCart,
  });

  if (postVerify.status !== "DECIDED" || postVerify.decision.decision !== "APPROVE") {
    const reason = postVerify.status === "DECIDED"
      ? (postVerify.decision.reasons[0] ?? "The prepared cart could not be independently approved.")
      : postVerify.reason;
    return blocked("FALLBACK_READY", reason, { actualCart, comparison });
  }

  emit("cart-complete", "The official cart was prepared and independently verified.");
  return {
    status: "PREPARED_AND_VERIFIED",
    actualCart,
    comparison,
    handoffUrl: executionResult.handoffUrl,
    fallback,
    reason: null,
  };
}

/**
 * Refreshes live Domino's observation data using the same already-exported
 * building blocks `orchestrator.ts` uses for its own request-scoped
 * observation (`observeSupportedDominosStores`, `buildDominosCatalog`,
 * `checkDominosServiceability`, and the shared one-retry transient-error
 * policy) — without importing or modifying `orchestrator.ts`'s internal
 * observation logic. Deep-freezing is intentionally skipped: this
 * observation is built fresh and consumed once per cart-preparation call.
 */
async function refreshDominosObservation(
  input: GatherBiteInput,
  supportedStoreIds: readonly string[],
  signal?: AbortSignal,
): Promise<DominosObservationContext> {
  const [snapshots, serviceability] = await Promise.all([
    withOneTransientRetry(
      () => observeSupportedDominosStores(supportedStoreIds, undefined, signal),
      isTransientGatherBiteError,
    ),
    withOneTransientRetry(
      () => checkDominosServiceability(input.deliveryAddress, input.serviceMethod, {
        signal,
        lookup: async () => {
          throw new Error("An official address lookup is not available in this runtime.");
        },
      }),
      isTransientGatherBiteError,
    ),
  ]);

  const catalogs = new Map(snapshots.map((snapshot) => [snapshot.storeId, buildDominosCatalog(snapshot)] as const));

  return {
    snapshots,
    catalogs,
    serviceability,
    observedAt: new Date().toISOString(),
  };
}

/** Injects `signal` into every call to a `typeof runDominosVerifier` function, regardless of what its caller supplied. */
function withAbortSignal(
  fn: typeof runDominosVerifier,
  signal: AbortSignal | undefined,
): typeof runDominosVerifier {
  if (!signal) return fn;
  return (verifyInput, verifyDeps) => fn(verifyInput, { ...verifyDeps, abortSignal: signal });
}

/**
 * Production dependency wiring for `prepareSelectedDominosCart`. Uses
 * `guided-handoff` executor mode only — the mode-locking ruling from Task
 * 15 (`.superpowers/sdd/2026-08-14-gatherbite-hackathon-final/progress.md`,
 * "Task 15: Ruling") established that as the only live mode, since no
 * transferable-browser automation was ever proven safe/working. `signal`
 * (the route's request signal) is threaded into live network calls and
 * Verifier model calls so request cancellation aborts downstream work.
 */
export function createDefaultPrepareCartDependencies(signal?: AbortSignal): PrepareCartDependencies {
  return {
    refreshObservation: (input) => refreshDominosObservation(input, SUPPORTED_STORE_IDS, signal),
    verifyCandidate: withAbortSignal(runDominosVerifier, signal),
    executor: createDominosCartExecutor({ mode: "guided-handoff", timeoutMs: 15_000 }),
    compareCart: compareDominosCart,
    verifyActualCart: withAbortSignal(runDominosVerifier, signal),
  };
}
