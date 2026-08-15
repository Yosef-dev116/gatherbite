/**
 * Domino's Canada store adapter — live-fetches the same public,
 * unauthenticated "power" endpoints order.dominos.ca's own website uses
 * (proven live against real stores 10950/10953 in the research spike)
 * and normalizes the response.
 *
 * This is a data source only. It does NOT touch the existing Little
 * Caesars flow, does not perform checkout, and does not make any
 * dietary-safety claim — Domino's dietary compatibility is always
 * unknown here; see compareDominosStores in dominosCompare.ts.
 */

const PROFILE_URL = (storeId: string) => `https://order.dominos.ca/power/store/${storeId}/profile`;
const MENU_URL = (storeId: string) => `https://order.dominos.ca/power/store/${storeId}/menu?lang=en&structured=true`;

/** How long to wait for each endpoint before treating it as failed. */
export const FETCH_TIMEOUT_MS = 8000;

export type DominosFetchStage = "profile" | "menu";

export interface DominosTimingEvent {
  storeId: string;
  stage: DominosFetchStage;
  durationMs: number;
}

export type DominosTimingObserver = (event: DominosTimingEvent) => void;

export interface WaitMinutes {
  min: number;
  max: number;
}

export interface DominosDeal {
  code: string;
  name: string;
  /** Real price parsed from the live response, or null if it couldn't be
   * confidently parsed — never a hardcoded/invented number. */
  price: number | null;
  /** Raw real conditions text (e.g. "Carryout,Delivery") when available. */
  conditions: string | null;
  /**
   * Trusted total pizza slice count for ONE unit of this deal, or null
   * when it can't be confidently determined from real data. Only ever
   * set from an explicit real serving-count field (never guessed from a
   * product name), and only for deals we can confirm represent exactly
   * one pizza — a bundle named like "2 Medium Pizzas..." is deliberately
   * left null even if it has serving text, because whether that number
   * is per-pizza or a grand total isn't reliably derivable. Non-pizza
   * items (drinks, dips, wings, pasta, sides) never have "slices"/pizza
   * serving-fraction wording in the real data, so they naturally end up
   * null too — this field IS the "pizza only" feeding-capacity signal.
   */
  slices: number | null;
}

/** A live deal name starting with an explicit count of 2 or more (e.g.
 * "2 Medium Pizzas...") — its stated serving text can't be trusted as a
 * single-pizza total, so capacity is left unknown rather than guessed. */
function startsWithMultiCount(name: string): boolean {
  const match = name.trim().match(/^(\d+)\s/);
  return match !== null && parseInt(match[1], 10) >= 2;
}

/**
 * Parses a real, trusted total slice count for ONE unit of a deal from
 * its own Tags — either an explicit "N slices" serving string, or a
 * "1/N pizza" serving-size fraction (both confirmed real formats from
 * live Domino's data). Returns null (unknown, not zero) for anything
 * that doesn't cleanly match, including deals bundled with a non-pizza
 * component (e.g. "8 slices; 2pcs bread") where the number's scope is
 * ambiguous, and named multi-pizza bundles.
 */
function parseDealSlices(name: string, tags: Record<string, unknown> | undefined): number | null {
  if (startsWithMultiCount(name)) return null;

  const servings = typeof tags?.Servings === "string" ? tags.Servings.trim() : "";
  const slicesMatch = servings.match(/^(\d+)\s*slices?$/i);
  if (slicesMatch) return parseInt(slicesMatch[1], 10);

  const servingSize = typeof tags?.ServingSize === "string" ? tags.ServingSize.trim() : "";
  const fractionMatch = servingSize.match(/^1\s*\/\s*(\d+)\s*pizza$/i);
  if (fractionMatch) return parseInt(fractionMatch[1], 10);

  return null;
}

