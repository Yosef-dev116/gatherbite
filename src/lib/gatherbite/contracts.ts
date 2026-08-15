import { z } from "zod";

import {
  ALL_PIZZA_PREFERENCES,
  ALL_RESTRICTIONS,
  type PizzaPreference,
  type Restriction,
} from "../types";
import type { WaitMinutes } from "../restaurants/dominos";

export const ServiceMethodSchema = z.enum(["delivery", "carryout", "either"]);

export const DeliveryAddressSchema = z.object({
  street: z.string().trim().min(3).max(120),
  unit: z.string().trim().max(30).optional(),
  city: z.string().trim().min(2).max(80),
  province: z.literal("PE"),
  postalCode: z.string().trim().toUpperCase().regex(/^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/),
});

export const DietaryGroupSchema = z.object({
  id: z.string().min(1),
  people: z.number().int().min(1).max(200),
  restrictions: z.array(z.enum(ALL_RESTRICTIONS as [Restriction, ...Restriction[]])).min(1),
  notes: z.string().trim().max(200).optional(),
});

export const DietaryGroupsSchema = z.array(DietaryGroupSchema).max(10).superRefine((groups, ctx) => {
  const seen = new Set<string>();
  for (const [index, group] of groups.entries()) {
    if (seen.has(group.id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate dietary group identifier: ${group.id}`,
      });
    }
    seen.add(group.id);
  }
});
export const PizzaPreferencesSchema = z.array(
  z.enum(ALL_PIZZA_PREFERENCES as [PizzaPreference, ...PizzaPreference[]]),
).max(ALL_PIZZA_PREFERENCES.length);

/**
 * The public request contract deliberately permits group counts that add
 * beyond `attendees`: groups describe restrictions, not mutually exclusive
 * attendee identities. No downstream code may derive an unrestricted count
 * by subtracting their sum from the total.
 */
export const GatherBiteInputSchema = z.object({
  attendees: z.number().int().min(1).max(200),
  budgetCad: z.number().positive().max(5000),
  serviceMethod: ServiceMethodSchema.default("either"),
  deliveryAddress: DeliveryAddressSchema.optional(),
  groups: DietaryGroupsSchema,
  pizzaPreferences: PizzaPreferencesSchema.default([]),
}).superRefine((value, ctx) => {
  if (value.serviceMethod !== "carryout" && !value.deliveryAddress) {
    ctx.addIssue({
      code: "custom",
      path: ["deliveryAddress"],
      message: "Delivery address is required for Delivery or Either.",
    });
  }
});

export type DeliveryAddress = z.infer<typeof DeliveryAddressSchema>;
export type GatherBiteInput = z.infer<typeof GatherBiteInputSchema>;

export type EvidenceStatus = "PASS" | "FAIL" | "UNKNOWN";
export interface EvidenceCheck<TFacts = unknown> {
  status: EvidenceStatus;
  code: string;
  summary: string;
  facts: TFacts;
  source: string;
}

export const EvidenceStatusSchema = z.enum(["PASS", "FAIL", "UNKNOWN"]);
export const EvidenceCheckSchema = z.object({
  status: EvidenceStatusSchema,
  code: z.string(),
  summary: z.string(),
  facts: z.unknown(),
  source: z.string(),
});

export interface PreferenceEvidence {
  requested: PizzaPreference[];
  represented: PizzaPreference[];
  unmet: Array<{ preference: PizzaPreference; reason: string }>;
}

export const PreferenceEvidenceSchema = z.object({
  requested: PizzaPreferencesSchema,
  represented: PizzaPreferencesSchema,
  unmet: z.array(z.object({
    preference: z.enum(ALL_PIZZA_PREFERENCES as [PizzaPreference, ...PizzaPreference[]]),
    reason: z.string(),
  })),
});

export interface CandidatePizza {
  lineId: string;
  quantity: number;
  productCode: string;
  variantCode: string;
  sizeCode: string;
  crustCode: string;
  sauceCode: string | null;
  cheeseCode: string | null;
  toppings: Array<{ code: string; quantity: number }>;
  purpose: "dietary-protected" | "general";
  protectsGroupIds: string[];
  trustedSlicesPerPizza: number;
}

// Mirrors src/lib/restaurants/dominosEvidence.ts's MAX_PIZZA_LINES (candidate
// pizza-line bound). Kept as a literal here (not imported) to avoid a
// schema-module -> evidence-module dependency; the two must stay numerically
// in sync as a matter of code review, not a shared import.
const MAX_CANDIDATE_PIZZA_LINES = 100;
const MAX_TOPPINGS_PER_CANDIDATE_LINE = 10;
const MAX_CANDIDATE_DEAL_CODES = 200;

export const CandidatePizzaSchema = z.object({
  lineId: z.string().min(1),
  quantity: z.number().int().min(1),
  productCode: z.string().min(1),
  variantCode: z.string().min(1),
  sizeCode: z.string().min(1),
  crustCode: z.string().min(1),
  sauceCode: z.string().min(1).nullable(),
  cheeseCode: z.string().min(1).nullable(),
  toppings: z.array(z.object({ code: z.string().min(1), quantity: z.number().int().min(1) })).max(MAX_TOPPINGS_PER_CANDIDATE_LINE),
  purpose: z.enum(["dietary-protected", "general"]),
  protectsGroupIds: z.array(z.string().min(1)),
  trustedSlicesPerPizza: z.number().int().positive(),
});

export interface DominosCandidate {
  candidateId: string;
  candidateVersion: number;
  snapshotVersion: string;
  storeId: string;
  serviceMethod: "delivery" | "carryout";
  dealCodes: string[];
  pizzas: CandidatePizza[];
  expectedPricing: {
    subtotalCad: number | null;
    taxCad: number | null;
    feesCad: number | null;
    totalCad: number | null;
  };
}

export const DominosCandidateSchema = z.object({
  candidateId: z.string().min(1),
  candidateVersion: z.number().int().min(1),
  snapshotVersion: z.string().min(1),
  storeId: z.string().min(1),
  serviceMethod: z.enum(["delivery", "carryout"]),
  dealCodes: z.array(z.string().min(1)).max(MAX_CANDIDATE_DEAL_CODES),
  pizzas: z.array(CandidatePizzaSchema).min(1).max(MAX_CANDIDATE_PIZZA_LINES),
  expectedPricing: z.object({
    subtotalCad: z.number().nonnegative().nullable(),
    taxCad: z.number().nonnegative().nullable(),
    feesCad: z.number().nonnegative().nullable(),
    totalCad: z.number().nonnegative().nullable(),
  }),
});

export interface CandidateEvidenceBundle {
  candidateId: string;
  candidateVersion: number;
  snapshotVersion: string;
  checks: {
    menuIntegrity: EvidenceCheck;
    dietary: EvidenceCheck;
    capacity: EvidenceCheck;
    budget: EvidenceCheck;
    availability: EvidenceCheck;
    serviceability: EvidenceCheck;
  };
  preference: PreferenceEvidence;
  collectedAt: string;
}

const EvidenceChecksSchema = z.object({
  menuIntegrity: EvidenceCheckSchema,
  dietary: EvidenceCheckSchema,
  capacity: EvidenceCheckSchema,
  budget: EvidenceCheckSchema,
  availability: EvidenceCheckSchema,
  serviceability: EvidenceCheckSchema,
});

export const CandidateEvidenceBundleSchema = z.object({
  candidateId: z.string().min(1),
  candidateVersion: z.number().int().min(1),
  snapshotVersion: z.string().min(1),
  checks: EvidenceChecksSchema,
  preference: PreferenceEvidenceSchema,
  collectedAt: z.string().datetime(),
});

export type VerificationDecision =
  | { candidateId: string; candidateVersion: number; snapshotVersion: string; decision: "APPROVE"; disposition: "NONE"; reasons: string[]; unknowns: [] }
  | { candidateId: string; candidateVersion: number; snapshotVersion: string; decision: "REJECT"; disposition: "ADAPT_ORDER" | "TRY_ANOTHER_STORE" | "TERMINAL"; reasons: string[]; unknowns: string[] };

export const VerificationDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    candidateId: z.string().min(1),
    candidateVersion: z.number().int().min(1),
    snapshotVersion: z.string().min(1),
    decision: z.literal("APPROVE"),
    disposition: z.literal("NONE"),
    reasons: z.array(z.string()),
    unknowns: z.tuple([]),
  }),
  z.object({
    candidateId: z.string().min(1),
    candidateVersion: z.number().int().min(1),
    snapshotVersion: z.string().min(1),
    decision: z.literal("REJECT"),
    disposition: z.enum(["ADAPT_ORDER", "TRY_ANOTHER_STORE", "TERMINAL"]),
    reasons: z.array(z.string()),
    unknowns: z.array(z.string()),
  }),
]);

export type VerificationOutcome =
  | { status: "DECIDED"; decision: VerificationDecision; evidence: CandidateEvidenceBundle }
  | { status: "VERIFIER_ERROR"; reason: string; evidence: CandidateEvidenceBundle | null };

export const VerificationOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DECIDED"), decision: VerificationDecisionSchema, evidence: CandidateEvidenceBundleSchema }),
  z.object({ status: z.literal("VERIFIER_ERROR"), reason: z.string(), evidence: CandidateEvidenceBundleSchema.nullable() }),
]);

export const WaitMinutesSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

export interface VerifiedDominosOption {
  candidate: DominosCandidate;
  decision: Extract<VerificationDecision, { decision: "APPROVE" }>;
  evidence: CandidateEvidenceBundle;
  /** Live public address from the same immutable store observation, or null. */
  storeAddress: string | null;
  /** Human-readable names resolved from the candidate's exact live catalog. */
  displayLines: OrganizerPizzaDisplayLine[];
  relevantWaitMinutes: WaitMinutes | null;
  recommendationReason: string;
}

export interface OrganizerPizzaDisplayLine {
  lineId: string;
  quantity: number;
  productName: string | null;
  variantName: string | null;
  sauceName: string | null;
  cheeseName: string | null;
  toppings: Array<{ code: string; quantity: number; name: string | null }>;
}

export const OrganizerPizzaDisplayLineSchema = z.object({
  lineId: z.string().min(1),
  quantity: z.number().int().positive(),
  productName: z.string().min(1).nullable(),
  variantName: z.string().min(1).nullable(),
  sauceName: z.string().min(1).nullable(),
  cheeseName: z.string().min(1).nullable(),
  toppings: z.array(z.object({
    code: z.string().min(1),
    quantity: z.number().int().positive(),
    name: z.string().min(1).nullable(),
  })),
});

export const VerifiedDominosOptionSchema = z.object({
  candidate: DominosCandidateSchema,
  decision: z.object({
    candidateId: z.string().min(1),
    candidateVersion: z.number().int().min(1),
    snapshotVersion: z.string().min(1),
    decision: z.literal("APPROVE"),
    disposition: z.literal("NONE"),
    reasons: z.array(z.string()),
    unknowns: z.tuple([]),
  }),
  evidence: CandidateEvidenceBundleSchema,
  storeAddress: z.string().min(1).nullable(),
  displayLines: z.array(OrganizerPizzaDisplayLineSchema),
  relevantWaitMinutes: WaitMinutesSchema.nullable(),
  recommendationReason: z.string(),
});

export interface CandidateJourney {
  candidate: DominosCandidate;
  outcome: VerificationOutcome;
  adaptedFromCandidateId: string | null;
}

export const CandidateJourneySchema = z.object({
  candidate: DominosCandidateSchema,
  outcome: VerificationOutcomeSchema,
  adaptedFromCandidateId: z.string().min(1).nullable(),
});

export interface GatherBiteEvaluation {
  recommended: VerifiedDominosOption | null;
  alternatives: VerifiedDominosOption[];
  journeys: CandidateJourney[];
  events: PublicGatherBiteEvent[];
  noViableReason: string | null;
}

export type PublicGatherBiteEvent =
  | { type: "stage"; stage: "observing" | "planning" | "verifying" | "adapting" | "comparing"; message: string }
  | { type: "candidate"; candidateId: string; summary: string }
  | { type: "decision"; candidateId: string; decision: "APPROVE" | "REJECT"; reason: string }
  | { type: "complete"; result: GatherBiteEvaluation }
  | { type: "error"; message: string };

function buildPublicGatherBiteEventSchema(): z.ZodType<PublicGatherBiteEvent> {
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("stage"), stage: z.enum(["observing", "planning", "verifying", "adapting", "comparing"]), message: z.string() }),
    z.object({ type: z.literal("candidate"), candidateId: z.string().min(1), summary: z.string() }),
    z.object({ type: z.literal("decision"), candidateId: z.string().min(1), decision: z.enum(["APPROVE", "REJECT"]), reason: z.string() }),
    z.object({ type: z.literal("complete"), result: GatherBiteEvaluationSchema }),
    z.object({ type: z.literal("error"), message: z.string() }),
  ]);
}

export const GatherBiteEvaluationSchema: z.ZodType<GatherBiteEvaluation> = z.lazy(() => z.object({
  recommended: VerifiedDominosOptionSchema.nullable(),
  alternatives: z.array(VerifiedDominosOptionSchema),
  journeys: z.array(CandidateJourneySchema),
  events: z.array(z.lazy(buildPublicGatherBiteEventSchema)),
  noViableReason: z.string().nullable(),
}));

export const PublicGatherBiteEventSchema: z.ZodType<PublicGatherBiteEvent> = z.lazy(buildPublicGatherBiteEventSchema);
