/**
 * Domino's Canada dietary verification — deterministic only. The LLM
 * never decides whether food satisfies a restriction; every judgment
 * here is a table lookup against data transcribed from two trusted
 * sources and nothing else:
 *
 *   1. Domino's Canada Nutrition Guide (AS OF AUGUST 2025), PDF:
 *      https://www.dominos.ca/assets/build/market/CA/_en/pdf/Canadian-Nutrition-Guide-Final-Secure.pdf
 *      - "INGREDIENTS" section (per-crust/sauce/cheese/topping ingredient
 *        statements, including explicit meat species and "Contains:"
 *        allergen declarations)
 *      - "DOMINO'S CANADA ALLERGEN INFORMATION" matrix (C = Contains,
 *        MC = May Contain/processed on same line) covering the 11
 *        Health-Canada priority allergens: Peanuts, Tree Nuts, Sesame,
 *        Milk, Eggs, Fish, Crustaceans, Shellfish, Soy, Wheat, Mustard,
 *        plus Sulphites and Gluten.
 *   2. The real live topping/product data already fetched by
 *      dominos.ts (topping codes/names, DefaultToppings).
 *
 * No blogs, no third-party nutrition sites, no LLM inference. An
 * ingredient/component not covered below is UNKNOWN, not SAFE.
 *
 * IMPORTANT WORDING NOTE (per product requirements): "Gluten-Friendly"
 * here means "this menu option is compatible according to curated
 * Domino's ingredient/allergen data" — it is NOT a celiac-safety or
 * medical allergy guarantee. The word "celiac" does not appear
 * anywhere in Domino's own nutrition guide; Night Shift does not
 * introduce that claim either.
 */

import type { Restriction } from "../types";

export type DietaryStatus = "SAFE" | "CONTAINS" | "MAY_CONTAIN" | "UNKNOWN";

export interface DietaryEvidence {
  component: string;
  restriction: Restriction;
  status: DietaryStatus;
  source: string;
}

export interface DietaryEvaluation {
  /** Worst status across every requested restriction and every real
   * component evaluated (crust + sauce + cheese + toppings) — this IS
   * the AND semantics: one bad component or one unresolved restriction
   * fails the whole evaluation. */
  status: DietaryStatus;
  satisfiesAll: boolean;
  evidence: DietaryEvidence[];
}

interface ComponentProfile {
  name: string;
  source: string;
  restrictions: Partial<Record<Restriction, DietaryStatus>>;
}

const STATUS_RANK: Record<DietaryStatus, number> = { SAFE: 0, UNKNOWN: 1, MAY_CONTAIN: 2, CONTAINS: 3 };

