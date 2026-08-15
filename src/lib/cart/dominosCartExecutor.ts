import { compareDominosCart } from "./dominosCartComparator";
import type {
  ActualDominosCart,
  CartComparison,
  CartPreparationResult,
  CartPreparationStatus,
  DominosCartExecutor,
  PrepareCartInput,
} from "./contracts";
import { buildGuidedHandoff } from "./dominosCartFallback";
import { guardBrowserAction } from "./dominosCartGuard";
import type { SafeBrowserAction } from "./dominosCartGuard";

/**
 * One read-only observation of the official Domino's page, taken fresh
 * before every guarded action. `pageKind` names the semantic area the
 * automation currently sees; `"captcha"` and `"login"` are terminal —
 * automation must stop immediately rather than attempt or retry anything.
 */
export interface BrowserSnapshot {
  url: string;
  title: string;
  pageKind: "locator" | "menu" | "configuration" | "cart" | "checkout" | "captcha" | "login" | "unknown";
  controls: Array<{ role: string; label: string; disabled: boolean }>;
  cart: ActualDominosCart | null;
}

/**
 * The narrow surface the executor is allowed to drive a real (or, for now,
 * only proven-fake) browser session through. Only `"transferable-browser"`
 * mode ever calls this; `perform` must only ever be called with an action
 * that already passed `guardBrowserAction`.
 */
export interface BrowserDriver {
  snapshot(): Promise<BrowserSnapshot>;
  perform(action: SafeBrowserAction): Promise<void>;
  handoffUrl(): Promise<string | null>;
  close(): Promise<void>;
}

/** At most three attempts per recoverable step (brief Step 1). */
const MAX_STEP_ATTEMPTS = 3;

/** One initial build, plus at most one corrective rebuild (brief Step 1). */
const MAX_BUILD_PHASES = 2;

const BUILD_ACTION: SafeBrowserAction = {
  kind: "click",
  label: "Add the approved pizzas to the official cart",
  context: "cart",
};

function notReady(
  status: CartPreparationStatus,
  fallback: ReturnType<typeof buildGuidedHandoff>,
  reason: string,
): CartPreparationResult {
  return { status, actualCart: null, comparison: null, handoffUrl: null, fallback, reason };
}

function pageBlockResult(
  snapshot: BrowserSnapshot,
  fallback: ReturnType<typeof buildGuidedHandoff>,
): CartPreparationResult | null {
  if (snapshot.pageKind === "captcha") {
    return {
      status: "NEEDS_HUMAN_CAPTCHA",
      actualCart: snapshot.cart,
      comparison: null,
      handoffUrl: null,
      fallback,
      reason: "The official page presented a CAPTCHA; automation stops immediately without consuming the recovery budget.",
    };
  }
  if (snapshot.pageKind === "login") {
    return {
      status: "NEEDS_HUMAN_LOGIN",
      actualCart: snapshot.cart,
      comparison: null,
      handoffUrl: null,
      fallback,
      reason: "The official page requires authentication; automation stops immediately without consuming the recovery budget.",
    };
  }
  return null;
}

type BuildPhaseOutcome =
  | { blocked: true; result: CartPreparationResult }
  | { blocked: false; snapshot: BrowserSnapshot };

/**
 * One "build phase": read a fresh snapshot, perform exactly one guarded
 * action (retried up to `MAX_STEP_ATTEMPTS` times only on a thrown/transient
 * failure — never on a CAPTCHA/login page, which stops immediately), then
 * read a fresh snapshot again to observe the result. Redirects to a
 * CAPTCHA/login page at either snapshot end the phase immediately.
 */
async function runBuildPhase(
  driver: BrowserDriver,
  hasTimedOut: () => boolean,
  fallback: ReturnType<typeof buildGuidedHandoff>,
): Promise<BuildPhaseOutcome> {
  if (hasTimedOut()) {
    return { blocked: true, result: notReady("TIMED_OUT", fallback, "Preparation exceeded the configured timeout before this step could run.") };
  }

  const preSnapshot = await driver.snapshot();
  const preBlock = pageBlockResult(preSnapshot, fallback);
  if (preBlock) return { blocked: true, result: preBlock };

  if (hasTimedOut()) {
    return { blocked: true, result: notReady("TIMED_OUT", fallback, "Preparation exceeded the configured timeout before this step could run.") };
  }

  const guard = guardBrowserAction(BUILD_ACTION);
  if (!guard.allowed) {
    return { blocked: true, result: notReady("AUTOMATION_UNAVAILABLE", fallback, guard.reason) };
  }

  let performed = false;
  let attempts = 0;
  let lastError: unknown = null;
  while (attempts < MAX_STEP_ATTEMPTS && !performed) {
    attempts += 1;
    try {
      await driver.perform(BUILD_ACTION);
      performed = true;
    } catch (error) {
      lastError = error;
    }
  }
  if (!performed) {
    return {
      blocked: true,
      result: notReady(
        "AUTOMATION_UNAVAILABLE",
        fallback,
        `The build action failed after ${attempts} attempt(s): ${String(lastError)}`,
      ),
    };
  }

  if (hasTimedOut()) {
    return { blocked: true, result: notReady("TIMED_OUT", fallback, "Preparation exceeded the configured timeout after this step ran.") };
  }

  const postSnapshot = await driver.snapshot();
  const postBlock = pageBlockResult(postSnapshot, fallback);
  if (postBlock) return { blocked: true, result: postBlock };

  return { blocked: false, snapshot: postSnapshot };
}

