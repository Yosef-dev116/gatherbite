# Domino’s Cart Feasibility — 2026-08-14

## Safety boundary
- Guest flow only
- No payment/submission
- No CAPTCHA/auth/access-control bypass
- No session secrets recorded

## Capabilities
| Capability | Result | Evidence | Deployed consequence |
|---|---|---|---|
| Address serviceability | UNKNOWN | The official public locator accepted one non-sensitive Charlottetown civic address and returned stores 10950, 10953, and 10952 with status `0`, but it did not identify one authoritative delivery store or return a delivery quote. | Delivery cannot pass until the runtime proves the address/store pair through the official flow. |
| Store/service selection | PARTIAL | Store 10950's official public profile reported open/online with Delivery and Carryout enabled; the interactive guest flow could not be exercised in this environment. | Store-level availability can be observed, but no selected customer session is claimed. |
| Configurable identifiers | PROVEN | Store 10950's official public structured menu exposed product `S_PIZZA`, variant `12SCREEN`, size `12`, crust `HANDTOSS`, sauce `X`, cheese `C`, current topping codes, and coupon `3021`. | GatherBite may build exact candidate manifests from a versioned live observation. |
| Quote with tax/fees | UNKNOWN | Corrected quote-only requests for stores 10950 and 10953 returned overall status `-1` with `StoreConnectionError` and no amounts. Product validation returned status `0` and coupon `3021` was marked `Fulfilled`, but this is not an all-in quote. | Budget cannot pass from coupon/menu price alone; tax and required fees need exact evidence. |
| Cart creation | UNKNOWN | No official cart was created or inspected. The quote endpoint is not a cart, and interactive browser control was unavailable. | Guided fallback only. |
| Session transfer | UNKNOWN | No exact cart/session could be opened in a separate organizer browser without cookies. | Preparation is not claimable. |
| Supported deep link | UNKNOWN | A read-only request reached the official order shell, but useful store, service, coupon, or cart state could not be reproduced in an interactive guest session. | Use the official order root only; do not describe it as prefilled. |

## Selected mode
Decision: guided-handoff
Reason: Exact official cart creation, secure session takeover, and useful deep-link state were not reproduced. The public data is strong enough to prepare an exact order guide, but not to claim that an organizer's official cart is already prepared.

## Observation record

Observed at `2026-08-15T03:14:17.698Z` from Domino’s Canada public ordering infrastructure:

- Store 10950: open and online at observation time; Delivery and Carryout allowed; Delivery wait 14–24 minutes; Carryout wait 9–14 minutes.
- Generic configurable pizza: product `S_PIZZA` ("Pizza"), medium hand-tossed variant `12SCREEN`, menu price CAD 14.99, eight slices from the variant's explicit `8 slices` and `1/8 pizza` fields.
- Default components: pizza sauce `X` and cheese `C`.
- Preference-capable toppings observed include pepperoni `P`, sausage `S`, beef crumble `B`, bacon `K`, black olives `R`, green pepper `G`, mushroom `M`, onion `O`, tomatoes `T`, baby spinach `Sp`, and roasted red peppers `Rp`.
- Coupon `3021` was listed as "1 Medium 5 Topping Pizzas" at CAD 14.99 for Carryout and Delivery. The coupon itself did not expose trusted slice evidence in this observation; candidate capacity must be tied to the selected variant, not inferred from the coupon name.
- The quote-only response validated the product and coupon but returned no subtotal, tax, fee, or total because the store connection failed. The menu/coupon price therefore remains display evidence, not an all-in budget proof.

The public civic address used for the locator check is intentionally not recorded. No customer address, cookie, request header, session identifier, continuation token, or credential is present in this report or its fixtures.

## Investigation limits

The required in-app browser control runtime was not callable in this session. A separate HireFlow-configured browser service was not used because credential rotation was not confirmed, as required by the safety boundary. Consequently, Delivery and Carryout page actions, exact pizza/deal insertion, cart inspection, navigation persistence, cross-browser continuation, and checkout handoff remain unproven rather than inferred from endpoint shapes.

The official pages and endpoints inspected were:

- `https://www.dominos.ca/en/pages/order/?route=1`
- `https://order.dominos.ca/power/store/10950/profile`
- `https://order.dominos.ca/power/store/10950/menu?lang=en&structured=true`
- `https://order.dominos.ca/power/store-locator`
- `https://order.dominos.ca/power/price-order` (quote only; no place-order call)

## Implementation consequence

Build the guided handoff regardless of future capability research. It should show the exact approved store, service method, product/variant, crust, sauce, cheese, toppings, quantities, coupon, known menu prices, and any price fields that remain unknown, then open the official order entry point. It must say what remains for the organizer to recreate and must never say "cart prepared" without an observed, matching, transferable official cart.
