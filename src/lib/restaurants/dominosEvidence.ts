import type {
  CandidateEvidenceBundle,
  CandidatePizza,
  DominosCandidate,
  EvidenceCheck,
  GatherBiteInput,
  PreferenceEvidence,
} from "../gatherbite/contracts";
import type { DietaryGroupInput, PizzaPreference } from "../types";
import type { DominosStoreSnapshot } from "./dominos";
import { allocateProtectedSlices, checkTotalPizzaCapacity } from "./dominosCapacity";
import type { DominosCatalog } from "./dominosCatalog";
import {
  evaluateConfiguredDominosPizza,
  type DietaryEvaluation,
  type DietaryStatus,
} from "./dominosDietary";
import type {
  DominosPriceEvidence,
  DominosServiceabilityResult,
} from "./dominosServiceability";

const MAX_SNAPSHOT_AGE_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const MAX_PIZZA_LINES = 100;
const MAX_PIZZA_UNITS = 200;
const MAX_TOPPINGS_PER_LINE = 10;
const MAX_COMPONENT_QUANTITY = 3;
const CHECK_SOURCE = "Request-scoped Domino's live observation and exact candidate manifest";

export interface CandidateEvidenceContext {
  input: GatherBiteInput;
  candidate: DominosCandidate;
  snapshot: DominosStoreSnapshot;
  catalog: DominosCatalog;
  serviceability: DominosServiceabilityResult;
  priceEvidence: DominosPriceEvidence;
  collectedAt: string;
}

interface MenuIntegrityFacts {
  candidateStoreId: string;
  observedStoreId: string;
  candidateSnapshotVersion: string;
  observedSnapshotVersion: string;
  lineCount: number;
  pizzaUnits: number;
  referencedDealCodes: string[];
  failures: string[];
  unknowns: string[];
}

interface DietaryLineEvaluation {
  lineId: string;
  groupId: string;
  status: DietaryStatus;
  evidence: DietaryEvaluation["evidence"];
}

interface DietaryFacts {
  groups: Array<{
    groupId: string;
    requiredSlices: number;
    allocatedSlices: number;
    missingSlices: number;
  }>;
  duplicateGroupIds: string[];
  lineEvaluations: DietaryLineEvaluation[];
}

function finiteNonNegative(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sameCad(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.01;
}

function observationAge(fetchedAt: string, collectedAt: string): "CURRENT" | "STALE" | "INVALID" {
  const fetched = Date.parse(fetchedAt);
  const collected = Date.parse(collectedAt);
  if (!Number.isFinite(fetched) || !Number.isFinite(collected)) return "INVALID";
  const age = collected - fetched;
  if (age < -MAX_CLOCK_SKEW_MS || age > MAX_SNAPSHOT_AGE_MS) return "STALE";
  return "CURRENT";
}

function categoryIs(value: string | null, expected: "pizza" | "sauce" | "cheese"): boolean | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (expected === "pizza") return normalized.includes("pizza");
  return normalized === expected;
}

