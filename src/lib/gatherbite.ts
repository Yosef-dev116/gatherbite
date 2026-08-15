import { PIZZA_PREFERENCE_LABELS, RESTRICTION_LABELS } from "./types";
import type { BuildOrderInput, BuildOrderResult, PizzaPreference, Restriction, StepEvent } from "./types";
import { LITTLE_CAESARS_ORDER_URL } from "./menu";
import { scoreGeneralPreferenceAlignment } from "./scoring";
import type { DominosStoreSnapshot, WaitMinutes } from "./restaurants/dominos";
import { isCustomizableToppingDeal } from "./restaurants/dominosDietary";
import type {
  DominosComparisonRequirements,
  DominosComparisonResult,
  DominosTradeoff,
  ServiceMethodPreference,
} from "./restaurants/dominosCompare";

export type ProviderResultStatus = "viable" | "not-viable" | "insufficient-data";
export type ProviderCheckStatus = "pass" | "fail" | "unknown";

export interface ProviderCheck {
  status: ProviderCheckStatus;
  detail: string;
}

export interface ProviderOrderItem {
  itemId: string;
  name: string;
  quantity: number;
  unitPriceCad: number | null;
  totalSlices: number | null;
  lineTotalCad: number | null;
}

export type ProviderPreferenceStatus = "not-requested" | "represented" | "customizable" | "unconfirmed";

export interface ProviderPreferenceResult {
  status: ProviderPreferenceStatus;
  requested: PizzaPreference[];
  represented: PizzaPreference[];
  detail: string;
}

export interface ProviderOption {
  id: string;
  provider: "little-caesars" | "dominos";
  restaurant: string;
  storeId: string;
  address: string | null;
  status: ProviderResultStatus;
  reason: string | null;
  estimatedTotalCad: number | null;
  orderItems: ProviderOrderItem[];
  checks: {
    capacity: ProviderCheck;
    dietary: ProviderCheck;
    budget: ProviderCheck;
    availability: ProviderCheck;
  };
  waits: {
    delivery: WaitMinutes | null;
    carryout: WaitMinutes | null;
  };
  fulfillmentMethod: "delivery";
  preference: ProviderPreferenceResult;
  externalOrderUrl: string | null;
  verificationEvents: StepEvent[];
}

export interface GatherBiteResult {
  options: ProviderOption[];
  requestedRestrictions: Restriction[];
  requestedPizzaPreferences: PizzaPreference[];
  dominosTradeoff: DominosTradeoff;
  littleCaesarsResult: BuildOrderResult | null;
}

function preferenceLabels(preferences: PizzaPreference[]): string {
  return preferences.map((preference) => PIZZA_PREFERENCE_LABELS[preference]).join(", ");
}

function noPreferenceResult(): ProviderPreferenceResult {
  return {
    status: "not-requested",
    requested: [],
    represented: [],
    detail: "No soft pizza preferences were requested.",
  };
}

function check(status: ProviderCheckStatus, detail: string): ProviderCheck {
  return { status, detail };
}

function restrictionsText(restrictions: Restriction[]): string {
  return restrictions.map((restriction) => RESTRICTION_LABELS[restriction]).join(", ");
}

/**
 * Converts the original group input into the exact structured restriction
 * list the Domino's deterministic verifier accepts. No boolean dietary
 * shortcut is used in the unified flow.
 */
export function collectRestrictions(input: Pick<BuildOrderInput, "groups">): Restriction[] {
  const seen = new Set<Restriction>();
  for (const group of input.groups) {
    for (const restriction of group.restrictions) seen.add(restriction);
  }
  return [...seen];
}

export function buildDominosRequirements(
  input: Pick<BuildOrderInput, "attendees" | "budget" | "groups">,
  servicePreference: ServiceMethodPreference = "delivery"
): DominosComparisonRequirements {
  return {
    people: input.attendees,
    budget: input.budget,
    servicePreference,
    dietaryRestrictions: collectRestrictions(input),
  };
}

