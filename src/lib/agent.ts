import { ToolLoopAgent, tool, stepCountIs } from "ai";
import { z } from "zod";
import { AGENT_MODEL } from "./groq";
import { menuForAgent, FEE_STRUCTURE } from "./menu";
import { verifyPlan, round2 } from "./verify";
import {
  pickBestVerifiedPlan,
  estimateMinimumWorkableBudget,
  computeFoodBuffer,
  scoreGeneralPreferenceAlignment,
} from "./scoring";
import type { VerifiedCandidate } from "./scoring";
import type {
  BudgetSuggestion,
  BuildOrderInput,
  BuildOrderResult,
  FoodBuffer,
  OrderLine,
  PlanLine,
  StepEvent,
  VerifyResult,
} from "./types";
import { MENU_BY_ID } from "./menu";
import { PIZZA_PREFERENCE_LABELS, RESTRICTION_LABELS } from "./types";
import { recordAgentVerification, shouldStopAgentLoop } from "./agent-loop";
import type { AgentLoopState } from "./agent-loop";

const SLICES_PER_PERSON = 3;

export interface AgentTimingEvent {
  stage: "groq-total" | "groq-step";
  durationMs: number;
  stepNumber?: number;
  responseTimeMs?: number;
  toolNames?: string[];
}

export interface BuildOrderOptions {
  onTiming?: (event: AgentTimingEvent) => void;
}

const FAILURE_LABELS: Record<string, string> = {
  INSUFFICIENT_TOTAL_SLICES: "not enough total slices",
  DIETARY_COVERAGE_FAILED: "dietary coverage",
  DIETARY_COVERAGE_IMPOSSIBLE: "dietary coverage — no safe item exists",
  BUDGET_EXCEEDED: "over budget",
  INVALID_ITEM_REFERENCE: "invalid item reference",
};

function buildTools(input: BuildOrderInput, loopState: AgentLoopState) {
  const getMenuAndDeals = tool({
    description:
      "Get store 10088's menu items (id, name, price, slice count, whether it's a bundle/deal) and which items are curated-safe for which dietary restrictions. Only items listed in dietaryTags may be counted toward a dietary group's requirement — never infer safety from an item's name.",
    inputSchema: z.object({}),
    execute: async () => ({
      items: menuForAgent(),
      fees: FEE_STRUCTURE,
    }),
  });

  const verifyPlanTool = tool({
    description:
      "Deterministically verify a candidate order (list of {itemId, quantity}) against attendee count, budget, and dietary coverage. ALWAYS call this before finalizing an order. If it returns verified:false, change the plan (different items/quantities) and call this again. If a failure has code DIETARY_COVERAGE_IMPOSSIBLE, no retry can fix it — stop trying to cover that group and say so plainly in your final answer.",
    inputSchema: z.object({
      lines: z
        .array(
          z.object({
            itemId: z.string(),
            quantity: z.number().int().positive(),
          })
        )
        .min(1),
    }),
    execute: async ({ lines }) => {
      const verification = verifyPlan(lines as PlanLine[], input);
      recordAgentVerification(loopState, verification);
      return verification;
    },
  });

  return { getMenuAndDeals, verifyPlanTool };
}

