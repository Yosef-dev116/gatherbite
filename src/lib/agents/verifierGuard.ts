import { z } from "zod";

import {
  CandidateEvidenceBundleSchema,
  DominosCandidateSchema,
  type CandidateEvidenceBundle,
  type DominosCandidate,
  type VerificationDecision,
  type VerificationOutcome,
} from "../gatherbite/contracts";

const PublicReasonSchema = z.string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !/[\r\n]/.test(value), "Reason must be one concise line.");

const UnknownCodeSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/[\r\n]/.test(value), "Unknown must be one concise line.");

/** The only structure the Verification Agent is allowed to return. */
export const VerifierDecisionSchema: z.ZodType<VerificationDecision> = z.discriminatedUnion("decision", [
  z.object({
    candidateId: z.string().min(1),
    candidateVersion: z.number().int().min(1),
    snapshotVersion: z.string().min(1),
    decision: z.literal("APPROVE"),
    disposition: z.literal("NONE"),
    reasons: z.tuple([PublicReasonSchema]),
    unknowns: z.tuple([]),
  }).strict(),
  z.object({
    candidateId: z.string().min(1),
    candidateVersion: z.number().int().min(1),
    snapshotVersion: z.string().min(1),
    decision: z.literal("REJECT"),
    disposition: z.enum(["ADAPT_ORDER", "TRY_ANOTHER_STORE", "TERMINAL"]),
    reasons: z.tuple([PublicReasonSchema]),
    unknowns: z.array(UnknownCodeSchema).max(6),
  }).strict(),
]);

const PROTOCOL_ERROR = "Verification could not establish a trustworthy decision.";
const EVIDENCE_ERROR = "Verification evidence was incomplete or inconsistent.";

function verifierError(
  reason: string,
  evidence: CandidateEvidenceBundle | null,
): VerificationOutcome {
  return { status: "VERIFIER_ERROR", reason, evidence };
}

function sameIdentity(
  left: Pick<DominosCandidate, "candidateId" | "candidateVersion" | "snapshotVersion">,
  right: Pick<DominosCandidate, "candidateId" | "candidateVersion" | "snapshotVersion">,
): boolean {
  return left.candidateId === right.candidateId
    && left.candidateVersion === right.candidateVersion
    && left.snapshotVersion === right.snapshotVersion;
}

/**
 * Enforces the protocol around a model-issued verdict. It can veto an unsafe
 * APPROVE, but it never manufactures an approval/rejection or upgrades REJECT.
 */
export function guardVerificationDecision(
  rawDecision: unknown,
  rawEvidence: unknown,
  expectedCandidate?: DominosCandidate,
): VerificationOutcome {
  const parsedEvidence = CandidateEvidenceBundleSchema.safeParse(rawEvidence);
  if (!parsedEvidence.success) return verifierError(EVIDENCE_ERROR, null);

  const evidence = parsedEvidence.data;
  const parsedDecision = VerifierDecisionSchema.safeParse(rawDecision);
  if (!parsedDecision.success) return verifierError(PROTOCOL_ERROR, evidence);

  const decision = parsedDecision.data;
  const expected = expectedCandidate
    ? DominosCandidateSchema.safeParse(expectedCandidate)
    : null;
  if (expectedCandidate && (!expected || !expected.success)) {
    return verifierError(PROTOCOL_ERROR, evidence);
  }

  const evidenceIdentity = {
    candidateId: evidence.candidateId,
    candidateVersion: evidence.candidateVersion,
    snapshotVersion: evidence.snapshotVersion,
  };
  if (!sameIdentity(decision, evidenceIdentity)) {
    return verifierError(EVIDENCE_ERROR, evidence);
  }
  if (expected?.success && (
    !sameIdentity(expected.data, evidenceIdentity)
    || !sameIdentity(decision, expected.data)
  )) {
    return verifierError(EVIDENCE_ERROR, evidence);
  }

  if (decision.decision === "REJECT") {
    return { status: "DECIDED", decision, evidence };
  }

  if (Object.values(evidence.checks).some((check) => check.status !== "PASS")) {
    return verifierError(EVIDENCE_ERROR, evidence);
  }

  return { status: "DECIDED", decision, evidence };
}