async function runTransferableBrowserFlow(
  driver: BrowserDriver,
  input: PrepareCartInput,
  timeoutMs: number,
  fallback: ReturnType<typeof buildGuidedHandoff>,
): Promise<CartPreparationResult> {
  const startedAt = Date.now();
  const hasTimedOut = () => Date.now() - startedAt > timeoutMs;

  try {
    let lastSnapshot: BrowserSnapshot | null = null;
    let comparison: CartComparison | null = null;

    for (let phase = 0; phase < MAX_BUILD_PHASES; phase += 1) {
      const outcome = await runBuildPhase(driver, hasTimedOut, fallback);
      if (outcome.blocked) return outcome.result;

      lastSnapshot = outcome.snapshot;
      if (!lastSnapshot.cart) {
        return notReady("AUTOMATION_UNAVAILABLE", fallback, "The build step completed but no cart could be observed on the resulting page.");
      }

      comparison = compareDominosCart(input.candidate, lastSnapshot.cart);
      if (comparison.matches) break;

      const isLastPhase = phase === MAX_BUILD_PHASES - 1;
      if (isLastPhase) {
        return {
          status: "CART_MISMATCH",
          actualCart: lastSnapshot.cart,
          comparison,
          handoffUrl: null,
          fallback,
          reason: "The observed cart still did not match the approved candidate after one corrective rebuild.",
        };
      }
      // Otherwise fall through to the one permitted corrective rebuild.
    }

    if (hasTimedOut()) {
      return notReady("TIMED_OUT", fallback, "Preparation exceeded the configured timeout after the cart was built.");
    }

    const handoffUrl = await driver.handoffUrl();
    if (!handoffUrl) {
      return {
        status: "SESSION_NOT_TRANSFERABLE",
        actualCart: lastSnapshot!.cart,
        comparison,
        handoffUrl: null,
        fallback,
        reason: "The observed cart matched, but the browser session could not be transferred to the organizer.",
      };
    }

    return {
      status: "PREPARED_AND_OBSERVED",
      actualCart: lastSnapshot!.cart,
      comparison,
      handoffUrl,
      fallback,
      reason: null,
    };
  } finally {
    await driver.close();
  }
}

/**
 * Builds a bounded executor for the one mode selected by config. Guided and
 * deep-link modes never touch a browser or network — Task 2's live research
 * proved neither cart creation, secure session takeover, nor useful
 * deep-link state, so both immediately return the exact guided handoff.
 * Only `"transferable-browser"` runs the bounded state machine against an
 * injected `BrowserDriver`, and it only ever claims a prepared cart when the
 * driver's own snapshot evidence shows it — there is no "assume success"
 * path. Every non-success result (any mode) carries the exact guided
 * handoff fallback so an organizer always has a way forward.
 */
export function createDominosCartExecutor(config: {
  mode: "transferable-browser" | "supported-deep-link" | "guided-handoff";
  browserDriver?: BrowserDriver;
  timeoutMs: number;
}): DominosCartExecutor {
  return {
    async prepare(input: PrepareCartInput): Promise<CartPreparationResult> {
      const fallback = buildGuidedHandoff(input.candidate);

      if (config.mode === "guided-handoff") {
        return notReady(
          "FALLBACK_READY",
          fallback,
          "Guided-handoff mode always returns the exact manual order guide; no cart creation was ever proven, so no automation was attempted.",
        );
      }

      if (config.mode === "supported-deep-link") {
        return notReady(
          "FALLBACK_READY",
          fallback,
          "No deep-link state was proven by Task 2's research, so this mode returns only the guide — the same as guided-handoff.",
        );
      }

      // mode === "transferable-browser"
      if (!config.browserDriver) {
        return notReady(
          "AUTOMATION_UNAVAILABLE",
          fallback,
          "transferable-browser mode requires a browserDriver, and none was configured.",
        );
      }

      return runTransferableBrowserFlow(config.browserDriver, input, config.timeoutMs, fallback);
    },
  };
}