function littleCaesarsUnknown(input: BuildOrderInput, reason: string): ProviderOption {
  const preferences = input.pizzaPreferences ?? [];
  return {
    id: `little-caesars-${input.storeId}`,
    provider: "little-caesars",
    restaurant: "Little Caesars",
    storeId: input.storeId,
    address: null,
    status: "insufficient-data",
    reason,
    estimatedTotalCad: null,
    orderItems: [],
    checks: {
      capacity: check("unknown", "No completed deterministic capacity check is available."),
      dietary: check("unknown", "No completed deterministic dietary check is available."),
      budget: check("unknown", "No completed deterministic budget check is available."),
      availability: check("unknown", "Live store availability is not available from this provider data."),
    },
    waits: { delivery: null, carryout: null },
    fulfillmentMethod: "delivery",
    preference: preferences.length === 0
      ? noPreferenceResult()
      : {
          status: "unconfirmed",
          requested: preferences,
          represented: [],
          detail: "The planner did not return an order, so preference representation is unknown.",
        },
    externalOrderUrl: LITTLE_CAESARS_ORDER_URL,
    verificationEvents: [
      { label: "Little Caesars evaluation unavailable", kind: "failure", detail: reason },
    ],
  };
}

export function normalizeLittleCaesars(
  result: BuildOrderResult | null,
  input: BuildOrderInput,
  unavailableReason = "The Little Caesars planning agent did not return a result."
): ProviderOption {
  if (!result) return littleCaesarsUnknown(input, unavailableReason);

  const verification = result.verification;
  const hasInvalidReference = verification?.failures.some((failure) => failure.code === "INVALID_ITEM_REFERENCE") ?? false;
  const capacityFailed = verification?.failures.some((failure) => failure.code === "INSUFFICIENT_TOTAL_SLICES") ?? false;
  const budgetFailed = verification?.failures.some((failure) => failure.code === "BUDGET_EXCEEDED") ?? false;
  const dietaryFailed =
    verification?.failures.some(
      (failure) =>
        failure.code === "DIETARY_COVERAGE_FAILED" || failure.code === "DIETARY_COVERAGE_IMPOSSIBLE"
    ) ?? false;

  const status: ProviderResultStatus = result.verified
    ? "viable"
    : verification
      ? "not-viable"
      : "insufficient-data";
  const reason = result.verified
    ? null
    : verification?.failures.map((failure) => failure.message).join(" ") ||
      "No Little Caesars candidate completed deterministic verification.";

  const capacity = !verification || hasInvalidReference
    ? check("unknown", "Capacity could not be confirmed from a valid candidate.")
    : capacityFailed
      ? check(
          "fail",
          `${verification.totals.totalSlices} slices provided; ${verification.totals.requiredSlices} required.`
        )
      : check(
          "pass",
          `${verification.totals.totalSlices} slices provided; ${verification.totals.requiredSlices} required.`
        );

  const dietary = input.groups.length === 0
    ? check("pass", "No dietary restrictions were requested.")
    : !verification || hasInvalidReference
      ? check("unknown", "Dietary coverage could not be checked against a valid candidate.")
      : dietaryFailed
        ? check("fail", "At least one dietary group lacks enough deterministically verified-safe food.")
        : check("pass", `Verified against the curated Little Caesars menu for ${restrictionsText(collectRestrictions(input))}.`);

  const budget = !verification || hasInvalidReference
    ? check("unknown", "The total could not be confirmed from a valid candidate.")
    : budgetFailed
      ? check("fail", `$${verification.totals.totalCad.toFixed(2)} exceeds the $${input.budget.toFixed(2)} budget.`)
      : check("pass", `$${verification.totals.totalCad.toFixed(2)} is within the $${input.budget.toFixed(2)} budget.`);
  const preferences = input.pizzaPreferences ?? [];
  const alignment = scoreGeneralPreferenceAlignment(
    (result.order ?? []).map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
    preferences,
    input.groups
  );
  const preference: ProviderPreferenceResult = preferences.length === 0
    ? noPreferenceResult()
    : alignment.represented.length > 0
      ? {
          status: "represented",
          requested: preferences,
          represented: alignment.represented,
          detail: `${preferenceLabels(alignment.represented)} represented in general order lines. Dietary-coverage lines were excluded from preference scoring.`,
        }
      : {
          status: "unconfirmed",
          requested: preferences,
          represented: [],
          detail: "No requested preference was confirmed in general order lines. The verified order was not invalidated.",
        };

  return {
    id: `little-caesars-${input.storeId}`,
    provider: "little-caesars",
    restaurant: "Little Caesars",
    storeId: input.storeId,
    address: null,
    status,
    reason,
    estimatedTotalCad: verification?.totals.totalCad ?? null,
    orderItems: (result.order ?? []).map((line) => ({
      itemId: line.itemId,
      name: line.name,
      quantity: line.quantity,
      unitPriceCad: line.unitPriceCad,
      totalSlices: line.slices,
      lineTotalCad: line.lineTotalCad,
    })),
    checks: {
      capacity,
      dietary,
      budget,
      availability: check("unknown", "Live store availability is not available from this provider data."),
    },
    waits: { delivery: null, carryout: null },
    fulfillmentMethod: "delivery",
    preference,
    externalOrderUrl: LITTLE_CAESARS_ORDER_URL,
    verificationEvents: result.steps,
  };
}