async function checkMenuIntegrity(context: CandidateEvidenceContext): Promise<EvidenceCheck<MenuIntegrityFacts>> {
  const { candidate, catalog, input, snapshot } = context;
  const failures: string[] = [];
  const unknowns: string[] = [];
  const observedSnapshotVersion = `${snapshot.storeId}:${snapshot.fetchedAt}`;

  if (candidate.storeId !== snapshot.storeId || candidate.storeId !== catalog.storeId) {
    failures.push("Candidate store does not match the observed store.");
  }
  if (catalog.snapshotVersion !== observedSnapshotVersion) {
    unknowns.push("The catalogue and live snapshot do not share one immutable version.");
  }
  if (candidate.snapshotVersion !== observedSnapshotVersion || candidate.snapshotVersion !== catalog.snapshotVersion) {
    failures.push("Candidate snapshot version does not match the current observation.");
  }
  if (snapshot.status !== "ok") {
    unknowns.push("The live store snapshot is incomplete.");
  }
  const freshness = observationAge(snapshot.fetchedAt, context.collectedAt);
  if (freshness !== "CURRENT") {
    unknowns.push(freshness === "STALE" ? "The live store snapshot is stale." : "Snapshot freshness could not be established.");
  }

  if (candidate.pizzas.length < 1 || candidate.pizzas.length > MAX_PIZZA_LINES) {
    failures.push(`Candidate must contain between 1 and ${MAX_PIZZA_LINES} pizza lines.`);
  }
  const pizzaUnits = candidate.pizzas.reduce(
    (sum, line) => sum + (Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0),
    0,
  );
  if (pizzaUnits < 1 || pizzaUnits > MAX_PIZZA_UNITS) {
    failures.push(`Candidate pizza quantity must total between 1 and ${MAX_PIZZA_UNITS}.`);
  }

  const seenLineIds = new Set<string>();
  const knownGroupIds = new Set(input.groups.map((group) => group.id));
  for (const line of candidate.pizzas) {
    if (seenLineIds.has(line.lineId)) failures.push(`Duplicate pizza line identifier: ${line.lineId}.`);
    seenLineIds.add(line.lineId);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_PIZZA_UNITS) {
      failures.push(`Pizza line ${line.lineId} has an out-of-bounds quantity.`);
    }
    if (line.toppings.length > MAX_TOPPINGS_PER_LINE) {
      failures.push(`Pizza line ${line.lineId} has too many topping entries.`);
    }
    if (line.purpose === "general" && line.protectsGroupIds.length > 0) {
      failures.push(`General pizza line ${line.lineId} cannot claim dietary coverage.`);
    }
    if (line.purpose === "dietary-protected" && line.protectsGroupIds.length === 0) {
      failures.push(`Dietary-protected pizza line ${line.lineId} names no dietary group.`);
    }
    for (const groupId of line.protectsGroupIds) {
      if (!knownGroupIds.has(groupId)) failures.push(`Pizza line ${line.lineId} references unknown dietary group ${groupId}.`);
    }

    const product = catalog.productsByCode.get(line.productCode);
    if (!product) {
      failures.push(`Pizza line ${line.lineId} references a product absent from the live catalogue.`);
    } else {
      const pizzaCategory = categoryIs(product.category, "pizza");
      if (pizzaCategory === false) failures.push(`Pizza line ${line.lineId} references a non-pizza product.`);
      if (pizzaCategory === null) unknowns.push(`Pizza product category is unknown for line ${line.lineId}.`);
      if (!product.variantCodes.includes(line.variantCode)) {
        failures.push(`Pizza line ${line.lineId} uses a variant not offered by its product.`);
      }
    }

    const variant = catalog.variantsByCode.get(line.variantCode);
    if (!variant) {
      failures.push(`Pizza line ${line.lineId} references a variant absent from the live catalogue.`);
    } else {
      if (variant.productCode === null) unknowns.push(`Variant product ownership is unknown for line ${line.lineId}.`);
      else if (variant.productCode !== line.productCode) failures.push(`Variant/product mismatch on line ${line.lineId}.`);
      if (variant.sizeCode === null) unknowns.push(`Variant size is unknown for line ${line.lineId}.`);
      else if (variant.sizeCode !== line.sizeCode) failures.push(`Variant/size mismatch on line ${line.lineId}.`);
      if (variant.crustCode === null) unknowns.push(`Variant crust is unknown for line ${line.lineId}.`);
      else if (variant.crustCode !== line.crustCode) failures.push(`Variant/crust mismatch on line ${line.lineId}.`);
      if (variant.trustedSlices === null) unknowns.push(`Trusted pizza slices are unknown for line ${line.lineId}.`);
      else if (variant.trustedSlices !== line.trustedSlicesPerPizza) failures.push(`Trusted slice count does not match the live variant on line ${line.lineId}.`);
    }

    const checkComponent = (code: string | null, expected: "sauce" | "cheese", label: string) => {
      if (code === null) return;
      const component = catalog.toppingsByCode.get(code);
      if (!component) {
        failures.push(`${label} code on line ${line.lineId} is absent from the live catalogue.`);
        return;
      }
      const categoryMatches = categoryIs(component.category, expected);
      if (categoryMatches === false) failures.push(`${label} code on line ${line.lineId} has the wrong live category.`);
      if (categoryMatches === null) unknowns.push(`${label} category is unknown on line ${line.lineId}.`);
    };
    checkComponent(line.sauceCode, "sauce", "Sauce");
    checkComponent(line.cheeseCode, "cheese", "Cheese");

    const seenToppings = new Set<string>();
    for (const topping of line.toppings) {
      if (seenToppings.has(topping.code)) failures.push(`Duplicate topping code on line ${line.lineId}.`);
      seenToppings.add(topping.code);
      if (!Number.isInteger(topping.quantity) || topping.quantity < 1 || topping.quantity > MAX_COMPONENT_QUANTITY) {
        failures.push(`Topping quantity is out of bounds on line ${line.lineId}.`);
      }
      if (!catalog.toppingsByCode.has(topping.code)) {
        failures.push(`Topping code on line ${line.lineId} is absent from the live catalogue.`);
      }
    }
  }

  if (candidate.dealCodes.length > MAX_PIZZA_UNITS) failures.push("Candidate references too many deal applications.");
  for (const dealCode of candidate.dealCodes) {
    const deal = catalog.dealsByCode.get(dealCode);
    if (!deal) {
      failures.push(`Deal ${dealCode} is absent from the live catalogue.`);
      continue;
    }
    const methods = deal.conditions?.split(/[,;|]/).map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
    if (methods.length === 0) unknowns.push(`Service eligibility is unknown for deal ${dealCode}.`);
    else if (!methods.includes(candidate.serviceMethod)) failures.push(`Deal ${dealCode} is not eligible for ${candidate.serviceMethod}.`);
    // The current public catalogue proves a coupon and a configurable pizza
    // independently, but exposes no exact coupon-to-variant eligibility map.
    // Do not convert name resemblance into eligibility evidence.
    unknowns.push(`Exact product and variant deal eligibility is not proven for deal ${dealCode}.`);
  }

  const facts: MenuIntegrityFacts = {
    candidateStoreId: candidate.storeId,
    observedStoreId: snapshot.storeId,
    candidateSnapshotVersion: candidate.snapshotVersion,
    observedSnapshotVersion,
    lineCount: candidate.pizzas.length,
    pizzaUnits,
    referencedDealCodes: [...candidate.dealCodes],
    failures,
    unknowns,
  };
  if (failures.length > 0) {
    return { status: "FAIL", code: "INVALID_LIVE_MENU_CONFIGURATION", summary: failures[0]!, facts, source: CHECK_SOURCE };
  }
  if (unknowns.length > 0) {
    const dealUnknown = unknowns.find((reason) => reason.toLowerCase().includes("deal eligibility"));
    return {
      status: "UNKNOWN",
      code: "MENU_CONFIGURATION_UNPROVEN",
      summary: dealUnknown ?? unknowns[0]!,
      facts,
      source: CHECK_SOURCE,
    };
  }
  return {
    status: "PASS",
    code: "LIVE_MENU_CONFIGURATION_CONFIRMED",
    summary: "Every candidate product, variant, component, and trusted slice value matches the live snapshot.",
    facts,
    source: CHECK_SOURCE,
  };
}

