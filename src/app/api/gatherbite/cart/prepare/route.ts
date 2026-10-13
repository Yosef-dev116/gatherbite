import type { ZodError } from "zod";

import { GatherBiteInputSchema } from "@/lib/gatherbite/contracts";
import {
  createDefaultPrepareCartDependencies,
  InvalidCartCandidateError,
  prepareSelectedDominosCart,
  type CartEventSink,
  type PrepareCartDependencies,
} from "@/lib/cart/prepareCart";
import type { CartPreparationResult } from "@/lib/cart/contracts";
import { jsonBodyErrorResponse, readJsonBody } from "@/lib/http/readJsonBody";

export const runtime = "nodejs";

/**
 * A selected candidate is the largest body any GatherBite route accepts, so
 * this route raises the shared 64 KiB default. The bound is deliberate, not a
 * guess: the largest body `DominosCandidateSchema` + `GatherBiteInputSchema`
 * can accept is ~136 KiB (100 pizza lines at the schemas' maximum identifier
 * and menu-code lengths), so no schema-valid request can be refused by the
 * byte cap. `route.test.ts` pins that relationship.
 */
export const MAX_CART_PREPARE_JSON_BYTES = 192 * 1024;

type CartEvent = Parameters<CartEventSink>[0];

export type PrepareCartRouteHandler = (
  candidateInput: unknown,
  input: ReturnType<typeof GatherBiteInputSchema.parse>,
  deps: PrepareCartDependencies,
  onEvent?: CartEventSink,
  externalSignal?: AbortSignal,
) => Promise<CartPreparationResult>;

function validationMessage(error: ZodError): string {
  const path = error.issues[0]?.path.join(".") ?? "";
  if (path === "deliveryAddress") return "Enter a delivery address for Delivery or Either.";
  if (path === "attendees") return "Number of people must be between 1 and 200.";
  if (path === "budgetCad") return "Budget must be a positive number.";
  if (path.includes("groups") && path.includes("people")) return "Each dietary group needs at least 1 person.";
  if (path.includes("restrictions")) return "One of the dietary groups has an invalid restriction selected.";
  if (path.includes("pizzaPreferences")) return "One of the selected pizza preferences is invalid.";
  return "Please check your inputs and try again.";
}

/**
 * Never returns a rejected promise: `candidateInput` is untrusted client
 * input, and `InvalidCartCandidateError` is the one documented way
 * `prepareSelectedDominosCart` signals it — this route is the boundary that
 * turns it into a public 400, the same way the existing GatherBite routes
 * turn a Zod validation failure into one.
 */
const defaultPrepare: PrepareCartRouteHandler = (candidateInput, input, deps, onEvent, externalSignal) => prepareSelectedDominosCart(
  candidateInput,
  input,
  deps,
  onEvent,
  externalSignal,
);

export function createCartPreparePostHandler(prepare: PrepareCartRouteHandler = defaultPrepare) {
  return async function post(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await readJsonBody(request, MAX_CART_PREPARE_JSON_BYTES);
    } catch (error) {
      return jsonBodyErrorResponse(error);
    }

    const record = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
    const parsedInput = GatherBiteInputSchema.safeParse(record.input);
    if (!parsedInput.success) {
      return Response.json(
        { error: validationMessage(parsedInput.error) },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const deps = createDefaultPrepareCartDependencies(request.signal);
    const events: CartEvent[] = [];
    const onEvent: CartEventSink = (event) => {
      // Never expose anything beyond the intentionally small public cart
      // event contract — no address, payload, or private reasoning ever
      // flows through this sink.
      events.push(event);
    };

    try {
      const result = await prepare(record.candidate, parsedInput.data, deps, onEvent, request.signal);
      return Response.json(
        { events, result },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (request.signal.aborted) {
        return Response.json(
          { error: "This request was cancelled." },
          { status: 499, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (error instanceof InvalidCartCandidateError) {
        return Response.json(
          { error: "The selected order could not be validated." },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        { error: "GatherBite could not prepare this cart." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const POST = createCartPreparePostHandler();