function dominosAvailability(snapshot: DominosStoreSnapshot): ProviderCheck {
  if (snapshot.isOpen === false || snapshot.isOnlineNow === false || snapshot.deliveryAvailable === false) {
    return check("fail", "The store is closed, offline, or not accepting delivery orders.");
  }
  if (snapshot.isOpen === true && snapshot.isOnlineNow === true && snapshot.deliveryAvailable === true) {
    return check("pass", "Live status confirms the store is open, online, and accepting delivery orders.");
  }
  return check("unknown", "Live delivery availability could not be fully confirmed.");
}

export function normalizeDominos(
  snapshot: DominosStoreSnapshot,
  result: DominosComparisonResult,
  requirements: DominosComparisonRequirements,
  preferences: PizzaPreference[] = []
): ProviderOption {
  const restrictions = requirements.dietaryRestrictions ?? [];
  const availability = dominosAvailability(snapshot);
  const status: ProviderResultStatus = result.classification === "FULLY_VIABLE"
    ? "viable"
    : result.classification === "VIABLE_BUT_OVER_BUDGET" || result.classification === "CLOSED_OR_UNAVAILABLE"
      ? "not-viable"
      : "insufficient-data";

  const capacity = result.dealUsed
    ? check(
        "pass",
        `${result.dealUsed.totalSlices} trusted pizza slices cover the ${requirements.people * 3}-slice requirement.`
      )
    : check("unknown", "No dietary-compatible live deal with trusted slice capacity was confirmed.");
  const dietary = restrictions.length === 0
    ? check("pass", "No dietary restrictions were requested.")
    : result.dealUsed
      ? check("pass", `The selected customizable deal passed deterministic checks for ${restrictionsText(restrictions)}.`)
      : check("unknown", "The requested restrictions could not all be proven from curated Domino's dietary data.");
  const budget = result.estimatedTotalCad === null
    ? check("unknown", "No trustworthy sufficient-order total is available.")
    : result.classification === "VIABLE_BUT_OVER_BUDGET"
      ? check("fail", `$${result.estimatedTotalCad.toFixed(2)} exceeds the $${requirements.budget.toFixed(2)} budget.`)
      : check("pass", `$${result.estimatedTotalCad.toFixed(2)} is within the $${requirements.budget.toFixed(2)} budget.`);
  const dealName = result.dealUsed?.name ?? "";
  const explicitlyRepresented = preferences.filter((preference) => {
    if (preference === "cheese") return /cheese/i.test(dealName);
    if (preference === "pepperoni") return /pepperoni/i.test(dealName);
    if (preference === "veggie") return /veggie|vegetable/i.test(dealName);
    return /3\s*meat|meat\s*(lover|treat)|ultimate\s*supreme/i.test(dealName);
  });
  const preference: ProviderPreferenceResult = preferences.length === 0
    ? noPreferenceResult()
    : explicitlyRepresented.length > 0
      ? {
          status: "represented",
          requested: preferences,
          represented: explicitlyRepresented,
          detail: `${preferenceLabels(explicitlyRepresented)} appears explicitly in the live deal name.`,
        }
      : result.dealUsed && isCustomizableToppingDeal(result.dealUsed.name)
        ? {
            status: "customizable",
            requested: preferences,
            represented: [],
            detail: `Request ${preferenceLabels(preferences)} while configuring this customizable deal at Domino's; the live comparison does not claim those toppings are already selected.`,
          }
        : {
            status: "unconfirmed",
            requested: preferences,
            represented: [],
            detail: "The live deal data does not confirm that the requested pizza preferences are represented.",
          };

  const events: StepEvent[] = [
    {
      label: result.dealUsed ? `Candidate considered: ${result.dealUsed.quantity} × ${result.dealUsed.name}` : "Live store candidate considered",
      kind: "info",
    },
    {
      label: "Live availability check",
      kind: availability.status === "pass" ? "success" : availability.status === "fail" ? "failure" : "info",
      detail: availability.detail,
    },
    {
      label: "Deterministic dietary check",
      kind: dietary.status === "pass" ? "success" : dietary.status === "fail" ? "failure" : "info",
      detail: dietary.detail,
    },
    {
      label: "Deterministic pizza-capacity check",
      kind: capacity.status === "pass" ? "success" : capacity.status === "fail" ? "failure" : "info",
      detail: capacity.detail,
    },
    {
      label: "Deterministic budget check",
      kind: budget.status === "pass" ? "success" : budget.status === "fail" ? "failure" : "info",
      detail: budget.detail,
    },
    {
      label: status === "viable" ? "Verified option" : status === "not-viable" ? "Candidate rejected" : "Verification stopped: insufficient data",
      kind: status === "viable" ? "success" : status === "not-viable" ? "failure" : "info",
      detail: result.reason ?? budget.detail,
    },
  ];

  return {
    id: `dominos-${snapshot.storeId}`,
    provider: "dominos",
    restaurant: "Domino's",
    storeId: snapshot.storeId,
    address: snapshot.address,
    status,
    reason: result.reason,
    estimatedTotalCad: result.estimatedTotalCad,
    orderItems: result.dealUsed
      ? [{
          itemId: result.dealUsed.code,
          name: result.dealUsed.name,
          quantity: result.dealUsed.quantity,
          unitPriceCad: result.dealUsed.price,
          totalSlices: result.dealUsed.totalSlices,
          lineTotalCad: result.estimatedTotalCad,
        }]
      : [],
    checks: { capacity, dietary, budget, availability },
    waits: {
      delivery: snapshot.deliveryWaitMinutes,
      carryout: snapshot.carryoutWaitMinutes,
    },
    fulfillmentMethod: "delivery",
    preference,
    externalOrderUrl: null,
    verificationEvents: events,
  };
}

export function normalizeGatherBiteResults(
  input: BuildOrderInput,
  littleCaesarsResult: BuildOrderResult | null,
  littleCaesarsUnavailableReason: string | undefined,
  snapshots: DominosStoreSnapshot[],
  dominosResults: DominosComparisonResult[],
  dominosTradeoff: DominosTradeoff
): GatherBiteResult {
  const requirements = buildDominosRequirements(input);
  const dominosOptions = snapshots.map((snapshot, index) =>
    normalizeDominos(snapshot, dominosResults[index], requirements, input.pizzaPreferences ?? [])
  );

  return {
    options: [
      normalizeLittleCaesars(littleCaesarsResult, input, littleCaesarsUnavailableReason),
      ...dominosOptions,
    ],
    requestedRestrictions: requirements.dietaryRestrictions ?? [],
    requestedPizzaPreferences: input.pizzaPreferences ?? [],
    dominosTradeoff,
    littleCaesarsResult,
  };
}