function configuredEvaluation(
  pizza: CandidatePizza,
  group: DietaryGroupInput,
  catalog: DominosCatalog,
): DietaryEvaluation {
  const variant = catalog.variantsByCode.get(pizza.variantCode);
  const componentName = (code: string | null) => code === null ? null : (catalog.toppingsByCode.get(code)?.name ?? code);
  return evaluateConfiguredDominosPizza({
    crustName: variant?.crustCode ?? pizza.crustCode,
    sauceName: componentName(pizza.sauceCode),
    cheeseName: componentName(pizza.cheeseCode),
    toppingNames: pizza.toppings.map(({ code }) => catalog.toppingsByCode.get(code)?.name ?? code),
  }, group.restrictions);
}

function trustedLineSlices(pizza: CandidatePizza): number {
  if (!Number.isInteger(pizza.quantity) || pizza.quantity < 1) return 0;
  if (!Number.isInteger(pizza.trustedSlicesPerPizza) || pizza.trustedSlicesPerPizza < 1) return 0;
  return pizza.quantity * pizza.trustedSlicesPerPizza;
}

async function checkDietaryCoverage(context: CandidateEvidenceContext): Promise<EvidenceCheck<DietaryFacts>> {
  const evaluationByLineAndGroup = new Map<string, DietaryEvaluation>();
  const lineEvaluations: DietaryLineEvaluation[] = [];
  for (const pizza of context.candidate.pizzas.filter((line) => line.purpose === "dietary-protected")) {
    for (const group of context.input.groups.filter(({ id }) => pizza.protectsGroupIds.includes(id))) {
      const evaluation = configuredEvaluation(pizza, group, context.catalog);
      evaluationByLineAndGroup.set(`${pizza.lineId}\u0000${group.id}`, evaluation);
      lineEvaluations.push({ lineId: pizza.lineId, groupId: group.id, status: evaluation.status, evidence: evaluation.evidence });
    }
  }

  const allocation = allocateProtectedSlices(
    context.candidate,
    context.input.groups,
    (pizza, group) => evaluationByLineAndGroup.get(`${pizza.lineId}\u0000${group.id}`)?.satisfiesAll === true,
  );
  const groups = context.input.groups.map((group, index) => {
    const allocated = allocation.groupAllocations[index]!;
    return {
      groupId: group.id,
      requiredSlices: allocated.requiredSlices,
      allocatedSlices: allocated.allocatedSlices,
      missingSlices: allocated.missingSlices,
    };
  });
  const facts: DietaryFacts = {
    groups,
    duplicateGroupIds: [...allocation.duplicateGroupIds],
    lineEvaluations,
  };

  if (allocation.duplicateGroupIds.length > 0) {
    return {
      status: "FAIL",
      code: "DUPLICATE_DIETARY_GROUP_IDS",
      summary: "Dietary coverage cannot be allocated across duplicate group identifiers.",
      facts,
      source: "Curated Domino's Canada dietary profiles and non-overlapping protected-slice allocation",
    };
  }

  const missingGroups = context.input.groups.filter((_, index) => allocation.groupAllocations[index]!.missingSlices > 0);
  if (missingGroups.length === 0) {
    return {
      status: "PASS",
      code: "DIETARY_GROUPS_COVERED",
      summary: "Every dietary group has enough distinct, deterministically compatible protected pizza slices.",
      facts,
      source: "Curated Domino's Canada dietary profiles and non-overlapping protected-slice allocation",
    };
  }

  let unresolved = false;
  for (const group of missingGroups) {
    const allocationForGroup = allocation.groups[group.id];
    const unknownPotential = context.candidate.pizzas
      .filter((pizza) => pizza.purpose === "dietary-protected" && pizza.protectsGroupIds.includes(group.id))
      .filter((pizza) => evaluationByLineAndGroup.get(`${pizza.lineId}\u0000${group.id}`)?.status === "UNKNOWN")
      .reduce((sum, pizza) => sum + trustedLineSlices(pizza), 0);
    if (allocationForGroup && allocationForGroup.allocatedSlices + unknownPotential >= allocationForGroup.requiredSlices) {
      unresolved = true;
    }
  }
  if (unresolved) {
    return {
      status: "UNKNOWN",
      code: "DIETARY_COVERAGE_UNPROVEN",
      summary: "At least one dietary group depends on an uncurated or otherwise unknown pizza component.",
      facts,
      source: "Curated Domino's Canada dietary profiles and non-overlapping protected-slice allocation",
    };
  }
  return {
    status: "FAIL",
    code: "INSUFFICIENT_DIETARY_PROTECTED_SLICES",
    summary: "At least one dietary group lacks enough distinct, deterministically compatible protected pizza slices.",
    facts,
    source: "Curated Domino's Canada dietary profiles and non-overlapping protected-slice allocation",
  };
}

