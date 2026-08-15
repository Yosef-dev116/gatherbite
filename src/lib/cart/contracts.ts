import type { DominosCandidate, GatherBiteInput } from "../gatherbite/contracts";

/**
 * Outcome states for one attempt to turn an approved `DominosCandidate` into
 * an actual official Domino's cart. Only `DominosCartExecutor.prepare`
 * (implemented in a later task) produces a `CartPreparationResult`; this
 * module only defines the contract it must satisfy. None of the types here
 * grant verification authority — only the separate Verification Agent may
 * APPROVE/REJECT a candidate.
 */
export type CartPreparationStatus =
  | "PREPARED_AND_OBSERVED"
  | "PREPARED_AND_VERIFIED"
  | "NEEDS_HUMAN_CAPTCHA"
  | "NEEDS_HUMAN_LOGIN"
  | "CART_MISMATCH"
  | "SESSION_NOT_TRANSFERABLE"
  | "AUTOMATION_UNAVAILABLE"
  | "TIMED_OUT"
  | "FALLBACK_READY";

export interface ActualCartItem {
  productCode: string | null;
  variantCode: string | null;
  quantity: number;
  sizeCode: string | null;
  crustCode: string | null;
  sauceCode: string | null;
  cheeseCode: string | null;
  toppings: Array<{ code: string; quantity: number }>;
}

export interface ActualDominosCart {
  storeId: string | null;
  serviceMethod: "delivery" | "carryout" | null;
  items: ActualCartItem[];
  couponCodes: string[];
  subtotalCad: number | null;
  taxCad: number | null;
  feesCad: number | null;
  totalCad: number | null;
  observedAt: string;
}

/** Every independently checked field a strict cart comparison can disagree on. */
export type CartMismatchField =
  | "store"
  | "method"
  | "coupon"
  | "capacity"
  | "subtotal"
  | "tax"
  | "fee"
  | "total"
  | "product"
  | "variant"
  | "quantity"
  | "size"
  | "crust"
  | "sauce"
  | "cheese"
  | "topping"
  | "dietary";

/**
 * One field-level discrepancy between an approved candidate and an actual
 * observed cart. `lineId` identifies the expected candidate pizza line when
 * the mismatch is line-scoped, and is `null` for cart-level fields (store,
 * method, coupon, pricing, aggregate capacity).
 */
export interface CartMismatch {
  field: CartMismatchField;
  lineId: string | null;
  message: string;
  expected: unknown;
  actual: unknown;
}

/**
 * Strict, deterministic result of comparing an approved `DominosCandidate`
 * against an `ActualDominosCart`. This is a protocol check, not
 * verification authority: it can report a mismatch, but it never approves
 * or rejects a candidate.
 */
export interface CartComparison {
  matches: boolean;
  mismatches: CartMismatch[];
}

/**
 * The manual, non-purchasing order guide an organizer follows when no
 * actual official cart could be prepared and observed. It must never claim
 * a cart was prepared, and must never claim the official URL is preloaded
 * with store, address, or cart state — only
 * `https://www.dominos.ca/en/pages/order/?route=1` was proven to work, with
 * no persisted query parameters.
 */
export interface GuidedOrderHandoff {
  officialUrl: string;
  lines: string[];
  itemLines: string[];
  remainingActions: string[];
  completeCopyText: string;
}

export interface PrepareCartInput {
  candidate: DominosCandidate;
  organizerInput: GatherBiteInput;
}

export interface CartPreparationResult {
  status: CartPreparationStatus;
  actualCart: ActualDominosCart | null;
  comparison: CartComparison | null;
  handoffUrl: string | null;
  fallback: GuidedOrderHandoff;
  reason: string | null;
}

/** Implemented by a later task; this file only defines the contract it must satisfy. */
export interface DominosCartExecutor {
  prepare(input: PrepareCartInput): Promise<CartPreparationResult>;
}