function worst(a: DietaryStatus, b: DietaryStatus): DietaryStatus {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

const GUIDE_SOURCE = "Domino's Canada Nutrition Guide (as of August 2025) — Ingredients section";
const ALLERGEN_MATRIX_SOURCE = "Domino's Canada Nutrition Guide (as of August 2025) — Allergen Information matrix";

/* ---------------------------------------------------------------------
 * Real toppings/sauces/cheeses, keyed by their real Domino's name
 * (matched case-insensitively against the names our live adapter
 * resolves via menu.Toppings). Meat species come from the guide's own
 * ingredient statements — never inferred from a product name.
 * ------------------------------------------------------------------- */
const TOPPING_PROFILES: ComponentProfile[] = [
  {
    name: "Pepperoni",
    source: `${GUIDE_SOURCE} ("Pork, beef, salt, spices (mustard)...") + ${ALLERGEN_MATRIX_SOURCE} (MC Milk, MC Soy, MC Wheat, C Mustard, MC Gluten)`,
    restrictions: {
      noPork: "CONTAINS",
      noBeef: "CONTAINS",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "MAY_CONTAIN",
      noMustard: "CONTAINS",
      dairyFree: "MAY_CONTAIN",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "MAY_CONTAIN",
    },
  },
  {
    name: "Brooklyn Pepperoni",
    source: `${GUIDE_SOURCE} ("Pork and beef, salt, spices...") + ${ALLERGEN_MATRIX_SOURCE} (MC Milk, MC Soy, MC Wheat, C Mustard, MC Gluten)`,
    restrictions: {
      noPork: "CONTAINS",
      noBeef: "CONTAINS",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "MAY_CONTAIN",
      noMustard: "CONTAINS",
      dairyFree: "MAY_CONTAIN",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "MAY_CONTAIN",
    },
  },
  {
    name: "Italian Sausage",
    source: `${GUIDE_SOURCE} ("Pork, Seasonings...") + ${ALLERGEN_MATRIX_SOURCE} (no allergen columns marked)`,
    restrictions: {
      noPork: "CONTAINS",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "SAFE",
      noMustard: "SAFE",
      dairyFree: "SAFE",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "Beef Crumble",
    source: `${GUIDE_SOURCE} ("Beef, Water, Soy Protein Concentrate...") + ${ALLERGEN_MATRIX_SOURCE} (C Soy)`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "CONTAINS",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "CONTAINS",
      noMustard: "SAFE",
      dairyFree: "SAFE",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "Ham",
    source: `${GUIDE_SOURCE} ("Pork, Water, Salt...") + ${ALLERGEN_MATRIX_SOURCE} (no allergen columns marked)`,
    restrictions: {
      noPork: "CONTAINS",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "SAFE",
      noMustard: "SAFE",
      dairyFree: "SAFE",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "Bacon Strip Crumble",
    source: `${GUIDE_SOURCE} ("Pork, Water, Salt, Sugar...") + ${ALLERGEN_MATRIX_SOURCE} (MC Soy)`,
    restrictions: {
      noPork: "CONTAINS",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "MAY_CONTAIN",
      noMustard: "SAFE",
      dairyFree: "SAFE",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "Chicken",
    source: `${GUIDE_SOURCE} ("Chicken breasts, Water, Sugars...") + ${ALLERGEN_MATRIX_SOURCE} (MC Milk, MC Soy, MC Wheat, C Mustard, MC Gluten)`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "CONTAINS",
      noEgg: "SAFE",
      noSoy: "MAY_CONTAIN",
      noMustard: "CONTAINS",
      dairyFree: "MAY_CONTAIN",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "MAY_CONTAIN",
    },
  },
  {
    name: "Salami",
    source: `${GUIDE_SOURCE} ("Beef, Water, Durum Flour, Salt...") + ${ALLERGEN_MATRIX_SOURCE} (C Milk, MC Soy, C Wheat, C Gluten)`,
    restrictions: {
      // Real finding: Domino's Canada salami is BEEF-based, not pork -
      // confirmed from the ingredient statement, not assumed from name.
      noPork: "SAFE",
      noBeef: "CONTAINS",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "MAY_CONTAIN",
      noMustard: "SAFE",
      dairyFree: "CONTAINS",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "CONTAINS",
    },
  },
  {
    name: "Philly Steak",
    source: `${GUIDE_SOURCE} ("Beef, Water, Seasoning...") + ${ALLERGEN_MATRIX_SOURCE} (C Soy, C Mustard)`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "CONTAINS",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "CONTAINS",
      noMustard: "CONTAINS",
      dairyFree: "SAFE",
      vegetarian: "CONTAINS",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "Liquid Egg",
    source: `${ALLERGEN_MATRIX_SOURCE} (C Eggs)`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "CONTAINS",
      noSoy: "SAFE",
      noMustard: "SAFE",
      dairyFree: "SAFE",
      vegetarian: "SAFE",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  // --- Cheeses: every variant is confirmed dairy ("Contains milk" is
  // the section header for the whole Cheeses table in the guide). ---
  ...(["Cheese", "Mozzarella Cheese", "Cheese Blend", "Cheddar Cheese", "Cheddar", "Feta Cheese", "Feta", "Provolone", "Parmesan Cheese", "Parmesan & Asiago Cheese", "White Cheddar Cheese"] as const).map(
    (name): ComponentProfile => ({
      name,
      source: `${GUIDE_SOURCE} (Cheeses section — "Pasteurized milk, modified milk ingredients..."; section header: "Contains milk")`,
      restrictions: {
        noPork: "SAFE",
        noBeef: "SAFE",
        noChicken: "SAFE",
        noEgg: "SAFE",
        noSoy: "SAFE",
        noMustard: "SAFE",
        dairyFree: "CONTAINS",
        vegetarian: "SAFE",
        vegan: "CONTAINS",
        glutenFriendly: "SAFE",
      },
    })
  ),
  // --- Plain vegetables: no allergen columns marked in the matrix, no
  // animal-derived ingredient in the guide's statements. ---
  ...(["Green Peppers", "Onions", "Mushrooms", "Black Olives", "Olives (Black)", "Green Olives", "Olives (Green)", "Pineapple", "Tomatoes", "Roasted Red Peppers", "Spinach", "Baby Spinach", "Jalapeno Peppers", "Jalapeño Peppers", "Hot Peppers", "Banana Peppers", "Hot Banana Peppers"] as const).map(
    (name): ComponentProfile => ({
      name,
      source: `${ALLERGEN_MATRIX_SOURCE} (no columns marked) + ${GUIDE_SOURCE} (plant ingredient only)`,
      restrictions: {
        noPork: "SAFE",
        noBeef: "SAFE",
        noChicken: "SAFE",
        noEgg: "SAFE",
        noSoy: "SAFE",
        noMustard: "SAFE",
        dairyFree: "SAFE",
        vegetarian: "SAFE",
        vegan: "SAFE",
        glutenFriendly: "SAFE",
      },
    })
  ),
  // --- Sauces ---
  {
    name: "Pizza Sauce",
    source: `${GUIDE_SOURCE} ("Crushed Tomatoes, Water, Sugar, Spices, Garlic Powder, Salt, Soybean Oil, Citric Acid") + ${ALLERGEN_MATRIX_SOURCE} (MC Milk, C Soy, MC Sulphites)`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "CONTAINS",
      noMustard: "SAFE",
      dairyFree: "MAY_CONTAIN",
      vegetarian: "SAFE",
      vegan: "MAY_CONTAIN",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "BBQ Sauce",
    source: `${GUIDE_SOURCE} ("...Mustard Flour, Xanthan Gum") + ${ALLERGEN_MATRIX_SOURCE} (MC Fish, C Soy, MC Wheat, C Mustard, C Sulphites)`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "CONTAINS",
      noMustard: "CONTAINS",
      dairyFree: "SAFE",
      vegetarian: "SAFE",
      vegan: "MAY_CONTAIN",
      glutenFriendly: "MAY_CONTAIN",
    },
  },
  {
    name: "Hearty Marinara Sauce",
    source: `${GUIDE_SOURCE} ("...Romano and Parmesan Cheese (Cultured Milk...) Contains: Milk")`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "MAY_CONTAIN",
      noMustard: "SAFE",
      dairyFree: "CONTAINS",
      vegetarian: "SAFE",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "Alfredo Sauce",
    source: `${GUIDE_SOURCE} ("...Contains: Barley, Milk, Soy, Wheat")`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "SAFE",
      noSoy: "CONTAINS",
      noMustard: "SAFE",
      dairyFree: "CONTAINS",
      vegetarian: "SAFE",
      vegan: "CONTAINS",
      glutenFriendly: "CONTAINS",
    },
  },
  {
    name: "Garlic Parmesan Sauce",
    source: `${GUIDE_SOURCE} ("...Liquid Egg Yolk... Contains: Egg, Milk")`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "CONTAINS",
      noSoy: "MAY_CONTAIN",
      noMustard: "SAFE",
      dairyFree: "CONTAINS",
      vegetarian: "SAFE",
      vegan: "CONTAINS",
      glutenFriendly: "SAFE",
    },
  },
  {
    name: "Buttermilk Ranch",
    source: `${GUIDE_SOURCE} ("...Contains less than 2% of: Egg Yolk, Whey Protein Concentrate (Milk)...")`,
    restrictions: {
      noPork: "SAFE",
      noBeef: "SAFE",
      noChicken: "SAFE",
      noEgg: "CONTAINS",
      noSoy: "MAY_CONTAIN",
      noMustard: "MAY_CONTAIN",
      dairyFree: "CONTAINS",
      vegetarian: "SAFE",
      vegan: "CONTAINS",
      glutenFriendly: "MAY_CONTAIN",
    },
  },
];

const TOPPING_LOOKUP = new Map(TOPPING_PROFILES.map((p) => [p.name.toLowerCase(), p]));
// A few real alternate spellings/labels our live adapter or deal text may use.
const TOPPING_ALIASES: Record<string, string> = {
  sausage: "italian sausage",
  "chicken (grilled)": "chicken",
  "grilled chicken": "chicken",
  mozzarella: "cheese",
};

function lookupTopping(name: string): ComponentProfile | null {
  const key = name.trim().toLowerCase();
  return TOPPING_LOOKUP.get(key) ?? TOPPING_LOOKUP.get(TOPPING_ALIASES[key] ?? "") ?? null;
}

/* ---------------------------------------------------------------------
 * Crusts: detected from real product/deal name text (Domino's own
 * naming, e.g. "...Pan Pizza", "...Gluten Free..."), the same way the
 * existing curated Little Caesars data detects its Gluten Friendly item
 * by name. If no known crust keyword is found, crust status is UNKNOWN
 * for crust-relevant restrictions — never assumed.
 * ------------------------------------------------------------------- */
const CRUST_PROFILES: { pattern: RegExp; profile: ComponentProfile }[] = [
  {
    pattern: /gluten[\s_-]?(?:free|f\b)/i,
    profile: {
      name: "Crust (Gluten Free)",
      source: `${GUIDE_SOURCE} ("Rice Flour, Water, Potato Starch, Rice Starch...May Contain: Eggs, Milk") + ${ALLERGEN_MATRIX_SOURCE} (C Milk, MC Soy — no Wheat/Gluten marked)`,
      restrictions: {
        glutenFriendly: "SAFE",
        dairyFree: "MAY_CONTAIN",
        noEgg: "MAY_CONTAIN",
        noSoy: "MAY_CONTAIN",
        noMustard: "SAFE",
      },
    },
  },
  {
    pattern: /parmesan\s+stuffed|stuffed\s+crust/i,
    profile: {
      name: "Crust (Parmesan Stuffed)",
      source: `${GUIDE_SOURCE} ("...Cheese [Pasteurized milk...]...Contains: Milk, Soy, Wheat, Mustard")`,
      restrictions: { glutenFriendly: "CONTAINS", dairyFree: "CONTAINS", noSoy: "CONTAINS", noMustard: "CONTAINS", noEgg: "SAFE" },
    },
  },
  {
    pattern: /crunchy\s+thin|thin\s+crust/i,
    profile: {
      name: "Crust (Crunchy Thin)",
      source: `${GUIDE_SOURCE} ("...Contains: Wheat, Barley")`,
      restrictions: { glutenFriendly: "CONTAINS", dairyFree: "SAFE", noSoy: "SAFE", noEgg: "SAFE", noMustard: "SAFE" },
    },
  },
  {
    pattern: /whole\s+wheat|whole\s+grain/i,
    profile: {
      name: "Crust (Whole Wheat)",
      source: `${GUIDE_SOURCE} ("...Contains: Milk, Soy, Wheat")`,
      restrictions: { glutenFriendly: "CONTAINS", dairyFree: "CONTAINS", noSoy: "CONTAINS", noEgg: "SAFE", noMustard: "SAFE" },
    },
  },
  {
    pattern: /new\s+york/i,
    profile: {
      name: "Crust (New York Style)",
      source: `${GUIDE_SOURCE} ("...Contains: Milk, Soy, Wheat")`,
      restrictions: { glutenFriendly: "CONTAINS", dairyFree: "CONTAINS", noSoy: "CONTAINS", noEgg: "SAFE", noMustard: "SAFE" },
    },
  },
  {
    pattern: /\bpan\b/i,
    profile: {
      name: "Crust (Pan)",
      source: `${GUIDE_SOURCE} ("...Contains: Milk, Soy, Wheat")`,
      restrictions: { glutenFriendly: "CONTAINS", dairyFree: "CONTAINS", noSoy: "CONTAINS", noEgg: "SAFE", noMustard: "SAFE" },
    },
  },
  {
    pattern: /hand[\s_-]*toss(?:ed)?/i,
    profile: {
      name: "Crust (Hand Tossed)",
      source: `${GUIDE_SOURCE} ("...Contains: Milk, Soy, Wheat")`,
      restrictions: { glutenFriendly: "CONTAINS", dairyFree: "CONTAINS", noSoy: "CONTAINS", noEgg: "SAFE", noMustard: "SAFE" },
    },
  },
];

function detectCrust(itemName: string): ComponentProfile | null {
  for (const { pattern, profile } of CRUST_PROFILES) {
    if (pattern.test(itemName)) return profile;
  }
  return null; // unrecognized/unstated crust - unknown, not assumed Hand Tossed
}

const BASELINE_SAUCE = lookupTopping("Pizza Sauce")!;
const BASELINE_CHEESE = lookupTopping("Cheese")!;
const SAUCE_NAMES = new Set(["pizza sauce", "bbq sauce", "hearty marinara sauce", "alfredo sauce", "garlic parmesan sauce", "buttermilk ranch"]);
const CRUST_RELEVANT_RESTRICTIONS: Restriction[] = ["glutenFriendly", "dairyFree", "noEgg", "noSoy", "noMustard", "vegan"];

export interface ConfiguredPizzaComponents {
  /** Exact live crust label or code. Null means the crust is not known. */
  crustName: string | null;
  /** Null explicitly means no sauce is configured. */
  sauceName: string | null;
  /** Null explicitly means no cheese is configured. */
  cheeseName: string | null;
  toppingNames: string[];
}

type NamedProfile = { name: string; profile: ComponentProfile | null };

function evaluateProfiles(
  crust: ComponentProfile | null,
  namedComponents: NamedProfile[],
  restrictions: Restriction[],
): DietaryEvaluation {
  if (restrictions.length === 0) {
    return { status: "SAFE", satisfiesAll: true, evidence: [] };
  }

  const evidence: DietaryEvidence[] = [];
  let overall: DietaryStatus = "SAFE";

  function apply(restriction: Restriction, current: DietaryStatus, component: ComponentProfile, status: DietaryStatus): DietaryStatus {
    if (status !== "SAFE") evidence.push({ component: component.name, restriction, status, source: component.source });
    return worst(current, status);
  }

  for (const restriction of restrictions) {
    let restrictionStatus: DietaryStatus = "SAFE";

    if (CRUST_RELEVANT_RESTRICTIONS.includes(restriction)) {
      if (crust) {
        restrictionStatus = apply(restriction, restrictionStatus, crust, crust.restrictions[restriction] ?? "UNKNOWN");
      } else {
        restrictionStatus = worst(restrictionStatus, "UNKNOWN");
        evidence.push({
          component: "Crust (unrecognized/unstated)",
          restriction,
          status: "UNKNOWN",
          source: "No curated crust profile matched the exact live label/code — not assumed safe.",
        });
      }
    }

    for (const { name, profile } of namedComponents) {
      if (!profile) {
        restrictionStatus = worst(restrictionStatus, "UNKNOWN");
        evidence.push({
          component: name,
          restriction,
          status: "UNKNOWN",
          source: "No curated Domino's dietary data for this ingredient — not assumed safe.",
        });
        continue;
      }
      restrictionStatus = apply(restriction, restrictionStatus, profile, profile.restrictions[restriction] ?? "UNKNOWN");
    }

    overall = worst(overall, restrictionStatus);
  }

  return { status: overall, satisfiesAll: overall === "SAFE", evidence };
}

/**
 * Evaluates an exact candidate configuration. Unlike the legacy item-name
 * helper below, this function never adds implicit sauce or cheese: null means
 * the candidate explicitly omitted that component, while an uncurated live
 * name/code remains UNKNOWN and fails closed.
 */
export function evaluateConfiguredDominosPizza(
  components: ConfiguredPizzaComponents,
  restrictions: Restriction[],
): DietaryEvaluation {
  const namedComponents: NamedProfile[] = [
    ...(components.sauceName === null ? [] : [{ name: components.sauceName, profile: lookupTopping(components.sauceName) }]),
    ...(components.cheeseName === null ? [] : [{ name: components.cheeseName, profile: lookupTopping(components.cheeseName) }]),
    ...components.toppingNames.map((name) => ({ name, profile: lookupTopping(name) })),
  ];

  return evaluateProfiles(
    components.crustName === null ? null : detectCrust(components.crustName),
    namedComponents,
    restrictions,
  );
}

/**
 * Evaluates a real pizza composition (crust from the item name, plus
 * explicit topping/sauce names) against a set of structured
 * restrictions. AND semantics: the result is the worst status found
 * across every component and every requested restriction - one failing
 * component fails the whole thing, and any UNKNOWN component fails
 * closed.
 *
 * Two real-world assumptions, both explicit and both real Domino's
 * defaults, not guesses: standard cheese is always present unless the
 * caller is evaluating a sauce/topping list that already substitutes
 * something else (there is no "no cheese" signal in our data model),
 * and a default Pizza Sauce is assumed ONLY when no other real sauce
 * name is already present among toppingNames (sauces are a single
 * mutually-exclusive choice, never stacked).
 */
export function evaluateDominosDietary(itemName: string, toppingNames: string[], restrictions: Restriction[]): DietaryEvaluation {
  const crust = detectCrust(itemName);
  const hasExplicitSauce = toppingNames.some((t) => SAUCE_NAMES.has(t.trim().toLowerCase()));
  const impliedComponents: ComponentProfile[] = hasExplicitSauce ? [BASELINE_CHEESE] : [BASELINE_CHEESE, BASELINE_SAUCE];
  return evaluateProfiles(crust, [
    ...impliedComponents.map((profile) => ({ name: profile.name, profile })),
    ...toppingNames.map((name) => ({ name, profile: lookupTopping(name) })),
  ], restrictions);
}

/**
 * Detects whether a deal's real name indicates the customer chooses
 * their own toppings (e.g. "1 Medium 5 Topping Pizza", "1-Topping...").
 * Only for these can we evaluate a safe, real, orderable baseline
 * (crust + sauce + cheese, no meat) — fixed-recipe items (Feast
 * pizzas, named specialty pizzas) have an unknown topping set from our
 * data and are correctly left unverifiable.
 */
export function isCustomizableToppingDeal(dealName: string): boolean {
  return /\d\s*-?\s*topping/i.test(dealName);
}

/**
 * Evaluates whether a customer-customizable deal CAN be ordered to
 * satisfy the given restrictions, using the safest real baseline
 * (crust from the deal's own name + plain cheese, no meat toppings —
 * a genuinely orderable configuration, not a guess about what the
 * customer will pick). Fixed-recipe deals (not customizable) return
 * UNKNOWN.
 */
export function evaluateDominosDeal(dealName: string, restrictions: Restriction[]): DietaryEvaluation {
  if (restrictions.length === 0) return { status: "SAFE", satisfiesAll: true, evidence: [] };
  if (!isCustomizableToppingDeal(dealName)) {
    return {
      status: "UNKNOWN",
      satisfiesAll: false,
      evidence: [
        {
          component: dealName,
          restriction: restrictions[0],
          status: "UNKNOWN",
          source: "Fixed-recipe deal (not a customer-customizable 'N Topping' pizza) — real topping composition is not available from live data, so it is not assumed.",
        },
      ],
    };
  }
  return evaluateDominosDietary(dealName, [], restrictions);
}