function buildPrompt(input: BuildOrderInput): string {
  const groupsText = input.groups
    .map((g) => {
      const restrictions = g.restrictions.map((r) => RESTRICTION_LABELS[r]).join(" + ") || "none";
      return `- ${g.people} people: ${restrictions}${g.notes ? ` (note: ${g.notes})` : ""}`;
    })
    .join("\n");
  const preferences = (input.pizzaPreferences ?? [])
    .map((preference) => PIZZA_PREFERENCE_LABELS[preference])
    .join(", ");

  return `Plan tonight's Little Caesars order for the PEI IT Alliance Night Shift.

Attendees: ${input.attendees}
Budget: $${input.budget.toFixed(2)} CAD (must include delivery/service/small-order fees)
Store: ${input.storeId}
Slices needed: ${SLICES_PER_PERSON} per person, ${input.attendees * SLICES_PER_PERSON} total minimum

Dietary groups:
${groupsText || "- none"}

Soft pizza preferences for general order lines: ${preferences || "none"}

Steps:
1. Call getMenuAndDeals to see real items, prices, and curated dietary tags.
2. Choose items and quantities that cover the total slice requirement AND each dietary group's requirement, without making the whole order restricted unnecessarily. Dietary coverage comes first. If soft pizza preferences were supplied, try to represent them only in remaining/general pizza lines that are not being relied upon for dietary coverage. Never replace dietary-safe food with a preferred flavor. Prefer good value (lowest cost per slice, and multi-pizza bundles) to leave budget headroom.
3. Call verifyPlan with your candidate. If it fails, change quantities/items based on the specific failure reason and call verifyPlan again.
4. If verification fails and the failure can be fixed, adapt the candidate and retry — no more than 3 verifyPlan calls total. Once a candidate is verified, stop; the application uses the deterministic result directly, so no additional candidate or prose summary is needed. A deterministic scorer handles any verified candidates returned together. You do not decide validity yourself.

Never invent a menu item, price, slice count, or dietary safety claim that wasn't returned by getMenuAndDeals.`;
}

