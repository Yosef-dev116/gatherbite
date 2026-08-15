import { verifyPlan } from "./verify";
import { recordAgentVerification, shouldStopAgentLoop } from "./agent-loop";
import type { AgentLoopState } from "./agent-loop";
import { linesToOrderLines } from "./scoring";
import {
  buildDominosRequirements,
  normalizeDominos,
  normalizeGatherBiteResults,
  normalizeLittleCaesars,
} from "./gatherbite";
import { classifyDominosStore, compareDominosStores, describeDominosTradeoff } from "./restaurants/dominosCompare";
import type { BuildOrderInput, BuildOrderResult, PlanLine } from "./types";
import type { DominosStoreSnapshot } from "./restaurants/dominos";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    console.error(`  FAIL - ${name}`);
  }
}

function snapshot(overrides: Partial<DominosStoreSnapshot> = {}): DominosStoreSnapshot {
  return {
    provider: "dominos",
    storeId: "10950",
    address: "386 University Ave, Charlottetown, PE",
    isOpen: true,
    isOnlineNow: true,
    deliveryAvailable: true,
    carryoutAvailable: true,
    deliveryWaitMinutes: { min: 18, max: 28 },
    carryoutWaitMinutes: { min: 11, max: 16 },
    deals: [
      {
        code: "3021",
        name: "1 Medium 2 Topping Pizza",
        price: 14.99,
        conditions: "Carryout,Delivery",
        slices: 8,
      },
    ],
    products: [],
    fetchedAt: "2026-08-14T12:00:00.000Z",
    status: "ok",
    errors: [],
    ...overrides,
  };
}

function littleCaesarsResult(input: BuildOrderInput, lines: PlanLine[]): BuildOrderResult {
  const verification = verifyPlan(lines, input);
  return {
    steps: [
      { label: "Candidate sent to deterministic verification", kind: "info" },
      { label: verification.verified ? "Candidate verified" : "Candidate rejected", kind: verification.verified ? "success" : "failure" },
    ],
    verified: verification.verified,
    order: linesToOrderLines(lines),
    verification,
    attempts: 1,
    budgetSuggestion: null,
    foodBuffer: null,
  };
}

console.log("Scenario 1: existing Little Caesars verification survives normalization");
{
  const input: BuildOrderInput = { attendees: 8, budget: 100, storeId: "10088", groups: [] };
  const result = littleCaesarsResult(input, [{ itemId: "classic-pepperoni-p37", quantity: 3 }]);
  const normalized = normalizeLittleCaesars(result, input);
  check("the original deterministic verifier still passes", result.verified === true);
  check("a verified Little Caesars plan normalizes as viable", normalized.status === "viable");
  check("capacity, dietary, and budget remain required passes", normalized.checks.capacity.status === "pass" && normalized.checks.dietary.status === "pass" && normalized.checks.budget.status === "pass");
  check("Little Caesars wait is unknown rather than fabricated", normalized.waits.delivery === null && normalized.waits.carryout === null);
  check("Little Caesars live availability is explicitly unknown", normalized.checks.availability.status === "unknown");
}

console.log("Scenario 2: real Restriction[] values are passed into Domino's requirements");
{
  const input: BuildOrderInput = {
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [
      { id: "g1", people: 2, restrictions: ["vegetarian", "noPork"] },
      { id: "g2", people: 1, restrictions: ["noPork", "noChicken"] },
    ],
  };
  const requirements = buildDominosRequirements(input);
  check("Domino's receives structured restrictions, not hasDietaryGroups", requirements.hasDietaryGroups === undefined);
  check("all requested restrictions are passed through and deduplicated", JSON.stringify(requirements.dietaryRestrictions) === JSON.stringify(["vegetarian", "noPork", "noChicken"]));
  check("the shared people and budget inputs are unchanged", requirements.people === 12 && requirements.budget === 100);
}

console.log("Scenario 3: a genuinely viable Domino's result normalizes correctly");
{
  const store = snapshot();
  const requirements = { people: 6, budget: 100, servicePreference: "delivery" as const, dietaryRestrictions: ["vegetarian" as const] };
  const comparison = classifyDominosStore(store, requirements);
  const normalized = normalizeDominos(store, comparison, requirements);
  check("the engine classifies dietary + capacity + budget as fully viable", comparison.classification === "FULLY_VIABLE");
  check("FULLY_VIABLE maps to viable", normalized.status === "viable");
  check("real estimated total is retained", normalized.estimatedTotalCad === 44.97);
  check("live delivery and carryout waits are retained", normalized.waits.delivery?.max === 28 && normalized.waits.carryout?.max === 16);
  check("all deterministic requirement checks pass", normalized.checks.dietary.status === "pass" && normalized.checks.capacity.status === "pass" && normalized.checks.budget.status === "pass");
}