async function checkCapacity(context: CandidateEvidenceContext): Promise<EvidenceCheck> {
  return checkTotalPizzaCapacity(context.candidate, context.input.attendees);
}

async function checkBudget(context: CandidateEvidenceContext): Promise<EvidenceCheck> {
  const evidence = context.priceEvidence;
  const expected = context.candidate.expectedPricing;
  const source = "Complete Domino's pricing evidence, including applicable tax and fees";
  if (evidence.status === "UNKNOWN") {
    return {
      status: "UNKNOWN",
      code: "ALL_IN_TOTAL_UNKNOWN",
      summary: "The all-in total cannot be proven because at least one required price component is unknown.",
      facts: {
        budgetCad: context.input.budgetCad,
        knownSubtotalCad: evidence.subtotalCad,
        taxCad: null,
        feesCad: null,
        totalCad: null,
      },
      source,
    };
  }
  if (observationAge(evidence.observedAt, context.collectedAt) !== "CURRENT") {
    return {
      status: "UNKNOWN",
      code: "PRICE_EVIDENCE_STALE",
      summary: "The complete price evidence is no longer current enough for approval.",
      facts: { budgetCad: context.input.budgetCad, observedAt: evidence.observedAt },
      source,
    };
  }
  const exactAmounts = [expected.subtotalCad, expected.taxCad, expected.feesCad, expected.totalCad];
  if (!exactAmounts.every(finiteNonNegative)) {
    return {
      status: "FAIL",
      code: "CANDIDATE_PRICE_INCOMPLETE",
      summary: "The candidate does not contain the complete price evidenced by the pricing observation.",
      facts: { expected, verifiedTotalCad: evidence.totalCad, budgetCad: context.input.budgetCad },
      source,
    };
  }
  if (
    !sameCad(expected.subtotalCad!, evidence.subtotalCad)
    || !sameCad(expected.taxCad!, evidence.taxCad)
    || !sameCad(expected.feesCad!, evidence.feesCad)
    || !sameCad(expected.totalCad!, evidence.totalCad)
  ) {
    return {
      status: "FAIL",
      code: "CANDIDATE_PRICE_MISMATCH",
      summary: "The candidate price does not match the complete pricing evidence.",
      facts: {
        expected,
        verified: {
          subtotalCad: evidence.subtotalCad,
          taxCad: evidence.taxCad,
          feesCad: evidence.feesCad,
          totalCad: evidence.totalCad,
        },
        budgetCad: context.input.budgetCad,
      },
      source,
    };
  }
  if (evidence.totalCad > context.input.budgetCad) {
    return {
      status: "FAIL",
      code: "BUDGET_EXCEEDED",
      summary: `The verified total of $${evidence.totalCad.toFixed(2)} exceeds the $${context.input.budgetCad.toFixed(2)} budget.`,
      facts: { budgetCad: context.input.budgetCad, verifiedTotalCad: evidence.totalCad },
      source,
    };
  }
  return {
    status: "PASS",
    code: "WITHIN_VERIFIED_BUDGET",
    summary: `The complete verified total of $${evidence.totalCad.toFixed(2)} is within budget.`,
    facts: {
      budgetCad: context.input.budgetCad,
      subtotalCad: evidence.subtotalCad,
      taxCad: evidence.taxCad,
      feesCad: evidence.feesCad,
      totalCad: evidence.totalCad,
    },
    source,
  };
}