export interface DominosProduct {
  id: string;
  name: string;
  category: string | null;
  /** Real topping names resolved from the store's own topping index where
   * possible (falls back to the raw code if unresolved). Null means this
   * product has no default toppings data — NOT "no toppings verified
   * safe"; this is raw menu data, not a dietary claim. */
  toppings: string[] | null;
  /** Exact live component codes. These are never reconstructed from names. */
  defaultToppingCodes: readonly string[];
  /** Exact live variant codes offered for this product. */
  variantCodes: readonly string[];
  /** Real price from the product's default variant, if one exists. */
  priceInfoIfAvailable: number | null;
}

export interface DominosToppingOption {
  code: string;
  name: string;
  category: string | null;
}

export interface DominosVariant {
  code: string;
  /** Exact live organizer-facing variant name, or null when absent. */
  name?: string | null;
  productCode: string | null;
  sizeCode: string | null;
  crustCode: string | null;
  priceCad: number | null;
  /** Trusted only when the variant itself contains explicit serving evidence. */
  trustedSlices: number | null;
}

export type DominosSnapshotStatus = "ok" | "partial" | "failed";

export interface DominosStoreSnapshot {
  provider: "dominos";
  storeId: string;
  address: string | null;
  isOpen: boolean | null;
  isOnlineNow: boolean | null;
  deliveryAvailable: boolean | null;
  carryoutAvailable: boolean | null;
  deliveryWaitMinutes: WaitMinutes | null;
  carryoutWaitMinutes: WaitMinutes | null;
  deals: DominosDeal[];
  products: DominosProduct[];
  variants?: DominosVariant[];
  toppingOptions?: DominosToppingOption[];
  fetchedAt: string;
  /** "ok" = both profile and menu fetched; "partial" = only one did;
   * "failed" = neither did. Callers must handle "partial"/"failed"
   * explicitly rather than assuming every field is populated. */
  status: DominosSnapshotStatus;
  /** Human-readable description of anything that failed, if anything. */
  errors: string[];
}

/** Turns a fetch/abort failure into a short, human-readable reason. */
export function describeError(reason: unknown): string {
  if (reason instanceof Error) {
    if (reason.name === "AbortError") return "timed out";
    return reason.message;
  }
  return String(reason);
}

class DominosHttpError extends Error {
  readonly statusCode: number;
  readonly retryAfterMs: number;

  constructor(statusCode: number, retryAfterMs: number) {
    super(`HTTP ${statusCode}`);
    this.name = "DominosHttpError";
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMilliseconds(value: string | null | undefined): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function isTransientFetchError(error: unknown, callerSignal?: AbortSignal): boolean {
  if (callerSignal?.aborted) return false;
  if (error instanceof DominosHttpError) {
    return error.statusCode === 408 || error.statusCode === 425 || error.statusCode === 429
      || (error.statusCode >= 500 && error.statusCode <= 599);
  }
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error === null || typeof error !== "object") return false;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && [
    "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
  ].includes(code);
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, delayMs);
    if (signal?.aborted) aborted();
    else signal?.addEventListener("abort", aborted, { once: true });
  });
}

async function fetchJson(
  url: string,
  storeId: string,
  stage: DominosFetchStage,
  onTiming?: DominosTimingObserver,
  signal?: AbortSignal,
): Promise<unknown> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new DominosHttpError(
        res.status,
        retryAfterMilliseconds(res.headers?.get?.("Retry-After")),
      );
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
    onTiming?.({ storeId, stage, durationMs: performance.now() - startedAt });
  }
}

async function fetchJsonWithOneTransientRetry(
  url: string,
  storeId: string,
  stage: DominosFetchStage,
  onTiming?: DominosTimingObserver,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    return await fetchJson(url, storeId, stage, onTiming, signal);
  } catch (error) {
    if (!isTransientFetchError(error, signal)) throw error;
    const retryAfterMs = error instanceof DominosHttpError ? error.retryAfterMs : 0;
    await waitForRetry(retryAfterMs, signal);
    return fetchJson(url, storeId, stage, onTiming, signal);
  }
}

