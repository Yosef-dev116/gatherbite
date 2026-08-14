import { z } from "zod";
import { ALL_RESTRICTIONS } from "./types";

/**
 * Zero dietary groups is valid (no `.min()` on the array) - "no dietary
 * restrictions" is represented by an empty groups array, never by a
 * group object with people: 0. Any group that DOES exist must have at
 * least 1 person.
 */
export const OrderInputSchema = z.object({
  attendees: z.number().int().min(1).max(200),
  budget: z.number().positive().max(5000),
  storeId: z.string().min(1),
  groups: z
    .array(
      z.object({
        id: z.string(),
        people: z.number().int().min(1),
        restrictions: z.array(z.enum(ALL_RESTRICTIONS as [string, ...string[]])),
        notes: z.string().max(200).optional(),
      })
    )
    .max(10),
});

/**
 * Turns a Zod validation failure into one short, human-readable
 * sentence. Raw Zod/validation error objects must never reach the user.
 */
export function describeValidationError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Please check your inputs and try again.";

  const path = issue.path.join(".");

  if (path.includes("people")) {
    return "Each dietary group needs at least 1 person — remove the group instead if it doesn't apply.";
  }
  if (path === "attendees") {
    return "Number of people must be between 1 and 200.";
  }
  if (path === "budget") {
    return "Budget must be a positive number.";
  }
  if (path.includes("restrictions")) {
    return "One of the dietary groups has an invalid restriction selected.";
  }
  if (path === "groups") {
    return "You can have at most 10 dietary groups.";
  }
  return "Please check your inputs and try again.";
}