async function checkAvailability(context: CandidateEvidenceContext): Promise<EvidenceCheck> {
  const { candidate, snapshot } = context;
  const methodAvailable = candidate.serviceMethod === "delivery" ? snapshot.deliveryAvailable : snapshot.carryoutAvailable;
  const facts = {
    isOpen: snapshot.isOpen,
    isOnlineNow: snapshot.isOnlineNow,
    serviceMethod: candidate.serviceMethod,
    methodAvailable,
    waitMinutes: candidate.serviceMethod === "delivery" ? snapshot.deliveryWaitMinutes : snapshot.carryoutWaitMinutes,
  };
  if (snapshot.isOpen === false || snapshot.isOnlineNow === false || methodAvailable === false) {
    return {
      status: "FAIL",
      code: "STORE_OR_METHOD_UNAVAILABLE",
      summary: `The store is not currently available for ${candidate.serviceMethod}.`,
      facts,
      source: "Domino's live public store profile",
    };
  }
  if (snapshot.isOpen !== true || snapshot.isOnlineNow !== true || methodAvailable !== true) {
    return {
      status: "UNKNOWN",
      code: "STORE_AVAILABILITY_UNKNOWN",
      summary: `Current store availability for ${candidate.serviceMethod} could not be proven.`,
      facts,
      source: "Domino's live public store profile",
    };
  }
  return {
    status: "PASS",
    code: "STORE_AND_METHOD_AVAILABLE",
    summary: `The store is open, online, and accepting ${candidate.serviceMethod} orders.`,
    facts,
    source: "Domino's live public store profile",
  };
}

async function checkServiceability(context: CandidateEvidenceContext): Promise<EvidenceCheck> {
  const { candidate, input, serviceability } = context;
  const intentAllowsMethod = input.serviceMethod === "either" || input.serviceMethod === candidate.serviceMethod;
  const facts = {
    requestedMethod: input.serviceMethod,
    candidateMethod: candidate.serviceMethod,
    resultStatus: serviceability.status,
    applicability: serviceability.applicability,
    candidateStoreReturned: serviceability.storeIds.includes(candidate.storeId),
  };
  if (!intentAllowsMethod) {
    return {
      status: "FAIL",
      code: "SERVICE_METHOD_OUTSIDE_ORGANIZER_INTENT",
      summary: "The candidate service method does not match the organizer's request.",
      facts,
      source: "Organizer service intent and official Domino's serviceability evidence",
    };
  }
  if (candidate.serviceMethod === "carryout") {
    return {
      status: "PASS",
      code: "CARRYOUT_SERVICEABILITY_NOT_REQUIRED",
      summary: "Address serviceability is not applicable to carryout.",
      facts,
      source: "Organizer service intent",
    };
  }
  if (serviceability.status === "UNKNOWN") {
    return {
      status: "UNKNOWN",
      code: "DELIVERY_SERVICEABILITY_UNKNOWN",
      summary: "Delivery serviceability for the selected store could not be proven.",
      facts,
      source: "Domino's official store-locator flow",
    };
  }
  if (serviceability.status === "NOT_SERVICEABLE" || !serviceability.storeIds.includes(candidate.storeId)) {
    return {
      status: "FAIL",
      code: "DELIVERY_NOT_SERVICEABLE",
      summary: "The official lookup did not prove delivery serviceability for the selected store.",
      facts,
      source: "Domino's official store-locator flow",
    };
  }
  return {
    status: "PASS",
    code: "DELIVERY_SERVICEABILITY_CONFIRMED",
    summary: "The official lookup confirms delivery serviceability for the selected store.",
    facts,
    source: "Domino's official store-locator flow",
  };
}