console.log("Scenario 4: rejected and unknown Domino's outcomes retain honest reasons");
{
  const overBudgetStore = snapshot({ deals: [{ code: "X", name: "1 Medium 2 Topping Pizza", price: 50, conditions: "Delivery", slices: 8 }] });
  const requirements = { people: 6, budget: 20, servicePreference: "delivery" as const, dietaryRestrictions: ["vegetarian" as const] };
  const rejected = classifyDominosStore(overBudgetStore, requirements);
  const normalizedRejected = normalizeDominos(overBudgetStore, rejected, requirements);
  check("an over-budget result is not viable", normalizedRejected.status === "not-viable" && normalizedRejected.checks.budget.status === "fail");
  check("the concrete over-budget reason is retained", normalizedRejected.reason === rejected.reason && normalizedRejected.reason!.includes("20.00"));

  const failedStore = snapshot({ status: "failed", errors: ["Profile fetch failed: timed out"], deals: [] });
  const unknown = classifyDominosStore(failedStore, requirements);
  const normalizedUnknown = normalizeDominos(failedStore, unknown, requirements);
  check("failed live data remains insufficient-data", normalizedUnknown.status === "insufficient-data");
  check("the real fetch failure remains visible", normalizedUnknown.reason?.includes("timed out") === true);
}

console.log("Scenario 5: missing provider-specific values remain unknown");
{
  const input: BuildOrderInput = { attendees: 8, budget: 100, storeId: "10088", groups: [] };
  const missing = normalizeLittleCaesars(null, input, "Planner unavailable for test.");
  check("missing Little Caesars result is insufficient-data", missing.status === "insufficient-data");
  check("missing price is null, not zero", missing.estimatedTotalCad === null);
  check("missing wait and capacity stay unknown", missing.waits.delivery === null && missing.checks.capacity.status === "unknown");
  check("the provider error is retained", missing.reason === "Planner unavailable for test.");
}

console.log("Scenario 6: multiple valid options remain visible");
{
  const input: BuildOrderInput = { attendees: 8, budget: 120, storeId: "10088", groups: [] };
  const lcResult = littleCaesarsResult(input, [{ itemId: "classic-pepperoni-p37", quantity: 3 }]);
  const stores = [snapshot({ storeId: "10950" }), snapshot({ storeId: "10953", deliveryWaitMinutes: { min: 14, max: 20 } })];
  const requirements = buildDominosRequirements(input);
  const comparisons = compareDominosStores(stores, requirements);
  const tradeoff = describeDominosTradeoff(comparisons);
  const normalized = normalizeGatherBiteResults(input, lcResult, undefined, stores, comparisons, tradeoff);
  check("all three restaurant/store choices are returned", normalized.options.length === 3);
  check("all valid options remain visible instead of one artificial winner", normalized.options.every((option) => option.status === "viable"));
}

console.log("Scenario 7: dietary + capacity + budget must all pass");
{
  const requirements = { people: 6, budget: 100, servicePreference: "delivery" as const, dietaryRestrictions: ["vegetarian" as const] };
  check("all three gates can produce FULLY_VIABLE", classifyDominosStore(snapshot(), requirements).classification === "FULLY_VIABLE");
  check("unknown capacity cannot pass", classifyDominosStore(snapshot({ deals: [{ code: "X", name: "1 Medium 2 Topping Pizza", price: 14.99, conditions: "Delivery", slices: null }] }), requirements).classification !== "FULLY_VIABLE");
  check("over budget cannot pass", classifyDominosStore(snapshot({ deals: [{ code: "X", name: "1 Medium 2 Topping Pizza", price: 50, conditions: "Delivery", slices: 8 }] }), { ...requirements, budget: 20 }).classification !== "FULLY_VIABLE");
  check("unproven dietary compatibility cannot pass", classifyDominosStore(snapshot(), { ...requirements, dietaryRestrictions: ["vegan"] }).classification === "INSUFFICIENT_DIETARY_DATA");
  check("unknown requested-method availability cannot pass", classifyDominosStore(snapshot({ deliveryAvailable: null }), requirements).classification === "INSUFFICIENT_UNKNOWN_DATA");
}

