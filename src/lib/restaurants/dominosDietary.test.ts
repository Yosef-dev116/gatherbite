import { evaluateDominosDietary, evaluateDominosDeal, isCustomizableToppingDeal } from "./dominosDietary";
import { getDominosStoreSnapshot } from "./dominos";

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

async function main() {
// --- Pork topping fails No Pork ---
{
  console.log("Pork toppings fail No Pork");
  for (const topping of ["Ham", "Bacon Strip Crumble", "Italian Sausage"]) {
    const r = evaluateDominosDietary("Custom Pizza", [topping], ["noPork"]);
    check(`${topping} -> No Pork fails (CONTAINS)`, r.status === "CONTAINS" && r.satisfiesAll === false);
  }
  // Sanity: a real non-pork meat topping does NOT fail No Pork.
  const chickenOnly = evaluateDominosDietary("Custom Pizza", ["Chicken"], ["noPork"]);
  check("Chicken alone does not fail No Pork", chickenOnly.satisfiesAll === true);
}

// --- Beef fails No Beef ---
{
  console.log("Beef-containing toppings fail No Beef");
  for (const topping of ["Beef Crumble", "Philly Steak", "Salami"]) {
    const r = evaluateDominosDietary("Custom Pizza", [topping], ["noBeef"]);
    check(`${topping} -> No Beef fails (CONTAINS)`, r.status === "CONTAINS" && r.satisfiesAll === false);
  }
  // Real, non-obvious finding: Domino's Canada salami is BEEF, not pork.
  const salamiNoPork = evaluateDominosDietary("Custom Pizza", ["Salami"], ["noPork"]);
  check("Salami does NOT fail No Pork (it's beef, per the official ingredient statement)", salamiNoPork.satisfiesAll === true);
}

// --- Chicken fails No Chicken ---
{
  console.log("Chicken fails No Chicken");
  const r = evaluateDominosDietary("Custom Pizza", ["Chicken"], ["noChicken"]);
  check("Chicken -> No Chicken fails", r.status === "CONTAINS" && r.satisfiesAll === false);
  const hamOnly = evaluateDominosDietary("Custom Pizza", ["Ham"], ["noChicken"]);
  check("Ham alone does not fail No Chicken", hamOnly.satisfiesAll === true);
}

// --- Confirmed meat fails Vegetarian ---
{
  console.log("Confirmed meat toppings fail Vegetarian");
  for (const topping of ["Pepperoni", "Ham", "Beef Crumble", "Chicken", "Italian Sausage", "Salami", "Philly Steak"]) {
    const r = evaluateDominosDietary("Custom Pizza", [topping], ["vegetarian"]);
    check(`${topping} -> Vegetarian fails`, r.satisfiesAll === false);
  }
  const veggieOnly = evaluateDominosDietary("Custom Pizza", ["Onions", "Mushrooms", "Green Peppers"], ["vegetarian"]);
  check("Vegetable-only toppings satisfy Vegetarian", veggieOnly.satisfiesAll === true);
}

// --- Multi-restriction AND semantics ---
{
  console.log("Multi-restriction AND semantics - one item must satisfy every restriction together");
  // Chicken alone: passes noPork and noBeef individually, but the SAME
  // combined check must fail once noChicken is added.
  const chickenCombo = evaluateDominosDietary("Custom Pizza", ["Chicken"], ["noPork", "noBeef", "noChicken"]);
  check("Chicken passes noPork+noBeef alone but AND-fails once noChicken joins", chickenCombo.satisfiesAll === false);
  check("noPork+noBeef+noChicken failure is specifically from noChicken", chickenCombo.evidence.some((e) => e.restriction === "noChicken" && e.status === "CONTAINS"));

  const cleanVeggie = evaluateDominosDietary("Custom Pizza", ["Onions", "Green Peppers"], ["vegetarian", "noPork", "noBeef", "noChicken"]);
  check("all-vegetable toppings satisfy a 4-way AND combination", cleanVeggie.satisfiesAll === true);
}

// --- Known allergen presence fails the corresponding restriction ---
{
  console.log("Known allergen presence fails the corresponding restriction");
  check("BBQ Sauce contains Mustard (real ingredient: Mustard Flour)", evaluateDominosDietary("Custom Pizza", ["BBQ Sauce"], ["noMustard"]).satisfiesAll === false);
  check("Alfredo Sauce contains Milk/Soy/Gluten", evaluateDominosDietary("Custom Pizza", ["Alfredo Sauce"], ["dairyFree"]).satisfiesAll === false);
  check("Alfredo Sauce fails No Soy too (same sauce, same AND item)", evaluateDominosDietary("Custom Pizza", ["Alfredo Sauce"], ["noSoy"]).satisfiesAll === false);
  check("Garlic Parmesan Sauce contains Egg", evaluateDominosDietary("Custom Pizza", ["Garlic Parmesan Sauce"], ["noEgg"]).satisfiesAll === false);
}

// --- MAY_CONTAIN fails strict verification ---
{
  console.log("MAY_CONTAIN fails strict verification, not just CONTAINS");
  // Buttermilk Ranch replaces the default Pizza Sauce baseline (a real
  // pizza has one sauce, not both) so its own MAY_CONTAIN Mustard status
  // isn't masked by an unrelated CONTAINS from a sauce that isn't there.
  const r = evaluateDominosDietary("1 Medium Hand Tossed Pizza", ["Buttermilk Ranch"], ["noMustard"]);
  check("Buttermilk Ranch's mustard status is MAY_CONTAIN (cross-contact), not CONTAINS", r.status === "MAY_CONTAIN");
  check("MAY_CONTAIN still fails strict verification", r.satisfiesAll === false);
}

// --- UNKNOWN fails closed ---
{
  console.log("Unrecognized ingredients/crusts fail closed as UNKNOWN, never assumed SAFE");
  const unmapped = evaluateDominosDietary("Custom Pizza", ["Anchovies"], ["noPork"]);
  check("an unmapped topping is UNKNOWN, not SAFE", unmapped.status === "UNKNOWN" && unmapped.satisfiesAll === false);

  const unknownCrust = evaluateDominosDietary("1 Medium 2 Topping Pizza", ["Onions"], ["glutenFriendly"]);
  check("a crust not named in the item text is UNKNOWN for glutenFriendly, not assumed", unknownCrust.status === "UNKNOWN" && unknownCrust.satisfiesAll === false);
  check("unrecognized crust does NOT affect restrictions crust has no bearing on", evaluateDominosDietary("1 Medium 2 Topping Pizza", ["Onions"], ["noPork"]).satisfiesAll === true);
}

// --- Vegan requires positive full-composition evidence ---
{
  console.log("Vegan requires positive full-composition evidence - absence of meat is not enough");
  const veggieNoMeat = evaluateDominosDietary("Custom Pizza", ["Onions", "Green Peppers", "Mushrooms"], ["vegan"]);
  check("an all-vegetable pizza still FAILS vegan (real baseline cheese is dairy)", veggieNoMeat.satisfiesAll === false);
  check("vegan failure is CONTAINS (confirmed dairy), not just UNKNOWN", veggieNoMeat.status === "CONTAINS");
  check(
    "the evidence names Cheese as the reason, not the vegetable toppings",
    veggieNoMeat.evidence.some((e) => e.component.toLowerCase().includes("cheese") && e.restriction === "vegan")
  );
}

// --- Gluten-friendly behavior and wording ---
{
  console.log("Gluten-Friendly: real crust-name detection, not a celiac claim");
  const gfCrustPlainTopping = evaluateDominosDietary("1 Medium Gluten Free Pizza", ["Onions"], ["glutenFriendly"]);
  check("Gluten Free crust + plain veggie topping -> SAFE", gfCrustPlainTopping.satisfiesAll === true);

  const gfCrustWithPepperoni = evaluateDominosDietary("1 Medium Gluten Free Pizza", ["Pepperoni"], ["glutenFriendly"]);
  check(
    "Gluten Free crust + a topping with real wheat/gluten cross-contact risk (Pepperoni, MC Gluten) still fails - crust alone isn't enough",
    gfCrustWithPepperoni.satisfiesAll === false
  );

  const standardCrustNamed = evaluateDominosDietary("1 Medium Hand Tossed Pizza", ["Onions"], ["glutenFriendly"]);
  check("an explicitly non-gluten-free crust fails glutenFriendly outright (CONTAINS)", standardCrustNamed.status === "CONTAINS");
}

// --- A Domino's order that genuinely passes a supported dietary group ---
{
  console.log("A real, customizable Domino's deal genuinely passes a supported dietary group");
  check("isCustomizableToppingDeal recognizes real 'N Topping' deal names", isCustomizableToppingDeal("1 Medium 5 Topping Pizzas") === true);
  check("a Feast-named deal is NOT treated as customizable (unknown fixed recipe)", isCustomizableToppingDeal("1 Medium Feast Pizza") === false);

  const passes = evaluateDominosDeal("1 Medium 2 Topping Pizza", ["vegetarian", "noPork", "noBeef", "noChicken"]);
  check("a customizable deal's safe baseline (no meat) genuinely satisfies Vegetarian+No Pork+No Beef+No Chicken", passes.satisfiesAll === true);
}

// --- An impossible dietary combination ---
{
  console.log("Impossible dietary combinations are reported honestly, not guessed");
  const veganDeal = evaluateDominosDeal("1 Medium 2 Topping Pizza", ["vegan"]);
  check("Vegan is impossible on this menu's real baseline (dairy cheese, no alternative)", veganDeal.satisfiesAll === false);

  const fixedRecipe = evaluateDominosDeal("1 Medium Feast Pizza", ["vegetarian"]);
  check("a fixed-recipe deal with unknown composition is UNKNOWN, not guessed either way", fixedRecipe.status === "UNKNOWN" && fixedRecipe.satisfiesAll === false);
}

// --- Live menu item/topping identifiers map correctly into curated dietary data ---
{
  console.log("Live topping identifiers (real codes -> resolved names) map correctly into curated data");
  await (async () => {
    const original = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/profile")) {
        return { ok: true, status: 200, json: async () => ({ IsOpen: true, IsOnlineNow: true }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          Products: {
            S_TEST: {
              Code: "S_TEST",
              Name: "Test Custom Pizza",
              ProductType: "Pizza",
              DefaultToppings: "P=1,H=1,O=1",
              Tags: {},
              Variants: [],
            },
          },
          Variants: {},
          Toppings: {
            Pizza: {
              P: { Name: "Pepperoni" },
              H: { Name: "Ham" },
              O: { Name: "Onions" },
            },
          },
          Coupons: {},
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const snapshot = await getDominosStoreSnapshot("10950");
      const toppings = snapshot.products[0]?.toppings ?? [];
      check("live DefaultToppings codes resolved to real names", JSON.stringify(toppings) === JSON.stringify(["Pepperoni", "Ham", "Onions"]));
      const evaluation = evaluateDominosDietary(snapshot.products[0].name, toppings, ["noPork"]);
      check("those live-resolved names map correctly into curated dietary data (Pepperoni/Ham -> No Pork fails)", evaluation.satisfiesAll === false && evaluation.status === "CONTAINS");
    } finally {
      global.fetch = original;
    }
  })();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
}

main();
