import assert from "node:assert/strict";
import test from "node:test";

import type { DeliveryAddress } from "../gatherbite/contracts";
import {
  checkDominosServiceability,
  resolveDominosPriceEvidence,
} from "./dominosServiceability";

const address: DeliveryAddress = {
  street: "1 Great George St",
  city: "Charlottetown",
  province: "PE",
  postalCode: "C1A 4J6",
};

test("official lookup proves delivery serviceability and normalizes store ids", async () => {
  const result = await checkDominosServiceability(address, "delivery", {
    lookup: async () => ({ storeIds: ["10950", "10950", "", " 10953 "], observedAt: "2026-08-15T03:14:17.698Z" }),
  });

  assert.equal(result.status, "SERVICEABLE");
  assert.deepEqual(result.storeIds, ["10950", "10953"]);
});

test("an authoritative empty lookup is NOT_SERVICEABLE", async () => {
  const result = await checkDominosServiceability(address, "delivery", {
    lookup: async () => ({ storeIds: [], observedAt: "2026-08-15T03:14:17.698Z" }),
  });

  assert.equal(result.status, "NOT_SERVICEABLE");
  assert.match(result.reason, /did not return a serviceable store/i);
});

test("failed or unavailable official lookup remains UNKNOWN", async () => {
  const result = await checkDominosServiceability(address, "delivery", {
    lookup: async () => {
      throw new Error("official lookup unavailable");
    },
  });

  assert.equal(result.status, "UNKNOWN");
  assert.deepEqual(result.storeIds, []);
  assert.match(result.reason, /official lookup unavailable/i);
});

test("carryout needs no delivery address and does not call the lookup", async () => {
  let called = false;
  const result = await checkDominosServiceability(undefined, "carryout", {
    lookup: async () => {
      called = true;
      return { storeIds: [], observedAt: new Date().toISOString() };
    },
  });

  assert.equal(result.status, "SERVICEABLE");
  assert.equal(result.applicability, "NOT_REQUIRED");
  assert.equal(called, false);
});

test("delivery or either without an address stays UNKNOWN and never invokes lookup", async () => {
  let calls = 0;
  const lookup = async () => {
    calls++;
    return { storeIds: ["10950"], observedAt: new Date().toISOString() };
  };

  assert.equal((await checkDominosServiceability(undefined, "delivery", { lookup })).status, "UNKNOWN");
  assert.equal((await checkDominosServiceability(undefined, "either", { lookup })).status, "UNKNOWN");
  assert.equal(calls, 0);
});

test("a complete official live quote outranks a possible tax calculation", () => {
  const evidence = resolveDominosPriceEvidence({
    observedAt: "2026-08-15T03:14:17.698Z",
    liveQuote: {
      subtotalCad: 100,
      taxCad: 15,
      feesCad: 6,
      totalCad: 121,
      source: "Domino's official price-order response",
    },
    calculation: {
      subtotalCad: 90,
      fees: [],
      allRequiredFeesKnown: true,
    },
  });

  assert.equal(evidence.status, "KNOWN");
  assert.equal(evidence.kind, "LIVE_QUOTE");
  assert.equal(evidence.totalCad, 121);
});

test("trusted PEI calculation requires every fee amount and taxability", () => {
  const known = resolveDominosPriceEvidence({
    observedAt: "2026-08-15T03:14:17.698Z",
    calculation: {
      subtotalCad: 100,
      fees: [
        { amountCad: 5, taxable: true },
        { amountCad: 2, taxable: false },
      ],
      allRequiredFeesKnown: true,
    },
  });
  assert.deepEqual(known, {
    status: "KNOWN",
    kind: "TRUSTED_CALCULATION",
    subtotalCad: 100,
    taxCad: 15.75,
    feesCad: 7,
    totalCad: 122.75,
    source: "https://www.princeedwardisland.ca/en/information/finance/harmonized-sales-tax-hst",
    observedAt: "2026-08-15T03:14:17.698Z",
  });

  const unknownAmount = resolveDominosPriceEvidence({
    observedAt: "2026-08-15T03:14:17.698Z",
    calculation: {
      subtotalCad: 100,
      fees: [{ amountCad: null, taxable: true }],
      allRequiredFeesKnown: true,
    },
  });
  assert.equal(unknownAmount.status, "UNKNOWN");
  assert.equal(unknownAmount.totalCad, null);

  const unknownTaxability = resolveDominosPriceEvidence({
    observedAt: "2026-08-15T03:14:17.698Z",
    calculation: {
      subtotalCad: 100,
      fees: [{ amountCad: 5, taxable: null }],
      allRequiredFeesKnown: true,
    },
  });
  assert.equal(unknownTaxability.status, "UNKNOWN");

  const unknownRequiredFee = resolveDominosPriceEvidence({
    observedAt: "2026-08-15T03:14:17.698Z",
    calculation: { subtotalCad: 100, fees: [], allRequiredFeesKnown: false },
  });
  assert.equal(unknownRequiredFee.status, "UNKNOWN");
  assert.equal(unknownRequiredFee.subtotalCad, 100);
});