export async function buildOrder(input: BuildOrderInput, options: BuildOrderOptions = {}): Promise<BuildOrderResult> {
  const agentStartedAt = performance.now();
  const steps: StepEvent[] = [];
  const requiredSlices = input.attendees * SLICES_PER_PERSON;
  steps.push({
    label: `Calculating ${requiredSlices} slices needed for ${input.attendees} attendees`,
    kind: "info",
  });

  const loopState: AgentLoopState = {
    verifyAttempts: 0,
    hasVerifiedCandidate: false,
    hasTerminalImpossibleResult: false,
  };
  const { getMenuAndDeals, verifyPlanTool } = buildTools(input, loopState);

  const agent = new ToolLoopAgent({
    model: AGENT_MODEL,
    instructions:
      "You are an operations tool that plans a real pizza order from a fixed, trusted menu dataset. You never invent menu items, prices, slice counts, deals, or dietary-safety claims — you only use data returned by your tools. verifyPlan is the deterministic source of truth; your own judgment about whether a plan is good is not sufficient, it must pass verifyPlan.",
    tools: { getMenuAndDeals, verifyPlan: verifyPlanTool },
    // Preserve retry room for invalid candidates, while avoiding another
    // model round after deterministic success or a terminal verifier result.
    stopWhen: [stepCountIs(12), () => shouldStopAgentLoop(loopState)],
  });

  const result = await agent.generate({ prompt: buildPrompt(input) });

  for (const step of result.steps) {
    options.onTiming?.({
      stage: "groq-step",
      durationMs: step.performance.stepTimeMs,
      responseTimeMs: step.performance.responseTimeMs,
      stepNumber: step.stepNumber + 1,
      toolNames: step.toolCalls.map((call) => call.toolName),
    });
  }
  options.onTiming?.({
    stage: "groq-total",
    durationMs: performance.now() - agentStartedAt,
  });

  let verifyAttempts = 0;
  let lastVerifyResult: VerifyResult | null = null;
  let lastVerifyLines: PlanLine[] | null = null;
  const verifiedCandidates: VerifiedCandidate[] = [];

  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      if (call.toolName === "getMenuAndDeals") {
        steps.push({ label: `Checking menu options at store ${input.storeId}`, kind: "info" });
      }
    }

    for (const toolResult of step.toolResults) {
      if (toolResult.toolName !== "verifyPlan") continue;
      verifyAttempts += 1;
      const output = toolResult.output as VerifyResult;
      const lines = (toolResult.input as { lines: PlanLine[] }).lines;

      steps.push({
        label:
          verifyAttempts === 1
            ? `Candidate ${verifyAttempts} sent to deterministic verification`
            : `Adapted candidate ${verifyAttempts} sent to deterministic verification`,
        kind: "info",
        detail: `${lines.reduce((sum, line) => sum + line.quantity, 0)} menu item units proposed.`,
      });

      lastVerifyResult = output;
      lastVerifyLines = lines;

      if (output.verified) {
        // Not the final word yet — once the loop finishes, the best of
        // all verified candidates (there may be more than one) is picked
        // by the deterministic scorer below.
        steps.push({
          label: "Candidate verified",
          kind: "success",
          detail: `${output.totals.totalSlices}/${output.totals.requiredSlices} slices · $${output.totals.totalCad.toFixed(2)} total.`,
        });
        verifiedCandidates.push({ lines, verification: output });
      } else {
        for (const failure of output.failures) {
          steps.push({
            label: `Verification failed — ${FAILURE_LABELS[failure.code] ?? failure.code}`,
            kind: "failure",
            detail: failure.message,
          });
        }
        const canRetry = !output.failures.every((f) => f.code === "DIETARY_COVERAGE_IMPOSSIBLE");
        if (canRetry) {
          steps.push({ label: "Adjusting order", kind: "info" });
        }
      }
    }
  }

  const pizzaPreferences = input.pizzaPreferences ?? [];
  const best = pickBestVerifiedPlan(verifiedCandidates, pizzaPreferences, input.groups);
  if (best) {
    if (verifiedCandidates.length > 1) {
      steps.push({
        label: pizzaPreferences.length > 0
          ? `Comparing ${verifiedCandidates.length} verified options — soft preferences, then cost and waste`
          : `Comparing ${verifiedCandidates.length} verified options — lowest cost wins`,
        kind: "info",
      });
    }
    if (pizzaPreferences.length > 0) {
      const alignment = scoreGeneralPreferenceAlignment(best.lines, pizzaPreferences, input.groups);
      steps.push({
        label: alignment.represented.length > 0
          ? "Soft pizza preferences represented in general order lines"
          : "No soft pizza preference could be confirmed in general order lines",
        kind: "info",
        detail: alignment.represented.length > 0
          ? alignment.represented.map((preference) => PIZZA_PREFERENCE_LABELS[preference]).join(", ")
          : "The verified order remains valid; preferences never override dietary coverage, capacity, or budget.",
      });
    }
    steps.push({ label: "Order verified ✓", kind: "success" });
  }

  const finalLines = best?.lines ?? lastVerifyLines;
  const finalVerification = best?.verification ?? lastVerifyResult;

  let budgetSuggestion: BudgetSuggestion | null = null;
  let foodBuffer: FoodBuffer | null = null;
  if (!finalVerification?.verified) {
    const estimate = estimateMinimumWorkableBudget(input);
    if (estimate && estimate.totalCad > input.budget) {
      budgetSuggestion = {
        minimumWorkableBudgetCad: estimate.totalCad,
        shortfallCad: round2(estimate.totalCad - input.budget),
      };
    }
  } else {
    // Only computed for an already-verified order, and purely
    // informational - it never feeds back into or changes that order.
    foodBuffer = computeFoodBuffer(input, finalVerification);
  }

  const order: OrderLine[] | null = finalLines
    ? finalLines.map((line) => {
        const item = MENU_BY_ID[line.itemId];
        return {
          itemId: line.itemId,
          name: item?.name ?? line.itemId,
          quantity: line.quantity,
          unitPriceCad: item?.priceCad ?? 0,
          lineTotalCad: (item?.priceCad ?? 0) * line.quantity,
          slices: (item?.slices ?? 0) * line.quantity,
        };
      })
    : null;

  return {
    steps,
    verified: finalVerification?.verified ?? false,
    order,
    verification: finalVerification,
    attempts: verifyAttempts,
    budgetSuggestion,
    foodBuffer,
  };
}