function parseWaitMinutes(raw: unknown): WaitMinutes | null {
  if (!raw || typeof raw !== "object") return null;
  const min = (raw as Record<string, unknown>).Min;
  const max = (raw as Record<string, unknown>).Max;
  if (typeof min !== "number" || typeof max !== "number") return null;
  return { min, max };
}

function parsePrice(raw: unknown): number | null {
  const value = typeof raw === "string" ? parseFloat(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractDeals(menu: Record<string, unknown>): DominosDeal[] {
  const coupons = menu?.Coupons;
  if (!coupons || typeof coupons !== "object") return [];
  return Object.values(coupons as Record<string, unknown>).map((raw) => {
    const c = raw as Record<string, unknown>;
    const tags = c.Tags as Record<string, unknown> | undefined;
    const validServiceMethods = tags?.ValidServiceMethods;
    const name = typeof c.Name === "string" ? c.Name : "";
    return {
      code: typeof c.Code === "string" ? c.Code : "",
      name,
      price: parsePrice(c.Price),
      conditions: Array.isArray(validServiceMethods) ? validServiceMethods.join(",") : null,
      slices: parseDealSlices(name, tags),
    };
  });
}

/** Flattens menu.Toppings (grouped by category: Bread/Pasta/Pizza/...)
 * into a single topping-code -> real-name lookup. */
function extractToppingOptions(toppings: unknown): DominosToppingOption[] {
  const options: DominosToppingOption[] = [];
  if (!toppings || typeof toppings !== "object") return options;
  for (const [categoryName, category] of Object.entries(toppings as Record<string, unknown>)) {
    if (!category || typeof category !== "object") continue;
    for (const [code, info] of Object.entries(category as Record<string, unknown>)) {
      const name = (info as Record<string, unknown> | undefined)?.Name;
      if (typeof name === "string" && name.length > 0) {
        options.push({ code, name, category: categoryName || null });
      }
    }
  }
  return options;
}

/** Parses a real DefaultToppings string like "K=1,J=1" (confirmed live
 * format) into topping codes, ignoring the quantity. */
function parseToppingCodes(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((part) => part.split("=")[0]?.trim())
    .filter((code): code is string => !!code);
}

function extractProducts(menu: Record<string, unknown>, toppingOptions: readonly DominosToppingOption[]): DominosProduct[] {
  const productsDict = menu?.Products;
  if (!productsDict || typeof productsDict !== "object") return [];
  const variantsDict = (menu?.Variants ?? {}) as Record<string, unknown>;
  const toppingIndex = new Map(toppingOptions.map((option) => [option.code, option.name]));

  return Object.values(productsDict as Record<string, unknown>).map((raw) => {
    const p = raw as Record<string, unknown>;
    const toppingCodes = parseToppingCodes(p.DefaultToppings);
    const toppings = toppingCodes.length > 0 ? toppingCodes.map((code) => toppingIndex.get(code) ?? code) : null;

    const tags = p.Tags as Record<string, unknown> | undefined;
    const variantCodes = Array.isArray(p.Variants)
      ? p.Variants.filter((code): code is string => typeof code === "string" && code.length > 0)
      : [];
    const defaultVariantCode = (typeof tags?.DefaultVariant === "string" ? tags.DefaultVariant : undefined) ?? variantCodes[0];
    const variant =
      typeof defaultVariantCode === "string" ? (variantsDict[defaultVariantCode] as Record<string, unknown> | undefined) : undefined;

    return {
      id: typeof p.Code === "string" ? p.Code : "",
      name: typeof p.Name === "string" ? p.Name : "",
      category: typeof p.ProductType === "string" ? p.ProductType : null,
      toppings,
      defaultToppingCodes: toppingCodes,
      variantCodes,
      priceInfoIfAvailable: parsePrice(variant?.Price),
    };
  });
}

function directOrNestedCode(
  raw: Record<string, unknown>,
  directKey: string,
  nestedKey: string,
): string | null {
  const direct = raw[directKey];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const nested = raw[nestedKey];
  if (!nested || typeof nested !== "object") return null;
  const code = (nested as Record<string, unknown>).Code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function extractVariants(menu: Record<string, unknown>, products: readonly DominosProduct[]): DominosVariant[] {
  const variantsDict = menu?.Variants;
  if (!variantsDict || typeof variantsDict !== "object") return [];

  const productByVariant = new Map<string, string>();
  for (const product of products) {
    for (const variantCode of product.variantCodes) productByVariant.set(variantCode, product.id);
  }

  return Object.entries(variantsDict as Record<string, unknown>).map(([dictionaryCode, raw]) => {
    const variant = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const code = typeof variant.Code === "string" && variant.Code.length > 0 ? variant.Code : dictionaryCode;
    const tags = variant.Tags as Record<string, unknown> | undefined;
    return {
      code,
      name: typeof variant.Name === "string" && variant.Name.trim().length > 0
        ? variant.Name.trim()
        : null,
      productCode: directOrNestedCode(variant, "ProductCode", "Product") ?? productByVariant.get(code) ?? null,
      sizeCode: directOrNestedCode(variant, "SizeCode", "Size"),
      crustCode: directOrNestedCode(variant, "CrustCode", "Crust"),
      priceCad: parsePrice(variant.Price),
      trustedSlices: parseDealSlices("", tags),
    };
  });
}

/**
 * Live-fetches a normalized snapshot of one Domino's Canada store.
 * Never throws — a failed or partially-failed fetch is returned as a
 * structured result (status: "partial" | "failed") rather than crashing
 * the caller. Every value is either real live data or null/unknown;
 * nothing is invented.
 */
export async function getDominosStoreSnapshot(
  storeId: string,
  onTiming?: DominosTimingObserver,
  signal?: AbortSignal,
): Promise<DominosStoreSnapshot> {
  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];

  const [profileResult, menuResult] = await Promise.allSettled([
    fetchJsonWithOneTransientRetry(PROFILE_URL(storeId), storeId, "profile", onTiming, signal),
    fetchJsonWithOneTransientRetry(MENU_URL(storeId), storeId, "menu", onTiming, signal),
  ]);

  let profile: Record<string, unknown> | null = null;
  if (profileResult.status === "fulfilled") {
    profile = profileResult.value as Record<string, unknown>;
  } else {
    errors.push(`Profile fetch failed: ${describeError(profileResult.reason)}`);
  }

  let menu: Record<string, unknown> | null = null;
  if (menuResult.status === "fulfilled") {
    menu = menuResult.value as Record<string, unknown>;
  } else {
    errors.push(`Menu fetch failed: ${describeError(menuResult.reason)}`);
  }

  const status: DominosSnapshotStatus = profile && menu ? "ok" : profile || menu ? "partial" : "failed";
  const serviceWaits = profile?.ServiceMethodEstimatedWaitMinutes as Record<string, unknown> | undefined;
  const toppingOptions = menu ? extractToppingOptions(menu.Toppings) : [];
  const products = menu ? extractProducts(menu, toppingOptions) : [];

  return {
    provider: "dominos",
    storeId,
    address: typeof profile?.AddressDescription === "string" ? profile.AddressDescription.trim() : null,
    isOpen: typeof profile?.IsOpen === "boolean" ? profile.IsOpen : null,
    isOnlineNow: typeof profile?.IsOnlineNow === "boolean" ? profile.IsOnlineNow : null,
    deliveryAvailable: typeof profile?.AllowDeliveryOrders === "boolean" ? profile.AllowDeliveryOrders : null,
    carryoutAvailable: typeof profile?.AllowCarryoutOrders === "boolean" ? profile.AllowCarryoutOrders : null,
    deliveryWaitMinutes: parseWaitMinutes(serviceWaits?.Delivery),
    carryoutWaitMinutes: parseWaitMinutes(serviceWaits?.Carryout),
    deals: menu ? extractDeals(menu) : [],
    products,
    variants: menu ? extractVariants(menu, products) : [],
    toppingOptions,
    fetchedAt,
    status,
    errors,
  };
}
