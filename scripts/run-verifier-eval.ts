#!/usr/bin/env tsx
/**
 * Task 17, Step 3 — opt-in, network-dependent live verifier model comparison.
 *
 * THIS SCRIPT IS NOT PART OF `npm test`. It requires a live GROQ_API_KEY and
 * makes real model calls. Run it manually:
 *
 *   npm run eval:verifier
 *   npm run eval:verifier -- --proposed-model=openai/gpt-oss-20b --repeats=5
 *   GATHERBITE_PROPOSED_VERIFIER_MODEL=openai/gpt-oss-20b npm run eval:verifier
 *
 * Usage / flags (all optional):
 *   --proposed-model=<groq model id>   Faster candidate model to compare against
 *                                      the current default. Also settable via
 *                                      GATHERBITE_PROPOSED_VERIFIER_MODEL. No
 *                                      default is hardcoded as a "winner" —
 *                                      pass the exact id you want to evaluate,
 *                                      e.g. "openai/gpt-oss-20b" (example only).
 *   --current-model=<groq model id>    Override the "current" baseline model id.
 *                                      Defaults to the same resolution as
 *                                      src/lib/groq.ts's VERIFIER_MODEL
 *                                      (GATHERBITE_VERIFIER_MODEL env var, else
 *                                      "openai/gpt-oss-120b").
 *   --repeats=<n>                      Repeats per case per model (default 3).
 *
 * For every case in LIVE_COMPARABLE_EVAL_CASES (src/lib/agents/verifierEval.ts)
 * and every repeat, this script runs the real `runDominosVerifier` pipeline
 * against fixed, synthetic evidence (no live Domino's calls, no real address —
 * evidence is injected directly) once per model. It prints, per run, only:
 * case ID, expected vs actual decision, schema success, latency (ms), and
 * token usage. It never prints prompts, private model reasoning, or request
 * payload content — there is no real address or PII in these fixtures, but
 * the same output discipline is kept regardless.
 *
 * Exit code is non-zero when any run across either model:
 *   - is a false approval (approved a candidate whose fixed case expects REJECT)
 *   - is a fail-open UNKNOWN (a stale/unknown-evidence case that still approved)
 *   - is a disposition mismatch (a REJECT whose disposition differs from the
 *     case's single canonical expected disposition — see the note below)
 *   - shows the proposed model has a lower schema-success rate than the
 *     current model
 *
 * Note on "disposition mismatch": a well-reasoned model may sometimes choose
 * a different-but-still-defensible disposition (e.g. ADAPT_ORDER vs.
 * TRY_ANOTHER_STORE) than this script's single canonical expectation per
 * case. This check is intentionally strict for evaluation purposes; treat a
 * disposition-mismatch-only failure as a signal to review, not automatically
 * as a disqualifying defect.
 */
import { createGroq } from "@ai-sdk/groq";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

import { runDominosVerifier } from "../src/lib/agents/dominosVerifier";
import {
  LIVE_COMPARABLE_EVAL_CASES,
  type VerifierEvalCase,
} from "../src/lib/agents/verifierEval";
import type { CandidateEvidenceContext } from "../src/lib/restaurants/dominosEvidence";

interface CliOptions {
  currentModelId: string;
  proposedModelId: string;
  repeats: number;
}

function parseCliOptions(argv: string[]): CliOptions {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1], match[2]);
  }

  const currentModelId = flags.get("current-model")
    ?? process.env.GATHERBITE_VERIFIER_MODEL
    ?? "openai/gpt-oss-120b";
  const proposedModelId = flags.get("proposed-model")
    ?? process.env.GATHERBITE_PROPOSED_VERIFIER_MODEL
    ?? "";
  const repeats = Number.parseInt(flags.get("repeats") ?? "3", 10);

  if (!proposedModelId) {
    throw new Error(
      "A proposed model id is required: pass --proposed-model=<groq model id> "
      + "or set GATHERBITE_PROPOSED_VERIFIER_MODEL. No default is assumed — "
      + "see the usage comment at the top of this script for an example.",
    );
  }
  if (!Number.isFinite(repeats) || repeats < 1) {
    throw new Error("--repeats must be a positive integer.");
  }

  return { currentModelId, proposedModelId, repeats };
}

interface CallCapture {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Wraps a real language model to capture per-provider-call latency and token
 * usage only. Never inspects or logs prompts, messages, or response text.
 */
function withCallCapture(model: LanguageModel, captures: CallCapture[]): LanguageModel {
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate }) => {
      const startedAt = performance.now();
      const result = await doGenerate();
      captures.push({
        latencyMs: performance.now() - startedAt,
        inputTokens: result.usage?.inputTokens?.total ?? 0,
        outputTokens: result.usage?.outputTokens?.total ?? 0,
      });
      return result;
    },
  };
  return wrapLanguageModel({ model: model as never, middleware }) as unknown as LanguageModel;
}

interface RunResult {
  caseId: string;
  category: string;
  modelLabel: "current" | "proposed";
  attempt: number;
  expectedDecision: "APPROVE" | "REJECT";
  expectedDisposition: string | null;
  schemaSuccess: boolean;
  actualDecision: "APPROVE" | "REJECT" | null;
  actualDisposition: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  isFalseApproval: boolean;
  isFailOpenUnknown: boolean;
  isDispositionMismatch: boolean;
}

