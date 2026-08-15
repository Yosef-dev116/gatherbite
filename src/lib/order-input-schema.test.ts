import { verifyPlan } from "./verify";
import { estimateMinimumWorkableBudget } from "./scoring";
import { OrderInputSchema, describeValidationError } from "./order-input-schema";
import type { BuildOrderInput, PlanLine } from "./types";

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

// --- Scenario 1: zero dietary groups is a fully valid, normal order -
// "no dietary restrictions" is an empty array, and both the schema and
// the deterministic logic downstream must accept it cleanly.
{
  console.log("Scenario 1: zero dietary groups is valid");
  const parsed = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [],
  });
  check("schema accepts an empty groups array", parsed.success === true);

  const input: BuildOrderInput = { attendees: 12, budget: 100, storeId: "10088", groups: [] };
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 5 }]; // 40 slices >= 36 required
  const result = verifyPlan(plan, input);
  check("verifyPlan handles zero groups and verifies normally", result.verified === true);
  check("groupCoverage is an empty array, not an error", result.groupCoverage.length === 0);

  const estimate = estimateMinimumWorkableBudget({ attendees: 12, groups: [] });
  check("budget estimation works with zero groups", estimate !== null);
}

// --- Scenario 2: invalid group counts are rejected by the schema, and
// never as a raw Zod/validation object - always a short, human string.
{
  console.log("Scenario 2: invalid group people counts are rejected with a human message");

  const zeroPeople = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [{ id: "g0", people: 0, restrictions: [], notes: "" }],
  });
  check("schema rejects a group with 0 people", zeroPeople.success === false);
  if (!zeroPeople.success) {
    const message = describeValidationError(zeroPeople.error);
    check("error message is a plain string", typeof message === "string");
    check("error message does not look like raw JSON", !message.trim().startsWith("{"));
    check(
      "error message explains the actual problem (people count)",
      message.toLowerCase().includes("person") || message.toLowerCase().includes("people")
    );
  }

  const negativePeople = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [{ id: "g0", people: -1, restrictions: [], notes: "" }],
  });
  check("schema rejects a negative group people count", negativePeople.success === false);

  const fractionalPeople = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [{ id: "g0", people: 2.5, restrictions: [], notes: "" }],
  });
  check("schema rejects a non-integer group people count", fractionalPeople.success === false);

  const validGroup = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [{ id: "g0", people: 1, restrictions: ["vegetarian"], notes: "" }],
  });
  check("schema accepts a group with exactly 1 person", validGroup.success === true);
}

// --- Scenario 3: pizza preferences are optional, bounded, and separate
// from dietary restrictions.
{
  console.log("Scenario 3: optional pizza preference validation");
  const validPreferences = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [],
    pizzaPreferences: ["cheese", "pepperoni", "veggie"],
  });
  check("schema accepts known pizza preferences", validPreferences.success === true);

  const omittedPreferences = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [],
  });
  check("preferences remain optional for backward compatibility", omittedPreferences.success === true);

  const invalidPreference = OrderInputSchema.safeParse({
    attendees: 12,
    budget: 100,
    storeId: "10088",
    groups: [],
    pizzaPreferences: ["anchovy-surprise"],
  });
  check("schema rejects unknown preference values", invalidPreference.success === false);
  if (!invalidPreference.success) {
    check(
      "invalid preference gets a human-readable message",
      describeValidationError(invalidPreference.error).toLowerCase().includes("pizza preference")
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
