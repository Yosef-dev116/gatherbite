export type Restriction =
  | "vegetarian"
  | "vegan"
  | "glutenFriendly"
  | "dairyFree"
  | "noPork"
  | "noBeef"
  | "noChicken"
  | "noEgg"
  | "noSoy"
  | "noMustard";

export const ALL_RESTRICTIONS: Restriction[] = [
  "vegetarian",
  "vegan",
  "glutenFriendly",
  "dairyFree",
  "noPork",
  "noBeef",
  "noChicken",
  "noEgg",
  "noSoy",
  "noMustard",
];

export const RESTRICTION_LABELS: Record<Restriction, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  glutenFriendly: "Gluten-Friendly",
  dairyFree: "Dairy-Free",
  noPork: "No Pork",
  noBeef: "No Beef",
  noChicken: "No Chicken",
  noEgg: "No Egg",
  noSoy: "No Soy",
  noMustard: "No Mustard",
};

export interface DietaryGroupInput {
  id: string;
  people: number;
  restrictions: Restriction[];
  notes?: string;
}

export interface BuildOrderInput {
  attendees: number;
  budget: number;
  storeId: string;
  groups: DietaryGroupInput[];
}

/** A menu item as parsed from the trusted store JSON snapshot. */
export interface MenuItem {
  id: string;
  name: string;
  category: string;
  priceCad: number;
  slices: number;
  isBundle: boolean;
  description: string;
}

export interface PlanLine {
  itemId: string;
  quantity: number;
}

export type VerifyFailureCode =
  | "INSUFFICIENT_TOTAL_SLICES"
  | "DIETARY_COVERAGE_FAILED"
  | "DIETARY_COVERAGE_IMPOSSIBLE"
  | "BUDGET_EXCEEDED"
  | "INVALID_ITEM_REFERENCE";

export interface VerifyFailure {
  code: VerifyFailureCode;
  message: string;
  groupId?: string;
}

export interface GroupCoverage {
  groupId: string;
  restrictions: Restriction[];
  peopleCount: number;
  requiredSlices: number;
  providedSlices: number;
  satisfied: boolean;
  impossible: boolean;
}

export interface VerifyTotals {
  totalSlices: number;
  requiredSlices: number;
  subtotalCad: number;
  feesCad: number;
  totalCad: number;
  budgetCad: number;
  remainingBudgetCad: number;
}

export interface VerifyResult {
  verified: boolean;
  failures: VerifyFailure[];
  totals: VerifyTotals;
  groupCoverage: GroupCoverage[];
  bundlesUsed: string[];
}

export interface OrderLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPriceCad: number;
  lineTotalCad: number;
  slices: number;
  /** True only for an optional buffer line added client-side after
   * verification — never set by the agent's own baseline order. */
  isBuffer?: boolean;
}

export interface StepEvent {
  label: string;
  kind: "info" | "success" | "failure";
}

/** Only produced when the blocker is specifically budget: a
 * dietary-safe, slice-sufficient plan exists, it just costs more than
 * the current budget. Never produced for dietary-impossible cases. */
export interface BudgetSuggestion {
  minimumWorkableBudgetCad: number;
  shortfallCad: number;
}

/** A real, whole menu item — never an invented individual-slice product. */
export interface BufferExtraItem {
  itemId: string;
  name: string;
  slices: number;
}

/** Optional post-verification safety buffer. Purely informational: it
 * never changes the VERIFIED order it was computed from. */
export interface FoodBuffer {
  bufferSlices: number;
  isSmallBuffer: boolean;
  extraItem: BufferExtraItem | null;
  additionalCostCad: number;
  newRemainingBudgetCad: number;
  fitsBudget: boolean;
  overBudgetByCad: number;
}

export interface BuildOrderResult {
  steps: StepEvent[];
  verified: boolean;
  order: OrderLine[] | null;
  verification: VerifyResult | null;
  attempts: number;
  budgetSuggestion: BudgetSuggestion | null;
  foodBuffer: FoodBuffer | null;
}
