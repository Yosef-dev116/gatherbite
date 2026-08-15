export const PEI_HST_RATE = 0.15;
export const PEI_HST_SOURCE = "https://www.princeedwardisland.ca/en/information/finance/harmonized-sales-tax-hst";
export const PEI_HST_EFFECTIVE_DATE = "2016-10-01";

function roundCad(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculatePeiHst(subtotalCad: number): {
  taxCad: number;
  totalCad: number;
  source: string;
  effectiveDate: string;
} {
  if (!Number.isFinite(subtotalCad) || subtotalCad < 0) {
    throw new Error("PEI HST requires a non-negative finite subtotal");
  }

  const roundedSubtotal = roundCad(subtotalCad);
  const taxCad = roundCad(roundedSubtotal * PEI_HST_RATE);
  return {
    taxCad,
    totalCad: roundCad(roundedSubtotal + taxCad),
    source: PEI_HST_SOURCE,
    effectiveDate: PEI_HST_EFFECTIVE_DATE,
  };
}
