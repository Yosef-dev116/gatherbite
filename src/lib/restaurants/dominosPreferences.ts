import type { DominosCandidate, CandidatePizza, PreferenceEvidence } from "../gatherbite/contracts";
import type { PizzaPreference } from "../types";
import type { DominosCatalog } from "./dominosCatalog";
import type { DominosToppingOption } from "./dominos";

type Topping = { code: string; quantity: number };

const VEGGIE_COMPONENTS: readonly (readonly string[])[] = [
  ["Green Pepper", "Green Peppers"],
  ["Mushroom", "Mushrooms"],
  ["Onion", "Onions"],
];

const MEAT_COMPONENTS: readonly (readonly string[])[] = [
  ["Pepperoni"],
  ["Italian Sausage", "Sausage"],
  ["Beef Crumble"],
  ["Bacon Strip Crumble"],
  ["Ham"],
];

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

function findTopping(catalog: DominosCatalog, names: readonly string[]): DominosToppingOption | null {
  const normalizedNames = new Set(names.map((name) => name.toLocaleLowerCase()));
  for (const topping of catalog.toppingsByCode.values()) {
    if (normalizedNames.has(topping.name.trim().toLocaleLowerCase())) return topping;
  }
  return null;
}

function hasConfigurableLivePizza(pizza: CandidatePizza, catalog: DominosCatalog): boolean {
  const product = catalog.productsByCode.get(pizza.productCode);
  return Boolean(product?.variantCodes.includes(pizza.variantCode));
}

function normalizedWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);
}

function avoidanceWords(note: string): string[] {
  const words = normalizedWords(note);
  return ["no", "without", "avoid", "exclude"].includes(words[0] ?? "") ? words.slice(1) : words;
}

/** Match an organizer note only to an exact live component's name/code words. */
function isAvoided(topping: DominosToppingOption, notes: readonly string[]): boolean {
  const componentWords = new Set([...normalizedWords(topping.name), ...normalizedWords(topping.code)]);
  return notes.some((note) => {
    const avoided = avoidanceWords(note);
    return avoided.length > 0 && avoided.every((word) => componentWords.has(word));
  });
}

function availableComponents(
  catalog: DominosCatalog,
  components: readonly (readonly string[])[],
  avoidanceNotes: readonly string[],
): DominosToppingOption[] {
  return components
    .map((names) => findTopping(catalog, names))
    .filter((topping): topping is DominosToppingOption => topping !== null && !isAvoided(topping, avoidanceNotes));
}

function configurationFor(
  preference: PizzaPreference,
  catalog: DominosCatalog,
  avoidanceNotes: readonly string[],
): { toppings: Topping[]; cheeseCode?: string | null } | null {
  if (preference === "cheese") {
    const cheese = findTopping(catalog, ["Cheese", "Mozzarella Cheese", "Cheese Blend"]);
    return cheese && !isAvoided(cheese, avoidanceNotes) ? { toppings: [], cheeseCode: cheese.code } : null;
  }

  if (preference === "pepperoni") {
    const pepperoni = findTopping(catalog, ["Pepperoni"]);
    return pepperoni && !isAvoided(pepperoni, avoidanceNotes)
      ? { toppings: [{ code: pepperoni.code, quantity: 1 }] }
      : null;
  }

  const components = preference === "veggie" ? VEGGIE_COMPONENTS : MEAT_COMPONENTS;
  const toppings = availableComponents(catalog, components, avoidanceNotes);
  const minimum = 2;
  if (toppings.length < minimum) return null;
  return { toppings: toppings.map(({ code }) => ({ code, quantity: 1 })) };
}

function unavailableReason(preference: PizzaPreference, avoidanceNotes: readonly string[]): string {
  const suffix = avoidanceNotes.length > 0 ? " after applying the organizer's avoidance notes" : "";
  if (preference === "pepperoni") return "Pepperoni is not available in this live store catalogue.";
  if (preference === "cheese") return `A verified cheese option is not available in this live store catalogue${suffix}.`;
  if (preference === "veggie") return `This live store catalogue does not expose enough verified veggie toppings${suffix}.`;
  return `This live store catalogue does not expose enough verified meat toppings for Meat lovers${suffix}.`;
}

function splitGeneralPizzaUnits(pizzas: CandidatePizza[]): CandidatePizza[] {
  const occupiedLineIds = new Set(pizzas.map((pizza) => pizza.lineId));
  const result: CandidatePizza[] = [];

  for (const pizza of pizzas) {
    if (pizza.purpose !== "general" || pizza.quantity <= 1) {
      result.push(pizza);
      continue;
    }

    for (let unit = 1; unit <= pizza.quantity; unit += 1) {
      const baseLineId = `${pizza.lineId}:unit:${unit}`;
      let lineId = baseLineId;
      let suffix = 2;
      while (occupiedLineIds.has(lineId)) {
        lineId = `${baseLineId}:${suffix}`;
        suffix += 1;
      }
      occupiedLineIds.add(lineId);
      result.push({ ...pizza, lineId, quantity: 1, toppings: pizza.toppings.map((topping) => ({ ...topping })) });
    }
  }
  return result;
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
  if (preferences.length > 0) {
    configured.pizzas = splitGeneralPizzaUnits(configured.pizzas);
  }
  const generalPizzaIndexes = configured.pizzas
    .map((pizza, index) => ({ pizza, index }))
    .filter(({ pizza }) => pizza.purpose === "general")
    .map(({ index }) => index);

  for (let index = 0; index < preferences.length; index += 1) {
    const preference = preferences[index]!;
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

    const configuration = configurationFor(preference, catalog, avoidanceNotes);
    if (!configuration) {
      evidence.unmet.push({ preference, reason: unavailableReason(preference, avoidanceNotes) });
      continue;
    }

    pizza.toppings = configuration.toppings;
    if (configuration.cheeseCode !== undefined) pizza.cheeseCode = configuration.cheeseCode;
    evidence.represented.push(preference);
  }

  return { candidate: configured, evidence };
}
