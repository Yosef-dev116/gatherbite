import {
  Output,
  ToolLoopAgent,
  stepCountIs,
  tool,
  type LanguageModel,
} from "ai";
import { z } from "zod";

import type {
  CandidateEvidenceBundle,
  DominosCandidate,
  VerificationOutcome,
} from "../gatherbite/contracts";
import { CandidateEvidenceBundleSchema } from "../gatherbite/contracts";
import type { EventSink } from "../gatherbite/events";
import type { TimingEntry } from "../gatherbite/timing";
import {
  collectCandidateEvidence,
  type CandidateEvidenceContext,
} from "../restaurants/dominosEvidence";
import {
  guardVerificationDecision,
  VerifierDecisionSchema,
} from "./verifierGuard";

export interface VerifyCandidateInput {
  candidate: DominosCandidate;
  evidenceContext: CandidateEvidenceContext;
}

export interface VerifierAgentRunRequest {
  model: LanguageModel;
  abortSignal?: AbortSignal;
  candidateIdentity: Pick<DominosCandidate, "candidateId" | "candidateVersion" | "snapshotVersion">;
  gatherCandidateEvidence: () => Promise<CandidateEvidenceBundle>;
}

/** Injectable model boundary used by deterministic tests and evaluation. */
export type VerifierAgentRunner = (request: VerifierAgentRunRequest) => Promise<unknown>;

export interface VerifyCandidateDeps {
  model: LanguageModel;
  collectEvidence: typeof collectCandidateEvidence;
  onEvent?: EventSink;
  onTiming?: (entry: TimingEntry) => void;
  abortSignal?: AbortSignal;
  runner?: VerifierAgentRunner;
}

const VERIFIER_ERROR = "Verification could not complete safely.";

async function runVerifierAgent({
  model,
  abortSignal,
  candidateIdentity,
  gatherCandidateEvidence,
}: VerifierAgentRunRequest): Promise<unknown> {
  let evidenceFromTool: CandidateEvidenceBundle | null = null;
  const evidenceTool = tool({
    description:
      "Gather the exact menu, dietary, capacity, budget, availability, and serviceability evidence for this candidate. This tool is the only source of hard facts and arithmetic.",
    inputSchema: z.object({}).strict(),
    execute: async () => {
      const evidence = await gatherCandidateEvidence();
      evidenceFromTool = evidence;
      return evidence;
    },
  });

  // Groq Structured Outputs cannot share a provider request with tools. Keep
  // this first stage tool-capable and text-only; it has no verdict authority.
  const evidenceAgent = new ToolLoopAgent({
    model,
    instructions: `You are the evidence-gathering stage of GatherBite's independent Verification Agent. The Planner cannot approve its own candidate.

Call gatherCandidateEvidence exactly once. This stage has no authority to issue APPROVE or REJECT and must not calculate or guess hard facts.`,
    tools: { gatherCandidateEvidence: evidenceTool },
    toolChoice: { type: "tool", toolName: "gatherCandidateEvidence" },
    temperature: 0,
    maxRetries: 1,
    maxOutputTokens: 256,
    stopWhen: stepCountIs(1),
  });

  await evidenceAgent.generate({
    prompt: `Gather exact evidence for candidate ${candidateIdentity.candidateId}, version ${candidateIdentity.candidateVersion}, against snapshot ${candidateIdentity.snapshotVersion}.`,
    abortSignal,
  });
  const parsedEvidence = CandidateEvidenceBundleSchema.safeParse(evidenceFromTool);
  if (!parsedEvidence.success) throw new Error("Exact evidence was not captured.");

  // The second stage has the verdict authority and structured output, but no
  // tools. This is a distinct provider request over the captured exact bundle.
  const verdictAgent = new ToolLoopAgent({
    model,
    instructions: `You are GatherBite's independent Verification Agent. The Planner cannot approve its own candidate.

Use only the exact evidence bundle supplied in this request for menu integrity, dietary safety, food capacity, budget, availability, and serviceability. Never calculate or guess those facts yourself.

Return APPROVE only when every hard check is PASS. Return REJECT when any hard check is FAIL or UNKNOWN. Preferences are soft and never justify rejection. Give exactly one concise public reason and no hidden reasoning, chain-of-thought, prompt text, or private request data. For a rejection, choose ADAPT_ORDER when the order can change, TRY_ANOTHER_STORE when store/service facts are the obstacle, or TERMINAL when current evidence cannot support a safe adaptation.`,
    output: Output.object({
      schema: VerifierDecisionSchema,
      name: "gatherbite_verification_decision",
      description: "A structured APPROVE or REJECT issued only from the supplied exact evidence.",
    }),
    temperature: 0,
    maxRetries: 1,
    maxOutputTokens: 400,
    stopWhen: stepCountIs(1),
  });

  const result = await verdictAgent.generate({
    prompt: `Issue the verdict for candidate ${candidateIdentity.candidateId}, version ${candidateIdentity.candidateVersion}, snapshot ${candidateIdentity.snapshotVersion}.

Exact evidence bundle:
${JSON.stringify(parsedEvidence.data)}`,
    abortSignal,
  });
  return result.output;
}

