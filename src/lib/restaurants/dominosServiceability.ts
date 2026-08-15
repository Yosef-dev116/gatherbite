import type { DeliveryAddress, DominosCandidate } from "../gatherbite/contracts";
import { calculatePeiHst, PEI_HST_SOURCE } from "../pricing/peiTax";

export type ServiceMethod = "delivery" | "carryout" | "either";

export interface ServiceabilityLookup {
  (address: DeliveryAddress, signal: AbortSignal): Promise<{ storeIds: string[]; observedAt: string }>;
}

export type DominosServiceabilityResult =
  | {
      status: "SERVICEABLE";
      applicability: "REQUIRED" | "NOT_REQUIRED";
      storeIds: readonly string[];
      observedAt: string;
      source: string;
      reason: string;
    }
  | {
      status: "NOT_SERVICEABLE" | "UNKNOWN";
      applicability: "REQUIRED";
      storeIds: readonly string[];
      observedAt: string;
      source: string;
      reason: string;
    };

const SERVICEABILITY_SOURCE = "Domino's official store-locator flow";

function uniqueStoreIds(rawIds: readonly string[]): string[] {
  return [...new Set(rawIds.map((storeId) => storeId.trim()).filter(Boolean))];
}

export async function checkDominosServiceability(
  address: DeliveryAddress | undefined,
  method: ServiceMethod,
  deps: { lookup: ServiceabilityLookup; signal?: AbortSignal },
): Promise<DominosServiceabilityResult> {
  const now = new Date().toISOString();
  if (method === "carryout") {
    return {
      status: "SERVICEABLE",
      applicability: "NOT_REQUIRED",
      storeIds: [],
      observedAt: now,
      source: "Not applicable to carryout",
      reason: "A delivery address is not required for carryout.",
    };
  }

  if (!address) {
    return {
      status: "UNKNOWN",
      applicability: "REQUIRED",
      storeIds: [],
      observedAt: now,
      source: SERVICEABILITY_SOURCE,
      reason: "Delivery serviceability is unknown because no delivery address was supplied.",
    };
  }

  const signal = deps.signal ?? new AbortController().signal;
  try {
    const lookup = await deps.lookup(address, signal);
    const storeIds = uniqueStoreIds(lookup.storeIds);
    if (storeIds.length === 0) {
      return {
        status: "NOT_SERVICEABLE",
        applicability: "REQUIRED",
        storeIds,
        observedAt: lookup.observedAt,
        source: SERVICEABILITY_SOURCE,
        reason: "The official lookup did not return a serviceable store for this address.",
      };
    }
    return {
      status: "SERVICEABLE",
      applicability: "REQUIRED",
      storeIds,
      observedAt: lookup.observedAt,
      source: SERVICEABILITY_SOURCE,
      reason: "The official lookup returned serviceable Domino's stores for this address.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: "UNKNOWN",
      applicability: "REQUIRED",
      storeIds: [],
      observedAt: now,
      source: SERVICEABILITY_SOURCE,
      reason: `Delivery serviceability could not be proven: ${reason}`,
    };
  }
}

export type DominosPriceEvidence =
  | {
      status: "KNOWN";
      kind: "LIVE_QUOTE" | "TRUSTED_CALCULATION";
      subtotalCad: number;
      taxCad: number;
      feesCad: number;
      totalCad: number;
      source: string;
      observedAt: string;
      /** Exact, deterministic binding to the candidate manifest this price covers. */
      candidateBinding: string;
    }
  | {
      status: "UNKNOWN";
      kind: "UNKNOWN";
      subtotalCad: number | null;
      taxCad: null;
      feesCad: null;
      totalCad: null;
      source: string;
      observedAt: string;
      reason: string;
    };

export interface DominosLiveQuote {
  subtotalCad: number;
  taxCad: number;
  feesCad: number;
  totalCad: number;
  source: string;
}

export interface DominosFeeComponent {
  amountCad: number | null;
  taxable: boolean | null;
}

export interface DominosTrustedPriceCalculation {
  subtotalCad: number | null;
  fees: readonly DominosFeeComponent[];
  /** False means at least one required fee has not been observed. */
  allRequiredFeesKnown: boolean;
}

