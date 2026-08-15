import {
  ToolLoopAgent,
  stepCountIs,
  tool,
  type LanguageModel,
} from "ai";
import { z } from "zod";

import { PLANNER_MODEL } from "../groq";
import {
  DominosCandidateSchema,
  type CandidateJourney,
  type DominosCandidate,
  type GatherBiteInput,
  type VerificationOutcome,
} from "../gatherbite/contracts";
import type { EventSink } from "../gatherbite/events";
import {
  candidateMatchesObservation,
  shouldStopDominosLoop,
  verifyObservedDominosCandidate,
  type DominosAgentLoopState,
} from "../gatherbite/agentLoop";
import type { TimingEntry } from "../gatherbite/timing";
import type { DominosStoreSnapshot } from "../restaurants/dominos";
import type { DominosCatalog } from "../restaurants/dominosCatalog";
import type { DominosServiceabilityResult } from "../restaurants/dominosServiceability";
import { runDominosVerifier } from "./dominosVerifier";

export interface DominosObservationContext {
  snapshots: readonly DominosStoreSnapshot[];
  catalogs: ReadonlyMap<string, DominosCatalog>;
  serviceability: DominosServiceabilityResult;
  observedAt: string;
}

export interface PlannerDependencies {
  model: LanguageModel;
  observationPromise: Promise<DominosObservationContext>;
  verifyCandidate: typeof runDominosVerifier;
  onEvent?: EventSink;
  onTiming?: (entry: TimingEntry) => void;
}

export interface PlannerRunResult {
  journeys: CandidateJourney[];
  verificationAttempts: number;
  terminal: boolean;
}

interface PlannerLoopState extends DominosAgentLoopState {
  journeysByAttempt: Array<CandidateJourney | undefined>;
  seenCandidateVersions: Set<string>;
  initialCandidates: number;
  adaptationUsed: boolean;
}

const PLANNER_ERROR = "GatherBite could not complete planning.";
const CANDIDATE_ERROR = "This candidate was not eligible for verification.";

