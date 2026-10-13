/**
 * Fixed-window request counter used to blunt a naive request loop against the
 * model-invoking API routes.
 *
 * Deliberate limits, so nobody mistakes this for real enforcement:
 * - The window lives in this process's memory. On a serverless deployment each
 *   instance keeps its own count and a cold start resets it, so a distributed
 *   or sustained attack is not stopped. Next's own Proxy documentation warns
 *   against relying on globals here for exactly that reason.
 * - The key is a client-supplied forwarding header, which a direct caller can
 *   spoof. It is only trustworthy behind a proxy that overwrites it.
 *
 * The real control is rate limiting at the edge (platform WAF/firewall) in
 * front of `/api/*`. This exists so the deployed demo is not trivially
 * drainable by a single `curl` loop, and it fails open rather than blocking
 * legitimate traffic.
 */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;

/** Bounds the counter map so it cannot itself become a memory leak. */
const MAX_TRACKED_KEYS = 5_000;

interface CounterWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, CounterWindow>();

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Identifies the caller as well as a reverse proxy allows. Returns a single
 * shared bucket when no forwarding header is present, which is the
 * conservative choice: an unidentifiable flood is still counted.
 */
export function rateLimitKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  return firstHop || request.headers.get("x-real-ip")?.trim() || "unidentified";
}

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = RATE_LIMIT_MAX_REQUESTS,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): RateLimitDecision {
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) prune(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, remaining: max - existing.count, retryAfterSeconds: 0 };
}

/** Test seam: the window map is module state, so tests must be able to clear it. */
export function resetRateLimitState(): void {
  windows.clear();
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many requests. Please wait a moment and try again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}
