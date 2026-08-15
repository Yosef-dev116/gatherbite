import {
  getDominosStoreSnapshot,
  type DominosDeal,
  type DominosProduct,
  type DominosStoreSnapshot,
  type DominosTimingObserver,
  type DominosToppingOption,
  type DominosVariant,
} from "./dominos";

export interface DominosCatalogDeal extends DominosDeal {
  /** Capacity belongs to explicit deal evidence only; null is honest unknown. */
  trustedSlices: number | null;
}

export interface DominosCatalog {
  storeId: string;
  snapshotVersion: string;
  productsByCode: ReadonlyMap<string, DominosProduct>;
  variantsByCode: ReadonlyMap<string, DominosVariant>;
  toppingsByCode: ReadonlyMap<string, DominosToppingOption>;
  dealsByCode: ReadonlyMap<string, DominosCatalogDeal>;
}

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#values = new Map(entries);
  }

  get size(): number { return this.#values.size; }
  get(key: K): V | undefined { return this.#values.get(key); }
  has(key: K): boolean { return this.#values.has(key); }
  entries(): MapIterator<[K, V]> { return this.#values.entries(); }
  keys(): MapIterator<K> { return this.#values.keys(); }
  values(): MapIterator<V> { return this.#values.values(); }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#values.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#values[Symbol.iterator](); }
  get [Symbol.toStringTag](): string { return "ImmutableMap"; }
}

function immutableMap<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  return Object.freeze(new ImmutableMap(entries));
}

function freezeProduct(product: DominosProduct): DominosProduct {
  return Object.freeze({
    ...product,
    toppings: product.toppings ? Object.freeze([...product.toppings]) as unknown as string[] : null,
    defaultToppingCodes: Object.freeze([...product.defaultToppingCodes]),
    variantCodes: Object.freeze([...product.variantCodes]),
  });
}

export function buildDominosCatalog(snapshot: DominosStoreSnapshot): DominosCatalog {
  const products = snapshot.products
    .filter((product) => product.id.length > 0)
    .map((product) => freezeProduct(product));
  const variants = (snapshot.variants ?? [])
    .filter((variant) => variant.code.length > 0)
    .map((variant) => Object.freeze({ ...variant }));
  const toppings = (snapshot.toppingOptions ?? [])
    .filter((topping) => topping.code.length > 0)
    .map((topping) => Object.freeze({ ...topping }));
  const deals = snapshot.deals
    .filter((deal) => deal.code.length > 0)
    .map((deal): DominosCatalogDeal => Object.freeze({ ...deal, trustedSlices: deal.slices }));

  return Object.freeze({
    storeId: snapshot.storeId,
    snapshotVersion: `${snapshot.storeId}:${snapshot.fetchedAt}`,
    productsByCode: immutableMap(products.map((product) => [product.id, product] as const)),
    variantsByCode: immutableMap(variants.map((variant) => [variant.code, variant] as const)),
    toppingsByCode: immutableMap(toppings.map((topping) => [topping.code, topping] as const)),
    dealsByCode: immutableMap(deals.map((deal) => [deal.code, deal] as const)),
  });
}

function normalizeStoreIds(storeIds: readonly string[]): { ids: string[]; errors: string[] } {
  const ids: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const rawId of storeIds) {
    const storeId = rawId.trim();
    if (!storeId) {
      errors.push("Parser rejected empty store identifier");
      continue;
    }
    if (seen.has(storeId)) {
      errors.push(`Parser rejected duplicate store identifier: ${storeId}`);
      continue;
    }
    seen.add(storeId);
    ids.push(storeId);
  }

  return { ids, errors };
}

export async function observeSupportedDominosStores(
  storeIds: readonly string[],
  onTiming?: DominosTimingObserver,
  signal?: AbortSignal,
): Promise<readonly DominosStoreSnapshot[]> {
  const normalized = normalizeStoreIds(storeIds);
  const snapshots = await Promise.all(
    normalized.ids.map((storeId) => getDominosStoreSnapshot(storeId, onTiming, signal)),
  );

  if (snapshots[0] && normalized.errors.length > 0) {
    snapshots[0] = {
      ...snapshots[0],
      errors: [...snapshots[0].errors, ...normalized.errors],
    };
  }

  return Object.freeze(snapshots);
}