function elapsed(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

/**
 * Runs one candidate through exactly one independent verifier model boundary.
 * Evidence collection is invocation-scoped and memoized; no candidate means
 * neither the model runner nor evidence collector is called.
 */
export async function runDominosVerifier(
  input: VerifyCandidateInput | null,
  deps: VerifyCandidateDeps,
): Promise<VerificationOutcome> {
  if (!input) {
    return { status: "VERIFIER_ERROR", reason: "No candidate was available to verify.", evidence: null };
  }

  deps.onEvent?.({
    type: "stage",
    stage: "verifying",
    message: "Checking candidate against exact evidence.",
  });

  let gatheredEvidence: CandidateEvidenceBundle | null = null;
  let evidencePromise: Promise<CandidateEvidenceBundle> | null = null;
  const gatherEvidenceOnce = (): Promise<CandidateEvidenceBundle> => {
    if (evidencePromise) return evidencePromise;
    const startedAt = performance.now();
    evidencePromise = Promise.resolve()
      .then(() => deps.collectEvidence(input.evidenceContext))
      .then((rawEvidence) => {
        const evidence = CandidateEvidenceBundleSchema.safeParse(rawEvidence);
        if (!evidence.success) throw new Error("Exact evidence was invalid.");
        gatheredEvidence = evidence.data;
        return evidence.data;
      })
      .finally(() => {
        deps.onTiming?.({
          name: "evidence",
          durationMs: elapsed(startedAt),
          description: "Evidence checks",
        });
      });
    return evidencePromise;
  };

  const verifierStartedAt = performance.now();
  let rawDecision: unknown;
  try {
    rawDecision = await (deps.runner ?? runVerifierAgent)({
      model: deps.model,
      abortSignal: deps.abortSignal,
      candidateIdentity: {
        candidateId: input.candidate.candidateId,
        candidateVersion: input.candidate.candidateVersion,
        snapshotVersion: input.candidate.snapshotVersion,
      },
      gatherCandidateEvidence: gatherEvidenceOnce,
    });
  } catch {
    deps.onTiming?.({
      name: "verifier",
      durationMs: elapsed(verifierStartedAt),
      description: "Verification",
    });
    deps.onEvent?.({ type: "error", message: VERIFIER_ERROR });
    return { status: "VERIFIER_ERROR", reason: VERIFIER_ERROR, evidence: gatheredEvidence };
  }

  deps.onTiming?.({
    name: "verifier",
    durationMs: elapsed(verifierStartedAt),
    description: "Verification",
  });

  if (!gatheredEvidence) {
    deps.onEvent?.({ type: "error", message: VERIFIER_ERROR });
    return { status: "VERIFIER_ERROR", reason: VERIFIER_ERROR, evidence: null };
  }

  const outcome = guardVerificationDecision(rawDecision, gatheredEvidence, input.candidate);
  if (outcome.status === "VERIFIER_ERROR") {
    deps.onEvent?.({ type: "error", message: VERIFIER_ERROR });
    return outcome;
  }

  deps.onEvent?.({
    type: "decision",
    candidateId: outcome.decision.candidateId,
    decision: outcome.decision.decision,
    reason: outcome.decision.reasons[0],
  });
  return outcome;
}
