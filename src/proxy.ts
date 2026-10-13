import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { checkRateLimit, rateLimitKey, rateLimitedResponse } from "@/lib/http/rateLimit";

/**
 * Every `/api/*` route reaches a paid model call, so a single request loop can
 * drain the provider quota the deployed demo depends on. See
 * `src/lib/http/rateLimit.ts` for what this does and does not protect: it is a
 * per-instance best effort, not a substitute for edge rate limiting.
 */
export function proxy(request: NextRequest) {
  const decision = checkRateLimit(rateLimitKey(request));
  if (!decision.allowed) return rateLimitedResponse(decision.retryAfterSeconds);
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
