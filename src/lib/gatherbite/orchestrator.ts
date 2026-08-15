import type { LanguageModel } from "ai";

import {
  runDominosPlanner,
  type DominosObservationContext,
  type PlannerDependencies,
  type PlannerRunResult,
} from "../agents/dominosPlanner";
import { runDominosVerifier } from "../agents/dominosVerifier";
import { PLANNER_MODEL } from "../groq";
import type { DominosStoreSnapshot, DominosTimingEvent } from "../restaurants/dominos";
import {
  buildDominosCatalog,
  observeSupportedDominosStores,
  type DominosCatalog,
} from "../restaurants/dominosCatalog";
import {
  checkDominosServiceability,
  type DominosServiceabilityResult,
} from "../restaurants/dominosServiceability";
import type {
  DeliveryAddress,
  GatherBiteEvaluation,
  GatherBiteInput,
} from "./contracts";
import { createEventCollector, publicEvaluationError, type EventSink } from "./events";
import { normalizeDominosEvaluation } from "./normalize";
import type { DominosOptionPresentationSource } from "./ranking";
import { isTransientGatherBiteError, withOneTransientRetry } from "./retry";
import type { TimingEntry } from "./timing";

const SUPPORTED_STORE_IDS = ["10950", "10953"] as const;
const DEFAULT_DEADLINE_MS = 15_000;

