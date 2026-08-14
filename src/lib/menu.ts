import rawMenu from "../data/menu-10088.json";
import type { MenuItem, Restriction } from "./types";

interface RawMenuItem {
  id?: string;
  name: string;
  category: string;
  price_cad: number;
  pizza_slices: number | null;
  other_pieces: number | null;
  pizza_cut_pieces: number | null;
  menu_description: string;
}

/**
 * Slice-count overrides for items where the source snapshot has no
 * pizza_slices/pizza_cut_pieces value. Little Caesars' Gluten Friendly
 * pizza is a fixed personal-size product; the snapshot's PDF extraction
 * didn't capture a slice count for it, so this is a disclosed planning
 * assumption (not an invented menu item or price) rather than data pulled
 * from the trusted source.
 */
const SLICE_COUNT_OVERRIDES: Record<string, number> = {
  "gluten-friendly-pizza-p8": 6,
};

const BUNDLE_ONLY_CATEGORIES = new Set(["bundles", "limited_time_offers"]);

function toMenuItem(raw: RawMenuItem): MenuItem | null {
  if (!raw.id) return null;
  const slices =
    raw.pizza_slices ?? raw.pizza_cut_pieces ?? SLICE_COUNT_OVERRIDES[raw.id] ?? 0;
  if (slices <= 0) return null; // sides/non-pizza items with no slice count are out of scope for the MVP
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    priceCad: raw.price_cad,
    slices,
    isBundle: BUNDLE_ONLY_CATEGORIES.has(raw.category),
    description: raw.menu_description,
  };
}

export const MENU_ITEMS: MenuItem[] = (rawMenu.items as RawMenuItem[])
  .map(toMenuItem)
  .filter((item): item is MenuItem => item !== null);

export const MENU_BY_ID: Record<string, MenuItem> = Object.fromEntries(
  MENU_ITEMS.map((item) => [item.id, item])
);

export const FEE_STRUCTURE = rawMenu.delivery_fees_from_snapshot;

/**
 * Trusted, developer-curated dietary tags. This is intentionally SEPARATE
 * from the source JSON's per-item `dietary_verified` field (which is
 * false for every item in the snapshot) and from `menu_label_hints`
 * (text-derived hints only). Nothing here is inferred by the LLM at
 * runtime — an item only counts toward a dietary group's coverage if it
 * is explicitly listed below. Unlisted restrictions are UNKNOWN, not
 * safe — they fail closed via itemSatisfies/anyMenuItemSatisfies.
 *
 * Curation notes:
 * - Vegetarian: only single, unambiguous cheese/veggie items (no
 *   "choose your topping/pizza" bundles, since the actual topping picked
 *   in those can't be confirmed from this data).
 * - Vegan / Dairy-Free: no item on this menu qualifies (Little Caesars'
 *   cheese and crusts are dairy-based; there is no dairy-free cheese
 *   option in this snapshot). Groups requiring these are honestly
 *   reported as unsatisfiable by this store rather than force-matched.
 * - Gluten-Friendly: only the named "Gluten Friendly Pizza". Little
 *   Caesars prepares this in a shared kitchen, so it is suitable for
 *   gluten-sensitivity/preference, not Celiac-safe — surfaced as a caveat.
 * - No Pork / No Beef / No Chicken: these are strict subsets of
 *   "no meat topping at all" — every item already tagged vegetarian
 *   above has no meat topping named on it, so it trivially cannot
 *   contain pork, beef, or chicken specifically, and gets all three
 *   tags. This is the SAME entailment already used for vegetarian, not
 *   a new inference. Items WITH a meat topping (pepperoni, bacon,
 *   sausage, chicken, ham, etc.) are deliberately left untagged for
 *   these three: our data has no verified ingredient breakdown telling
 *   us which specific meat(s) each specialty pizza contains, so we
 *   cannot safely claim e.g. "contains chicken but no pork." Unknown
 *   fails closed rather than guessing from the recipe name.
 * - No Egg / No Soy / No Mustard: NO item is tagged for these. Egg,
 *   soy, and mustard are not named toppings on this menu at all — they
 *   would only ever be hidden ingredients in dough, cheese, or sauce,
 *   and our data (names, prices, slice counts, calories) says nothing
 *   about that. There is no trustworthy way to mark any item safe, so
 *   every group requiring one of these correctly comes back
 *   dietary-impossible rather than a guess.
 */
export const DIETARY_TAGS: Record<string, { restrictions: Restriction[]; caveat?: string }> = {
  "gluten-friendly-pizza-p8": {
    restrictions: ["glutenFriendly", "vegetarian", "noPork", "noBeef", "noChicken"],
    caveat:
      "Assumed 6 slices (not in source snapshot) and cheese/veggie topping requested. Prepared in a shared kitchen — suitable for gluten sensitivity/preference, not safe for Celiac disease.",
  },
  "deep-dish-slices-n-stix-cheese-p7": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "detroit-style-deep-dish-veggie-p19": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "detroit-style-deep-dish-cheese-p20": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "veggie-p26": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "classic-cheese-p29": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "stuffed-crust-veggie-p33": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "stuffed-crust-cheese-p34": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "veggie-p37": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "classic-cheese-p38": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "stuffed-crust-cheese-p39": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "thin-crust-cheese-p45": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
  "thin-crust-veggie-p49": { restrictions: ["vegetarian", "noPork", "noBeef", "noChicken"] },
};

export function itemSatisfies(itemId: string, restrictions: Restriction[]): boolean {
  if (restrictions.length === 0) return true;
  const tag = DIETARY_TAGS[itemId];
  if (!tag) return false;
  return restrictions.every((r) => tag.restrictions.includes(r));
}

export function anyMenuItemSatisfies(restrictions: Restriction[]): boolean {
  if (restrictions.length === 0) return true;
  return MENU_ITEMS.some((item) => itemSatisfies(item.id, restrictions));
}

/**
 * A handful of good general-value items (cheapest per-slice regulars,
 * plus a couple of bundles) shown to the agent alongside every
 * dietary-tagged item. The full 69-item menu is real data too, but
 * sending all of it on every getMenuAndDeals call blew past the Groq
 * `on_demand` tier's 8000 TPM limit within a couple of tool-loop turns
 * and caused hard rate-limit failures. This is still exclusively real
 * store-10088 items/prices — just a smaller relevant slice of them.
 */
const GENERAL_VALUE_IDS = [
  "classic-pepperoni-p37",
  "3-meat-treat-p2",
  "bacon-hula-hawaiian-p3",
  "canadian-p4",
  "2-classic-pizzas-1-order-of-crazy-bread-p15",
  "classic-pepperoni-p28",
  "ultimate-supreme-p23",
];

const AGENT_VISIBLE_IDS = new Set([...Object.keys(DIETARY_TAGS), ...GENERAL_VALUE_IDS]);

/** Compact item list handed to the agent as tool output. */
export function menuForAgent() {
  return MENU_ITEMS.filter((item) => AGENT_VISIBLE_IDS.has(item.id)).map((item) => ({
    id: item.id,
    name: item.name,
    priceCad: item.priceCad,
    slices: item.slices,
    isBundle: item.isBundle,
    dietaryTags: DIETARY_TAGS[item.id]?.restrictions ?? [],
    caveat: DIETARY_TAGS[item.id]?.caveat,
  }));
}