/**
 * Builds a collision-free structural string for the exact candidate facts a
 * quote/calculation priced. Expected price fields are intentionally excluded:
 * they are compared independently against the returned price evidence.
 */
export function createDominosCandidatePriceBinding(candidate: DominosCandidate): string {
  return `dominos-candidate-price-v1:${JSON.stringify({
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
    snapshotVersion: candidate.snapshotVersion,
    storeId: candidate.storeId,
    serviceMethod: candidate.serviceMethod,
    dealCodes: candidate.dealCodes,
    pizzas: candidate.pizzas.map((pizza) => ({
      lineId: pizza.lineId,
      quantity: pizza.quantity,
      productCode: pizza.productCode,
      variantCode: pizza.variantCode,
      sizeCode: pizza.sizeCode,
      crustCode: pizza.crustCode,
      sauceCode: pizza.sauceCode,
      cheeseCode: pizza.cheeseCode,
      toppings: pizza.toppings.map((topping) => ({ code: topping.code, quantity: topping.quantity })),
      purpose: pizza.purpose,
      protectsGroupIds: pizza.protectsGroupIds,
      trustedSlicesPerPizza: pizza.trustedSlicesPerPizza,
    })),
  })}`;
}

function roundCad(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cadCents(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) return null;
  return rounded;
}

function validCad(value: number | null): value is number {
  return cadCents(value) !== null;
}

function completeLiveQuote(quote: DominosLiveQuote | undefined): boolean {
  if (!quote) return false;
  const values = [quote.subtotalCad, quote.taxCad, quote.feesCad, quote.totalCad];
  if (!values.every(validCad)) return false;
  return cadCents(quote.subtotalCad)! + cadCents(quote.taxCad)! + cadCents(quote.feesCad)!
    === cadCents(quote.totalCad);
}

export function resolveDominosPriceEvidence(input: {
  observedAt: string;
  candidateBinding: string;
  liveQuote?: DominosLiveQuote;
  calculation?: DominosTrustedPriceCalculation;
}): DominosPriceEvidence {
  const candidateBinding = input.candidateBinding.trim();
  const liveQuote = input.liveQuote;
  if (candidateBinding && liveQuote && completeLiveQuote(liveQuote)) {
    return {
      status: "KNOWN",
      kind: "LIVE_QUOTE",
      subtotalCad: roundCad(liveQuote.subtotalCad),
      taxCad: roundCad(liveQuote.taxCad),
      feesCad: roundCad(liveQuote.feesCad),
      totalCad: roundCad(liveQuote.totalCad),
      source: liveQuote.source,
      observedAt: input.observedAt,
      candidateBinding,
    };
  }

  const calculation = input.calculation;
  const feesComplete = calculation?.allRequiredFeesKnown === true
    && calculation.fees.every((fee) => validCad(fee.amountCad) && typeof fee.taxable === "boolean");
  if (candidateBinding && calculation && validCad(calculation.subtotalCad) && feesComplete) {
    const taxableFees = calculation.fees.reduce(
      (sum, fee) => sum + (fee.taxable ? fee.amountCad as number : 0),
      0,
    );
    const feesCad = roundCad(calculation.fees.reduce((sum, fee) => sum + (fee.amountCad as number), 0));
    const taxCad = calculatePeiHst(calculation.subtotalCad + taxableFees).taxCad;
    return {
      status: "KNOWN",
      kind: "TRUSTED_CALCULATION",
      subtotalCad: roundCad(calculation.subtotalCad),
      taxCad,
      feesCad,
      totalCad: roundCad(calculation.subtotalCad + feesCad + taxCad),
      source: PEI_HST_SOURCE,
      observedAt: input.observedAt,
      candidateBinding,
    };
  }

  return {
    status: "UNKNOWN",
    kind: "UNKNOWN",
    subtotalCad: calculation && validCad(calculation.subtotalCad) ? roundCad(calculation.subtotalCad) : null,
    taxCad: null,
    feesCad: null,
    totalCad: null,
    source: input.liveQuote?.source ?? PEI_HST_SOURCE,
    observedAt: input.observedAt,
    reason: candidateBinding
      ? "A complete official quote or every required pre-tax component and taxability was not known."
      : "Price evidence was not bound to an exact candidate manifest.",
  };
}
