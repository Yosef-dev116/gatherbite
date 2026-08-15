import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePeiHst,
  PEI_HST_EFFECTIVE_DATE,
  PEI_HST_RATE,
  PEI_HST_SOURCE,
} from "./peiTax";

const SOURCE_CHECKED_AT = "2026-08-14";

test("PEI HST uses the versioned official 15% evidence", () => {
  assert.equal(SOURCE_CHECKED_AT, "2026-08-14");
  assert.equal(PEI_HST_RATE, 0.15);
  assert.equal(PEI_HST_EFFECTIVE_DATE, "2016-10-01");
  assert.equal(PEI_HST_SOURCE, "https://www.princeedwardisland.ca/en/information/finance/harmonized-sales-tax-hst");
  assert.deepEqual(calculatePeiHst(105), {
    taxCad: 15.75,
    totalCad: 120.75,
    source: PEI_HST_SOURCE,
    effectiveDate: PEI_HST_EFFECTIVE_DATE,
  });
});

test("PEI HST rounds Canadian-dollar outputs to cents", () => {
  assert.deepEqual(calculatePeiHst(14.99), {
    taxCad: 2.25,
    totalCad: 17.24,
    source: PEI_HST_SOURCE,
    effectiveDate: PEI_HST_EFFECTIVE_DATE,
  });
});

test("PEI HST refuses invalid inputs rather than inventing a total", () => {
  assert.throws(() => calculatePeiHst(-1), /non-negative finite subtotal/i);
  assert.throws(() => calculatePeiHst(Number.NaN), /non-negative finite subtotal/i);
});
