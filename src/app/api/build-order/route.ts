import { NextResponse } from "next/server";
import { buildOrder } from "@/lib/agent";
import { OrderInputSchema, describeValidationError } from "@/lib/order-input-schema";
import { jsonBodyErrorResponse, readJsonBody } from "@/lib/http/readJsonBody";

export async function POST(request: Request) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not configured on the server." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }
  const parsed = OrderInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeValidationError(parsed.error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const input = parsed.data as Parameters<typeof buildOrder>[0];
  const groupPeopleSum = input.groups.reduce((sum, g) => sum + g.people, 0);
  if (groupPeopleSum > input.attendees) {
    return NextResponse.json(
      { error: `Dietary group headcounts (${groupPeopleSum}) exceed total attendees (${input.attendees}).` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const result = await buildOrder(input);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "The agent failed to build an order." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