console.log("Scenario 8: fail-closed UNKNOWN behavior survives presentation normalization");
{
  const store = snapshot({ deals: [{ code: "F", name: "1 Medium Feast Pizza", price: 14.99, conditions: "Delivery", slices: 8 }] });
  const requirements = { people: 6, budget: 100, servicePreference: "delivery" as const, dietaryRestrictions: ["vegetarian" as const] };
  const comparison = classifyDominosStore(store, requirements);
  const normalized = normalizeDominos(store, comparison, requirements);
  check("fixed-recipe dietary evidence fails closed", comparison.classification === "INSUFFICIENT_DIETARY_DATA");
  check("normalization does not upgrade UNKNOWN to a rejection or a pass", normalized.status === "insufficient-data" && normalized.checks.dietary.status === "unknown");
  check("no estimated price is invented after fail-closed dietary filtering", normalized.estimatedTotalCad === null);
}

console.log("Scenario 9: preference and final-review data normalize honestly");
{
  const input: BuildOrderInput = {
    attendees: 6,
    budget: 100,
    storeId: "10088",
    groups: [],
    pizzaPreferences: ["pepperoni"],
  };
  const lcResult = littleCaesarsResult(input, [{ itemId: "classic-pepperoni-p37", quantity: 3 }]);
  const normalizedLc = normalizeLittleCaesars(lcResult, input);
  check("Little Caesars reports a preference only when a general line represents it", normalizedLc.preference.status === "represented" && normalizedLc.preference.represented.includes("pepperoni"));
  check("Little Caesars exposes the existing real restaurant destination", normalizedLc.externalOrderUrl?.includes("order.littlecaesars.ca") === true);
  check("review data retains exact item and unit/line prices", normalizedLc.orderItems[0].itemId === "classic-pepperoni-p37" && normalizedLc.orderItems[0].unitPriceCad === 7.99 && normalizedLc.orderItems[0].lineTotalCad === 23.97);

  const store = snapshot();
  const requirements = buildDominosRequirements(input);
  const comparison = classifyDominosStore(store, requirements);
  const normalizedDominos = normalizeDominos(store, comparison, requirements, input.pizzaPreferences);
  check("a customizable Domino's deal carries the preference as a request, not a verified topping claim", normalizedDominos.preference.status === "customizable" && normalizedDominos.preference.represented.length === 0);
  check("Domino's has no invented customer ordering destination", normalizedDominos.externalOrderUrl === null);
  check("Domino's review data retains the exact live deal price and capacity", normalizedDominos.orderItems[0].unitPriceCad === 14.99 && normalizedDominos.orderItems[0].totalSlices === 24);
}

console.log("Scenario 10: the agent stops only at deterministic terminal boundaries");
{
  const input: BuildOrderInput = { attendees: 8, budget: 100, storeId: "10088", groups: [] };
  const state: AgentLoopState = {
    verifyAttempts: 0,
    hasVerifiedCandidate: false,
    hasTerminalImpossibleResult: false,
  };

  recordAgentVerification(state, verifyPlan([{ itemId: "classic-pepperoni-p37", quantity: 1 }], input));
  check("an adaptable failed candidate keeps the retry loop open", !shouldStopAgentLoop(state));

  recordAgentVerification(state, verifyPlan([{ itemId: "classic-pepperoni-p37", quantity: 3 }], input));
  check("a deterministically verified candidate stops unused model work", shouldStopAgentLoop(state));

  check(
    "the three-attempt contract is enforced even without success",
    shouldStopAgentLoop({ verifyAttempts: 3, hasVerifiedCandidate: false, hasTerminalImpossibleResult: false })
  );
  const impossibleState: AgentLoopState = {
    verifyAttempts: 0,
    hasVerifiedCandidate: false,
    hasTerminalImpossibleResult: false,
  };
  recordAgentVerification(
    impossibleState,
    verifyPlan(
      [{ itemId: "classic-cheese-p38", quantity: 2 }],
      {
        attendees: 4,
        budget: 100,
        storeId: "10088",
        groups: [{ id: "vegan", people: 1, restrictions: ["vegan"] }],
      }
    )
  );
  check(
    "a deterministic impossible result stops retries immediately",
    impossibleState.hasTerminalImpossibleResult && shouldStopAgentLoop(impossibleState)
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
