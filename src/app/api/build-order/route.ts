import { NextResponse } from "next/server";
import { buildOrder } from "@/lib/agent";
import { OrderInputSchema, describeValidationError } from "@/lib/order-input-schema";

export async function POST(request: Request) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const body = await request.json();
  const parsed = OrderInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: describeValidationError(parsed.error) }, { status: 400 });
  }

  const input = parsed.data as Parameters<typeof buildOrder>[0];
  const groupPeopleSum = input.groups.reduce((sum, g) => sum + g.people, 0);
  if (groupPeopleSum > input.attendees) {
    return NextResponse.json(
      { error: `Dietary group headcounts (${groupPeopleSum}) exceed total attendees (${input.attendees}).` },
      { status: 400 }
    );
  }

  try {
    const result = await buildOrder(input);
    return NextResponse.json(result);
  } catch (err) {
    console.error("buildOrder failed", err);
    return NextResponse.json({ error: "The agent failed to build an order. Check server logs." }, { status: 500 });
  }
}
