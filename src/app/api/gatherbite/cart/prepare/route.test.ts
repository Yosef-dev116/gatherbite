import assert from "node:assert/strict";
import test from "node:test";

import { buildGuidedHandoff } from "@/lib/cart/dominosCartFallback";
import type { CartPreparationResult } from "@/lib/cart/contracts";
import {
  DominosCandidateSchema,
  GatherBiteInputSchema,
  MAX_IDENTIFIER_CHARS,
  MAX_MENU_CODE_CHARS,
  type DominosCandidate,
  type GatherBiteInput,
} from "@/lib/gatherbite/contracts";

import { createCartPreparePostHandler, MAX_CART_PREPARE_JSON_BYTES } from "./route";

const MAX_CANDIDATE_PIZZA_LINES = 100;
const MAX_TOPPINGS_PER_CANDIDATE_LINE = 10;
const MAX_CANDIDATE_DEAL_CODES = 200;
const MAX_DIETARY_GROUPS = 10;

/** The largest candidate `DominosCandidateSchema` can accept: every count at
 * its bound and every string at its maximum length. */
function structuralMaxCandidate(): DominosCandidate {
  const identifier = "i".repeat(MAX_IDENTIFIER_CHARS);
  const code = "c".repeat(MAX_MENU_CODE_CHARS);
  const line = {
    lineId: identifier,
    quantity: 9999,
    productCode: code,
    variantCode: code,
    sizeCode: code,
    crustCode: code,
    sauceCode: code,
    cheeseCode: code,
    toppings: Array.from({ length: MAX_TOPPINGS_PER_CANDIDATE_LINE }, () => ({ code, quantity: 9999 })),
    purpose: "dietary-protected" as const,
    protectsGroupIds: Array.from({ length: MAX_DIETARY_GROUPS }, () => identifier),
    trustedSlicesPerPizza: 9999,
  };
  return {
    candidateId: identifier,
    candidateVersion: 999999,
    snapshotVersion: identifier,
    storeId: code,
    serviceMethod: "delivery",
    dealCodes: Array.from({ length: MAX_CANDIDATE_DEAL_CODES }, () => code),
    pizzas: Array.from({ length: MAX_CANDIDATE_PIZZA_LINES }, () => line),
    expectedPricing: { subtotalCad: 9999.99, taxCad: 9999.99, feesCad: 9999.99, totalCad: 9999.99 },
  };
}

/** The largest input `GatherBiteInputSchema` can accept. */
function structuralMaxInput(): GatherBiteInput {
  return GatherBiteInputSchema.parse({
    attendees: 200,
    budgetCad: 5000,
    serviceMethod: "delivery",
    deliveryAddress: {
      street: "s".repeat(120),
      unit: "u".repeat(30),
      city: "c".repeat(80),
      province: "PE",
      postalCode: "C1A 1A1",
    },
    groups: Array.from({ length: MAX_DIETARY_GROUPS }, (_, index) => ({
      id: `${"g".repeat(MAX_IDENTIFIER_CHARS - 2)}${index}`,
      people: 20,
      restrictions: ["vegetarian"],
      notes: "n".repeat(200),
    })),
    pizzaPreferences: [],
  });
}

const preparedResult = (candidate: DominosCandidate): CartPreparationResult => ({
  status: "FALLBACK_READY",
  actualCart: null,
  comparison: null,
  handoffUrl: null,
  fallback: buildGuidedHandoff(candidate),
  reason: "Stubbed for the route-level body-limit test.",
});

test("the byte cap cannot reject a body the route's own schemas accept", () => {
  const candidate = structuralMaxCandidate();
  const input = structuralMaxInput();

  // Both halves must really be schema-valid, or the size below proves nothing.
  assert.equal(DominosCandidateSchema.safeParse(candidate).success, true);
  assert.equal(GatherBiteInputSchema.safeParse(input).success, true);

  const bytes = Buffer.byteLength(JSON.stringify({ candidate, input }));
  assert.ok(
    bytes <= MAX_CART_PREPARE_JSON_BYTES,
    `schema-valid body of ${bytes} bytes exceeds the route cap of ${MAX_CART_PREPARE_JSON_BYTES}`,
  );
});

test("a schema-maximum candidate reaches preparation instead of returning 413", async () => {
  const candidate = structuralMaxCandidate();
  const input = structuralMaxInput();
  let received = 0;

  const post = createCartPreparePostHandler(async (candidateInput) => {
    received += 1;
    return preparedResult(DominosCandidateSchema.parse(candidateInput));
  });

  const response = await post(new Request("http://localhost/api/gatherbite/cart/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidate, input }),
  }));

  assert.equal(response.status, 200);
  assert.equal(received, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a body past the route cap is still refused before preparation", async () => {
  let received = 0;
  const post = createCartPreparePostHandler(async (candidateInput) => {
    received += 1;
    return preparedResult(DominosCandidateSchema.parse(candidateInput));
  });

  const response = await post(new Request("http://localhost/api/gatherbite/cart/prepare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(MAX_CART_PREPARE_JSON_BYTES + 1),
    },
    body: "{}",
  }));

  assert.equal(response.status, 413);
  assert.equal(received, 0);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
});
