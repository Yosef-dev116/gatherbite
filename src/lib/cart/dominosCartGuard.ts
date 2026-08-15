/**
 * A single proposed browser interaction, evaluated before it is ever
 * executed. `context` names the semantic area of the page the action would
 * occur in (e.g. "menu", "cart", "checkout", "captcha", "login", "payment").
 */
export interface SafeBrowserAction {
  kind: "click" | "type" | "select" | "navigate";
  label: string;
  context: string;
}

export interface BrowserActionGuardResult {
  allowed: boolean;
  reason: string;
}

/** Reversible, non-purchasing intents that automation is permitted to touch. */
const SAFE_CONTEXTS = new Set([
  "menu",
  "store",
  "store-selection",
  "service-method",
  "address",
  "deal",
  "cart",
  "cart-navigation",
  "configuration",
]);

/** Contexts that are never automated, regardless of label. */
const UNSAFE_CONTEXTS = new Set([
  "checkout",
  "captcha",
  "login",
  "authentication",
  "credentials",
  "payment",
]);

/** Labels that complete a purchase or submit an order, regardless of context. */
const PURCHASE_COMPLETION_PATTERN = /place\s*order|pay\s*now|complete\s*checkout|confirm\s*purchase|submit\s*order|checkout\s*now|buy\s*now|finali[sz]e\s*order/i;

/** Labels that are a CAPTCHA / bot-verification challenge, regardless of context. */
const CAPTCHA_PATTERN = /captcha|not\s*a\s*robot|verify\s*you.?re\s*human/i;

/** Labels that submit credentials or payment details, regardless of context. */
const CREDENTIAL_PATTERN = /password|sign\s*in|log\s*in|username|credit\s*card|card\s*number|cvv|expiry/i;

function denied(reason: string): BrowserActionGuardResult {
  return { allowed: false, reason };
}

function allowed(reason: string): BrowserActionGuardResult {
  return { allowed: true, reason };
}

/**
 * Deterministic safety guard for browser automation. It never automates
 * payment/submission or bypasses CAPTCHA, authentication, origin
 * protections, or anti-bot controls. It fails closed: an action is allowed
 * only when it is a known reversible, non-purchasing intent and does not
 * match a denied semantic purpose. This is a protocol guard, not
 * verification authority — it only permits or denies one proposed action.
 */
export function guardBrowserAction(action: SafeBrowserAction): BrowserActionGuardResult {
  const label = action.label.trim();
  const context = action.context.trim().toLowerCase();

  if (PURCHASE_COMPLETION_PATTERN.test(label)) {
    return denied(`"${label}" completes payment or submits an order, which is never automated.`);
  }
  if (CAPTCHA_PATTERN.test(label) || context === "captcha") {
    return denied(`"${label}" is a CAPTCHA or bot-verification interaction, which is never automated.`);
  }
  if (CREDENTIAL_PATTERN.test(label)) {
    return denied(`"${label}" submits credentials or payment details, which is never automated.`);
  }
  if (UNSAFE_CONTEXTS.has(context)) {
    return denied(`Actions in the "${context}" context are never automated.`);
  }
  if (!SAFE_CONTEXTS.has(context)) {
    return denied(`"${context}" is not a recognized safe, reversible context; denied by default.`);
  }
  return allowed(`"${label}" is a reversible ${context} action.`);
}
