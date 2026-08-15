import type { DominosCandidate, CandidatePizza, PreferenceEvidence } from "../gatherbite/contracts";
import type { PizzaPreference } from "../types";
import type { DominosCatalog } from "./dominosCatalog";

type Topping = { code: string; quantity: number };

const PREFERENCE_NAMES: Record<Exclude<PizzaPreference, "cheese">, readonly string[]> = {
  pepperoni: ["Pepperoni"],
  veggie: ["Green Pepper", "Green Peppers", "Mushroom", "Mushrooms", "Onion", "Onions"],
  meatHeavy: ["Pepperoni", "Italian Sausage", "Sausage", "Beef Crumble", "Bacon Strip Crumble", "Ham"],
};

const AVOIDANCE_TERMS: Record<PizzaPreference, readonly string[]> = {
  cheese: ["dairy-free", "dairy free", "vegan"],
  pepperoni: ["no pork", "no beef", "no mustard", "no soy", "vegetarian", "vegan", "dairy-free", "dairy free", "gluten-friendly", "gluten friendly"],
  veggie: [],
  meatHeavy: ["no pork", "no beef", "no chicken", "no mustard", "no soy", "vegetarian", "vegan", "dairy-free", "dairy free", "gluten-friendly", "gluten friendly"],
};

function clonePizza(pizza: CandidatePizza): CandidatePizza {
  return {
    ...pizza,
    toppings: pizza.toppings.map((topping) => ({ ...topping })),
    protectsGroupIds: [...pizza.protectsGroupIds],
  };
}

function cloneCandidate(candidate: DominosCandidate): DominosCandidate {
  return {
    ...candidate,
    dealCodes: [...candidate.dealCodes],
    pizzas: candidate.pizzas.map(clonePizza),
    expectedPricing: { ...candidate.expectedPricing },
  };
}

function findToppingCode(catalog: DominosCatalog, names: readonly string[]): string | null {
  const normalizedNames = new Set(names.map((name) => name.toLocaleLowerCase()));
  for (const topping of catalog.toppingsByCode.values()) {
    if (normalizedNames.has(topping.name.trim().toLocaleLowerCase())) return topping.code;
  }
  return null;
}

function hasConfigurableLivePizza(pizza: CandidatePizza, catalog: DominosCatalog): boolean {
  const product = catalog.productsByCode.get(pizza.productCode);
  return Boolean(product?.variantCodes.includes(pizza.variantCode));
}

function avoidanceReason(preference: PizzaPreference, notes: readonly string[]): string | null {
  const terms = AVOIDANCE_TERMS[preference];
  for (const note of notes) {
    const normalized = note.trim().toLocaleLowerCase();
    if (terms.some((term) => normalized.includes(term))) return note.trim();
  }
  return null;
}

function configurationFor(
  preference: PizzaPreference,
  catalog: DominosCatalog,
): { toppings: Topping[]; cheeseCode?: string | null } | null {
  if (preference === "cheese") {
    const cheeseCode = findToppingCode(catalog, ["Cheese", "Mozzarella Cheese", "Cheese Blend"]);
    return cheeseCode ? { toppings: [], cheeseCode } : null;
  }

  if (preference === "pepperoni") {
    const code = findToppingCode(catalog, PREFERENCE_NAMES.pepperoni);
    return code ? { toppings: [{ code, quantity: 1 }] } : null;
  }

  const targetNames = PREFERENCE_NAMES[preference];
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const name of targetNames) {
    const code = findToppingCode(catalog, [name]);
    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  const minimum = preference === "veggie" ? 3 : 2;
  if (codes.length < minimum) return null;
  return { toppings: codes.map((code) => ({ code, quantity: 1 })) };
}

function unavailableReason(preference: PizzaPreference): string {
  if (preference === "pepperoni") return "Pepperoni is not available in this live store catalogue.";
  if (preference === "cheese") return "A verified cheese option is not available in this live store catalogue.";
  if (preference === "veggie") return "This live store catalogue does not expose enough verified veggie toppings.";
  return "This live store catalogue does not expose enough verified meat toppings for Meat lovers.";
}

/**
 * Applies optional taste intent only to general pizzas. It never changes a
 * protected pizza, price evidence, quantity, capacity, or verification state;
 * an unavailable preference stays visible as soft unmet intent.
 */
export function configureGeneralPreferences(
  candidate: DominosCandidate,
  catalog: DominosCatalog,
  preferences: PizzaPreference[],
  avoidanceNotes: string[],
): { candidate: DominosCandidate; evidence: PreferenceEvidence } {
  const configured = cloneCandidate(candidate);
  const evidence: PreferenceEvidence = {
    requested: [...preferences],
    represented: [],
    unmet: [],
  };
  const generalPizzaIndexes = configured.pizzas
    .map((pizza, index) => ({ pizza, index }))
    .filter(({ pizza }) => pizza.purpose === "general")
    .map(({ index }) => index);

  for (let index = 0; index < preferences.length; index += 1) {
    const preference = preferences[index]!;
    const blockedBy = avoidanceReason(preference, avoidanceNotes);
    if (blockedBy) {
      evidence.unmet.push({
        preference,
        reason: `${preference === "meatHeavy" ? "Meat lovers" : preference[0]!.toUpperCase() + preference.slice(1)} conflicts with the organizer's avoidance note: ${blockedBy}.`,
      });
      continue;
    }

    const pizzaIndex = generalPizzaIndexes[index];
    const pizza = pizzaIndex === undefined ? undefined : configured.pizzas[pizzaIndex];
    if (!pizza) {
      evidence.unmet.push({ preference, reason: "No general pizza is available for this preference." });
      continue;
    }
    if (!hasConfigurableLivePizza(pizza, catalog)) {
      evidence.unmet.push({ preference, reason: "This general pizza cannot be configured from the current live store catalogue." });
      continue;
    }

    const configuration = configurationFor(preference, catalog);
    if (!configuration) {
      evidence.unmet.push({ preference, reason: unavailableReason(preference) });
      continue;
    }

    pizza.toppings = configuration.toppings;
    if (configuration.cheeseCode !== undefined) pizza.cheeseCode = configuration.cheeseCode;
    evidence.represented.push(preference);
  }

  return { candidate: configured, evidence };
}