export interface GatherBiteDependencies {
  supportedStoreIds: readonly string[];
  observeStores: typeof observeSupportedDominosStores;
  checkServiceability: (
    address: DeliveryAddress | undefined,
    method: GatherBiteInput["serviceMethod"],
    options: { signal: AbortSignal },
  ) => Promise<DominosServiceabilityResult>;
  runPlanner: typeof runDominosPlanner;
  plannerModel: LanguageModel;
  verifyCandidate: PlannerDependencies["verifyCandidate"];
  now: () => number;
  deadlineMs: number;
  onTiming?: (entry: TimingEntry) => void;
}
class ImmutableCatalogMap implements ReadonlyMap<string, DominosCatalog> {
  readonly #values: Map<string, DominosCatalog>;
  constructor(entries: Iterable<readonly [string, DominosCatalog]>) { this.#values = new Map(entries); }
  get size(): number { return this.#values.size; }
  get(key: string): DominosCatalog | undefined { return this.#values.get(key); }
  has(key: string): boolean { return this.#values.has(key); }
  entries(): MapIterator<[string, DominosCatalog]> { return this.#values.entries(); }
  keys(): MapIterator<string> { return this.#values.keys(); }
  values(): MapIterator<DominosCatalog> { return this.#values.values(); }
  forEach(callbackfn: (value: DominosCatalog, key: string, map: ReadonlyMap<string, DominosCatalog>) => void, thisArg?: unknown): void {
    this.#values.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
  [Symbol.iterator](): MapIterator<[string, DominosCatalog]> { return this.#values[Symbol.iterator](); }
  get [Symbol.toStringTag](): string { return "ImmutableCatalogMap"; }
  set(): never { throw new Error("The request-scoped catalog map is read-only and immutable."); }
  delete(): never { throw new Error("The request-scoped catalog map is read-only and immutable."); }
  clear(): never { throw new Error("The request-scoped catalog map is read-only and immutable."); }
}

function elapsed(now: () => number, startedAt: number): number {
  const value = now() - startedAt;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function isoNow(now: () => number): string {
  const value = now();
  return Number.isFinite(value) ? new Date(value).toISOString() : new Date().toISOString();
}

function timed<T>(
  name: TimingEntry["name"],
  description: string,
  operation: () => Promise<T>,
  deps: GatherBiteDependencies,
): Promise<T> {
  const startedAt = deps.now();
  return operation().finally(() => {
    deps.onTiming?.({ name, durationMs: elapsed(deps.now, startedAt), description });
  });
}

function emptyPlannerResult(): PlannerRunResult {
  return { journeys: [], verificationAttempts: 0, terminal: true };
}

function immutableSnapshot(snapshot: DominosStoreSnapshot): DominosStoreSnapshot {
  const products = snapshot.products.map((product) => Object.freeze({
    ...product,
    toppings: product.toppings === null ? null : Object.freeze([...product.toppings]) as unknown as string[],
    defaultToppingCodes: Object.freeze([...product.defaultToppingCodes]),
    variantCodes: Object.freeze([...product.variantCodes]),
  }));
  return Object.freeze({
    ...snapshot,
    deliveryWaitMinutes: snapshot.deliveryWaitMinutes ? Object.freeze({ ...snapshot.deliveryWaitMinutes }) : null,
    carryoutWaitMinutes: snapshot.carryoutWaitMinutes ? Object.freeze({ ...snapshot.carryoutWaitMinutes }) : null,
    deals: Object.freeze(snapshot.deals.map((deal) => Object.freeze({ ...deal }))) as unknown as DominosStoreSnapshot["deals"],
    products: Object.freeze(products) as unknown as DominosStoreSnapshot["products"],
    variants: snapshot.variants
      ? Object.freeze(snapshot.variants.map((variant) => Object.freeze({ ...variant }))) as unknown as NonNullable<DominosStoreSnapshot["variants"]>
      : undefined,
    toppingOptions: snapshot.toppingOptions
      ? Object.freeze(snapshot.toppingOptions.map((topping) => Object.freeze({ ...topping }))) as unknown as NonNullable<DominosStoreSnapshot["toppingOptions"]>
      : undefined,
    errors: Object.freeze([...snapshot.errors]) as unknown as string[],
  });
}

function createObservationPromise(
  input: GatherBiteInput,
  deps: GatherBiteDependencies,
  signal: AbortSignal,
): Promise<DominosObservationContext> {
  const onStoreTiming = (event: DominosTimingEvent) => {
    deps.onTiming?.({
      name: `dom_${event.storeId}_${event.stage}`,
      durationMs: event.durationMs,
      description: "Domino's live data",
    });
  };
  const storesPromise = timed(
    "dominos",
    "Domino's live data",
    () => withOneTransientRetry(
      () => deps.observeStores(deps.supportedStoreIds, onStoreTiming, signal),
      isTransientGatherBiteError,
    ),
    deps,
  );
  const serviceabilityPromise = withOneTransientRetry(
    () => deps.checkServiceability(input.deliveryAddress, input.serviceMethod, { signal }),
    isTransientGatherBiteError,
  );

  return Promise.all([storesPromise, serviceabilityPromise]).then(([snapshots, serviceability]) => {
    const immutableSnapshots = snapshots.map(immutableSnapshot);
    const catalogs = new ImmutableCatalogMap(
      immutableSnapshots.map((snapshot) => [snapshot.storeId, buildDominosCatalog(snapshot)] as const),
    );
    return Object.freeze({
      snapshots: Object.freeze(immutableSnapshots),
      catalogs,
      serviceability: Object.freeze({ ...serviceability, storeIds: Object.freeze([...serviceability.storeIds]) }),
      observedAt: isoNow(deps.now),
    }) as DominosObservationContext;
  });
}

export function createDefaultGatherBiteDependencies(
  onTiming?: (entry: TimingEntry) => void,
): GatherBiteDependencies {
  return {
    supportedStoreIds: SUPPORTED_STORE_IDS,
    observeStores: observeSupportedDominosStores,
    checkServiceability: (address, method, { signal }) => checkDominosServiceability(address, method, {
      signal,
      lookup: async () => {
        throw new Error("An official address lookup is not available in this runtime.");
      },
    }),
    runPlanner: runDominosPlanner,
    plannerModel: PLANNER_MODEL,
    verifyCandidate: runDominosVerifier,
    now: Date.now,
    deadlineMs: DEFAULT_DEADLINE_MS,
    onTiming,
  };
}

/** One Domino's-first request scope: live observation -> Planner -> independent Verifier -> ranking. */
export async function evaluateGatherBite(
  input: GatherBiteInput,
  deps: GatherBiteDependencies,
  onEvent?: EventSink,
  externalSignal?: AbortSignal,
): Promise<GatherBiteEvaluation> {
  const totalStartedAt = deps.now();
  const events = createEventCollector();
  const emit: EventSink = (event) => {
    events.emit(event);
    onEvent?.(event);
  };
  emit({ type: "stage", stage: "observing", message: "Checking live Domino's options." });

  const controller = new AbortController();
  let rejectCancellation!: (reason: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const requestCancellationError = Object.assign(
    new Error("GatherBite evaluation was cancelled."),
    { name: "AbortError" },
  );
  let requestCancelled = false;
  const abortForRequest = () => {
    requestCancelled = true;
    rejectCancellation(requestCancellationError);
    if (!controller.signal.aborted) controller.abort(requestCancellationError);
  };
  if (externalSignal?.aborted) abortForRequest();
  else externalSignal?.addEventListener("abort", abortForRequest, { once: true });
  const timeout = setTimeout(() => {
    const error = Object.assign(new Error("GatherBite evaluation deadline exceeded."), { name: "AbortError" });
    rejectCancellation(error);
    if (!controller.signal.aborted) controller.abort(error);
  }, deps.deadlineMs);

  const observationStartedAt = deps.now();
  let resolvedPresentationSources: ReadonlyMap<string, DominosOptionPresentationSource> = new Map();
  const observationPromise = createObservationPromise(input, deps, controller.signal)
    .then((observation) => {
      resolvedPresentationSources = new Map(
        observation.snapshots.flatMap((snapshot) => {
          const catalog = observation.catalogs.get(snapshot.storeId);
          return catalog
            ? [[snapshot.storeId, { storeAddress: snapshot.address, catalog }] as const]
            : [];
        }),
      );
      return observation;
    })
    .finally(() => deps.onTiming?.({ name: "observation", durationMs: elapsed(deps.now, observationStartedAt), description: "Live observation" }));
  void observationPromise.catch(() => undefined);

  let planner = emptyPlannerResult();
  try {
    const plannerPromise = deps.runPlanner(input, {
      model: deps.plannerModel,
      observationPromise,
      verifyCandidate: deps.verifyCandidate,
      onEvent: emit,
      onTiming: deps.onTiming,
      abortSignal: controller.signal,
    });
    void plannerPromise.catch(() => undefined);
    planner = await Promise.race([plannerPromise, cancellation]);
    if (requestCancelled) throw requestCancellationError;
  } catch (error) {
    if (!controller.signal.aborted) controller.abort();
    if (requestCancelled) throw requestCancellationError;
    emit(publicEvaluationError(error));
  } finally {
    if (!controller.signal.aborted) controller.abort();
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortForRequest);
  }

  emit({ type: "stage", stage: "comparing", message: "Comparing verified Domino's options." });
  const rankingStartedAt = deps.now();
  const result = normalizeDominosEvaluation(
    planner.journeys,
    input.pizzaPreferences,
    events.events(),
    resolvedPresentationSources,
  );
  deps.onTiming?.({ name: "ranking", durationMs: elapsed(deps.now, rankingStartedAt), description: "Option ranking" });
  deps.onTiming?.({ name: "total", durationMs: elapsed(deps.now, totalStartedAt), description: "GatherBite evaluation" });
  onEvent?.({ type: "complete", result });
  return result;
}