function elapsed(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function candidateKey(candidate: DominosCandidate): string {
  return `${candidate.candidateId}:${candidate.candidateVersion}:${candidate.snapshotVersion}`;
}

function verifierError(): VerificationOutcome {
  return { status: "VERIFIER_ERROR", reason: CANDIDATE_ERROR, evidence: null };
}

export function serializeDominosObservationForPlanner(observation: DominosObservationContext) {
  return {
    observedAt: observation.observedAt,
    serviceability: observation.serviceability,
    stores: observation.snapshots.map((snapshot) => ({
      provider: snapshot.provider,
      storeId: snapshot.storeId,
      address: snapshot.address,
      isOpen: snapshot.isOpen,
      isOnlineNow: snapshot.isOnlineNow,
      deliveryAvailable: snapshot.deliveryAvailable,
      carryoutAvailable: snapshot.carryoutAvailable,
      deliveryWaitMinutes: snapshot.deliveryWaitMinutes,
      carryoutWaitMinutes: snapshot.carryoutWaitMinutes,
      status: snapshot.status,
      fetchedAt: snapshot.fetchedAt,
      catalog: (() => {
        const catalog = observation.catalogs.get(snapshot.storeId);
        if (!catalog) return null;
        return {
          snapshotVersion: catalog.snapshotVersion,
          products: [...catalog.productsByCode.values()],
          variants: [...catalog.variantsByCode.values()],
          toppings: [...catalog.toppingsByCode.values()],
          deals: [...catalog.dealsByCode.values()],
        };
      })(),
    })),
  };
}

function buildPlannerPrompt(input: GatherBiteInput): string {
  return `Plan a real Domino's order for this GatherBite request.

Attendees: ${input.attendees}
All-in budget: $${input.budgetCad.toFixed(2)} CAD
Service intent: ${input.serviceMethod}
Dietary groups: ${JSON.stringify(input.groups.map(({ id, people, restrictions }) => ({ id, people, restrictions })))}
Soft preferences: ${JSON.stringify(input.pizzaPreferences)}

Call observeDominosOptions before proposing anything. Use only live store, product, variant, deal, and topping identifiers returned by that tool. Send each proposed candidate to verifyCandidate; your prose has no approval authority. You may propose at most two initial version-1 candidates. If and only if verifyCandidate returns a structured REJECT with ADAPT_ORDER, you may submit one adapted candidate with a higher candidateVersion. Never retry from your own prose or assumptions.

Configure dietary-protected pizzas first and name their group ids. Preferences apply only to remaining general pizzas and never replace protected food. Capacity, dietary evidence, budget, serviceability, and availability are hard constraints. Keep expectedPricing null unless an exact candidate-bound quote was returned; displayed menu prices are not an all-in quote. Stop after two verified approvals, a TERMINAL rejection, three verification operations, or when no candidate can be grounded.`;
}

function createConcurrencyLimit(maximum: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function withLimit<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= maximum) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function latestAdaptableJourney(state: PlannerLoopState): CandidateJourney | null {
  for (let index = state.journeysByAttempt.length - 1; index >= 0; index -= 1) {
    const journey = state.journeysByAttempt[index];
    if (journey?.outcome.status === "DECIDED"
      && journey.outcome.decision.decision === "REJECT"
      && journey.outcome.decision.disposition === "ADAPT_ORDER") {
      return journey;
    }
  }
  return null;
}

function resultFromState(state: PlannerLoopState): PlannerRunResult {
  return {
    journeys: state.journeysByAttempt.filter((journey): journey is CandidateJourney => journey !== undefined),
    verificationAttempts: state.verificationAttempts,
    terminal: state.terminal,
  };
}

export async function runDominosPlanner(
  input: GatherBiteInput,
  deps: PlannerDependencies,
): Promise<PlannerRunResult> {
  const state: PlannerLoopState = {
    verificationAttempts: 0,
    approvedCandidateIds: new Set(),
    terminal: false,
    journeysByAttempt: [],
    seenCandidateVersions: new Set(),
    initialCandidates: 0,
    adaptationUsed: false,
  };
  const withVerifierLimit = createConcurrencyLimit(2);
  let observation: DominosObservationContext | null = null;
  let observationEventEmitted = false;

  deps.onEvent?.({ type: "stage", stage: "planning", message: "Planning from live Domino's options." });

  const observeDominosOptions = tool({
    description: "Observe the request-scoped live Domino's stores, menus, variants, toppings, deals, availability, waits, and serviceability. Call before proposing candidates.",
    inputSchema: z.object({}).strict(),
    execute: async () => {
      if (!observationEventEmitted) {
        observationEventEmitted = true;
        deps.onEvent?.({ type: "stage", stage: "observing", message: "Checking live Domino's options." });
      }
      observation ??= await deps.observationPromise;
      return serializeDominosObservationForPlanner(observation);
    },
  });

  const verifyCandidate = tool({
    description: "Delegate one real candidate to the independent Verification Agent. Only its structured APPROVE or REJECT has decision authority.",
    inputSchema: DominosCandidateSchema,
    execute: async (candidate) => {
      observation ??= await deps.observationPromise;
      const key = candidateKey(candidate);
      if (state.seenCandidateVersions.has(key)
        || shouldStopDominosLoop(state)
        || !candidateMatchesObservation(candidate, observation)) {
        return verifierError();
      }

      let adaptedFromCandidateId: string | null = null;
      if (candidate.candidateVersion === 1) {
        if (state.initialCandidates >= 2) return verifierError();
        state.initialCandidates += 1;
      } else {
        const adaptable = latestAdaptableJourney(state);
        if (!adaptable
          || state.adaptationUsed
          || candidate.candidateId !== adaptable.candidate.candidateId
          || candidate.candidateVersion <= adaptable.candidate.candidateVersion) {
          return verifierError();
        }
        state.adaptationUsed = true;
        adaptedFromCandidateId = adaptable.candidate.candidateId;
      }

      state.seenCandidateVersions.add(key);
      const attemptIndex = state.verificationAttempts;
      state.verificationAttempts += 1;

      if (adaptedFromCandidateId) {
        deps.onEvent?.({ type: "stage", stage: "adapting", message: "Adapting from exact rejection evidence." });
      }
      deps.onEvent?.({
        type: "candidate",
        candidateId: candidate.candidateId,
        summary: `${candidate.pizzas.reduce((sum, pizza) => sum + pizza.quantity, 0)} pizzas at Domino's store ${candidate.storeId}.`,
      });

      return withVerifierLimit(async () => {
        const outcome = await verifyObservedDominosCandidate({
          input,
          candidate,
          observation: observation as DominosObservationContext,
          verifierModel: deps.model,
          verifyCandidate: deps.verifyCandidate,
          onEvent: deps.onEvent,
          onTiming: deps.onTiming,
        });
        state.journeysByAttempt[attemptIndex] = { candidate, outcome, adaptedFromCandidateId };

        if (outcome.status === "DECIDED") {
          if (outcome.decision.decision === "APPROVE") {
            state.approvedCandidateIds.add(outcome.decision.candidateId);
          } else if (outcome.decision.disposition === "TERMINAL") {
            state.terminal = true;
          }
        }
        return outcome;
      });
    },
  });

  const plannerStartedAt = performance.now();
  try {
    const agent = new ToolLoopAgent({
      model: deps.model ?? PLANNER_MODEL,
      instructions: `You are GatherBite's Planner Agent. You propose candidates but cannot approve your own work. Only the independent verifyCandidate tool can issue APPROVE or REJECT. Never calculate, infer, or assert dietary safety, capacity, all-in budget correctness, availability, or serviceability yourself. Never treat free text as a verdict. Use real identifiers from observeDominosOptions, protect dietary pizzas before general preference pizzas, and follow the bounded candidate and adaptation rules in the request.`,
      tools: { observeDominosOptions, verifyCandidate },
      temperature: 0,
      maxRetries: 1,
      maxOutputTokens: 900,
      stopWhen: [stepCountIs(12), () => shouldStopDominosLoop(state)],
    });

    await agent.generate({ prompt: buildPlannerPrompt(input) });
  } catch {
    state.terminal = true;
    deps.onEvent?.({ type: "error", message: PLANNER_ERROR });
  } finally {
    deps.onTiming?.({
      name: "planner",
      durationMs: elapsed(plannerStartedAt),
      description: "Planner",
    });
  }

  return resultFromState(state);
}