async function runOneCase(
  evalCase: VerifierEvalCase,
  modelLabel: "current" | "proposed",
  model: LanguageModel,
  attempt: number,
): Promise<RunResult> {
  const captures: CallCapture[] = [];
  const wrappedModel = withCallCapture(model, captures);
  const evidenceContext = { candidate: evalCase.candidate } as CandidateEvidenceContext;

  const outcome = await runDominosVerifier(
    { candidate: evalCase.candidate, evidenceContext },
    {
      model: wrappedModel,
      collectEvidence: async () => evalCase.evidence,
    },
  );

  const schemaSuccess = outcome.status === "DECIDED";
  const actualDecision = outcome.status === "DECIDED" ? outcome.decision.decision : null;
  const actualDisposition = outcome.status === "DECIDED" ? outcome.decision.disposition : null;
  const expectedDisposition = evalCase.expected.disposition ?? null;

  const isFalseApproval = evalCase.expectedLiveDecision === "REJECT" && actualDecision === "APPROVE";
  const isFailOpenUnknown = evalCase.category === "stale-unknown" && actualDecision === "APPROVE";
  const isDispositionMismatch = schemaSuccess
    && actualDecision === "REJECT"
    && expectedDisposition !== null
    && actualDisposition !== expectedDisposition;

  return {
    caseId: evalCase.id,
    category: evalCase.category,
    modelLabel,
    attempt,
    expectedDecision: evalCase.expectedLiveDecision ?? "REJECT",
    expectedDisposition,
    schemaSuccess,
    actualDecision,
    actualDisposition,
    latencyMs: captures.reduce((sum, c) => sum + c.latencyMs, 0),
    inputTokens: captures.reduce((sum, c) => sum + c.inputTokens, 0),
    outputTokens: captures.reduce((sum, c) => sum + c.outputTokens, 0),
    isFalseApproval,
    isFailOpenUnknown,
    isDispositionMismatch,
  };
}

function schemaSuccessRate(results: RunResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((r) => r.schemaSuccess).length / results.length;
}

function printRun(result: RunResult): void {
  console.log(
    `[${result.modelLabel}] ${result.caseId} (#${result.attempt}) `
    + `expected=${result.expectedDecision}${result.expectedDisposition ? `/${result.expectedDisposition}` : ""} `
    + `actual=${result.actualDecision ?? "VERIFIER_ERROR"}${result.actualDisposition ? `/${result.actualDisposition}` : ""} `
    + `schemaSuccess=${result.schemaSuccess} `
    + `latencyMs=${result.latencyMs.toFixed(1)} `
    + `tokens(in/out)=${result.inputTokens}/${result.outputTokens}`,
  );
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
  const currentModel = groq(options.currentModelId);
  const proposedModel = groq(options.proposedModelId);

  console.log(`GatherBite verifier model comparison`);
  console.log(`current model:  ${options.currentModelId}`);
  console.log(`proposed model: ${options.proposedModelId}`);
  console.log(`cases: ${LIVE_COMPARABLE_EVAL_CASES.length}, repeats: ${options.repeats}`);
  console.log("");

  const allResults: RunResult[] = [];
  for (const evalCase of LIVE_COMPARABLE_EVAL_CASES) {
    for (let attempt = 1; attempt <= options.repeats; attempt += 1) {
      const currentResult = await runOneCase(evalCase, "current", currentModel as unknown as LanguageModel, attempt);
      printRun(currentResult);
      allResults.push(currentResult);

      const proposedResult = await runOneCase(evalCase, "proposed", proposedModel as unknown as LanguageModel, attempt);
      printRun(proposedResult);
      allResults.push(proposedResult);
    }
  }

  const currentResults = allResults.filter((r) => r.modelLabel === "current");
  const proposedResults = allResults.filter((r) => r.modelLabel === "proposed");
  const currentSchemaRate = schemaSuccessRate(currentResults);
  const proposedSchemaRate = schemaSuccessRate(proposedResults);

  const falseApprovals = allResults.filter((r) => r.isFalseApproval);
  const failOpenUnknowns = allResults.filter((r) => r.isFailOpenUnknown);
  const dispositionMismatches = allResults.filter((r) => r.isDispositionMismatch);
  const worseSchemaReliability = proposedSchemaRate < currentSchemaRate;

  console.log("");
  console.log("Summary");
  console.log(`current schema-success rate:  ${(currentSchemaRate * 100).toFixed(1)}% (${currentResults.length} runs)`);
  console.log(`proposed schema-success rate: ${(proposedSchemaRate * 100).toFixed(1)}% (${proposedResults.length} runs)`);
  console.log(`false approvals: ${falseApprovals.length}`);
  console.log(`fail-open unknowns: ${failOpenUnknowns.length}`);
  console.log(`disposition mismatches: ${dispositionMismatches.length}`);
  console.log(`proposed model schema reliability worse than current: ${worseSchemaReliability}`);

  const hasBlockingFailure = falseApprovals.length > 0
    || failOpenUnknowns.length > 0
    || dispositionMismatches.length > 0
    || worseSchemaReliability;

  if (hasBlockingFailure) {
    console.error("");
    console.error("FAIL: at least one blocking condition was detected. See summary above.");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("PASS: no false approvals, no fail-open unknowns, no disposition mismatches, and schema reliability held.");
}

main().catch((error) => {
  // Redact: never print the caught error's message verbatim, since it may
  // originate from a provider client and could echo request details.
  console.error("run-verifier-eval failed unexpectedly. See process exit code.");
  void error;
  process.exitCode = 1;
});