function toppingNames(pizza: CandidatePizza, catalog: DominosCatalog): string[] {
  return pizza.toppings.map(({ code }) => catalog.toppingsByCode.get(code)?.name.trim().toLowerCase() ?? "");
}

function representsPreference(pizza: CandidatePizza, preference: PizzaPreference, catalog: DominosCatalog): boolean {
  const names = toppingNames(pizza, catalog);
  if (preference === "cheese") return pizza.cheeseCode !== null && names.length === 0;
  if (preference === "pepperoni") return names.includes("pepperoni");
  if (preference === "veggie") {
    return names.filter((name) => ["green pepper", "green peppers", "mushroom", "mushrooms", "onion", "onions"].includes(name)).length >= 2;
  }
  return names.filter((name) => ["pepperoni", "italian sausage", "sausage", "beef crumble", "bacon strip crumble", "ham"].includes(name)).length >= 2;
}

function collectPreferenceEvidence(context: CandidateEvidenceContext): PreferenceEvidence {
  const generalPizzas = context.candidate.pizzas.filter(({ purpose }) => purpose === "general");
  const represented: PizzaPreference[] = [];
  const unmet: PreferenceEvidence["unmet"] = [];
  for (const preference of context.input.pizzaPreferences) {
    if (generalPizzas.some((pizza) => representsPreference(pizza, preference, context.catalog))) represented.push(preference);
    else unmet.push({
      preference,
      reason: generalPizzas.length === 0
        ? "No general pizza remains after dietary-protected pizzas are reserved."
        : "No general pizza deterministically represents this preference in the proposed configuration.",
    });
  }
  return { requested: [...context.input.pizzaPreferences], represented, unmet };
}

type HardCheckKey = keyof CandidateEvidenceBundle["checks"];
type SettledCheck = PromiseSettledResult<EvidenceCheck>;

function rejectedCheck(key: HardCheckKey): EvidenceCheck {
  return {
    status: "UNKNOWN",
    code: `${key.toUpperCase()}_EVIDENCE_ERROR`,
    summary: `${key} evidence could not be collected safely.`,
    facts: { check: key, error: "redacted" },
    source: "GatherBite exact evidence collector",
  };
}

/**
 * Collects six independent hard-constraint checks in parallel. It deliberately
 * does not aggregate them into an approval decision; only the separate
 * Verification Agent may return APPROVE or REJECT.
 */
export async function collectCandidateEvidence(
  context: CandidateEvidenceContext,
): Promise<CandidateEvidenceBundle> {
  const keys: HardCheckKey[] = [
    "menuIntegrity",
    "dietary",
    "capacity",
    "budget",
    "availability",
    "serviceability",
  ];
  const settled = await Promise.allSettled([
    checkMenuIntegrity(context),
    checkDietaryCoverage(context),
    checkCapacity(context),
    checkBudget(context),
    checkAvailability(context),
    checkServiceability(context),
  ]);
  const checks = Object.fromEntries(keys.map((key, index) => {
    const result = settled[index] as SettledCheck;
    return [key, result.status === "fulfilled" ? result.value : rejectedCheck(key)];
  })) as CandidateEvidenceBundle["checks"];

  let preference: PreferenceEvidence;
  try {
    preference = collectPreferenceEvidence(context);
  } catch {
    preference = {
      requested: [...context.input.pizzaPreferences],
      represented: [],
      unmet: context.input.pizzaPreferences.map((preference) => ({
        preference,
        reason: "Preference representation could not be established from the live configuration.",
      })),
    };
  }

  return {
    candidateId: context.candidate.candidateId,
    candidateVersion: context.candidate.candidateVersion,
    snapshotVersion: context.candidate.snapshotVersion,
    checks,
    preference,
    collectedAt: context.collectedAt,
  };
}
