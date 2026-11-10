# Feature Specification: Group Ordering Platform

**Feature Branch**: `Yosef-dev116/spec-kit` (no `before_specify` branch hook installed; the spec directory `specs/001-group-ordering-platform` is the canonical identifier)

**Created**: 2026-10-12

**Status**: Draft — 3 open clarifications

**Input**: User description: the full GatherBite product brief (`.context/attachments/CAJwWm/pasted_text_2026-10-12_17-24-41.txt`) — an AI-assisted group food ordering platform that separates planning from approval, where a planner agent proposes candidate group orders, a verifier independently validates every recommendation with deterministic checks, no order may be submitted unless verification succeeds, and the system fails closed whenever sufficient evidence is unavailable. Target: a production iOS application fit for public App Store launch, serving friend groups, office teams, student organizations, families, and event organizers.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verified Group Order Recommendation (Priority: P1)

An organizer describes a group — how many people are eating, who cannot eat what, how much can be spent, how much food each person needs — and receives a specific recommended order that has been independently checked against every one of those constraints. The recommendation arrives with a plain-language explanation of why each item was chosen and a report showing exactly how each dietary requirement is satisfied. If the constraints cannot be met, the organizer is told that clearly, along with which constraint is the obstacle, rather than being handed an order that quietly fails one of them.

**Why this priority**: This is the product. Every other story is an input to it or a consequence of it. It is also the only part a competitor cannot trivially copy — proposing a group order is easy, proving one correct is not. It delivers standalone value even if the organizer types all the group's requirements in by hand.

**Independent Test**: Provide a group requirement set directly (attendee count, dietary groups, budget, portion minimums) and confirm the system returns either an approved order whose every claim survives independent re-checking, or an explicit rejection naming the failing constraint. Fully testable with no participants, no invites, no payment, and no live restaurant connection.

**Acceptance Scenarios**:

1. **Given** a group of 12 with 3 members requiring vegetarian food and a $90 budget, **When** the organizer requests a recommendation, **Then** the system returns an order in which the vegetarian portions provably cover all 3 members, the total including fees is within $90, and every item exists on the referenced menu.
2. **Given** a group whose dietary requirements cannot be satisfied by any available menu, **When** the organizer requests a recommendation, **Then** the system reports that the request is impossible and names the unsatisfiable requirement, and offers no order.
3. **Given** a candidate order that satisfies portions and budget but leaves one dietary group uncovered, **When** verification runs, **Then** the order is rejected and never presented as a recommendation.
4. **Given** that ingredient information for a proposed item is missing or unreadable, **When** verification runs, **Then** the result is a rejection rather than an approval, and the missing information is reported as missing rather than treated as absent-therefore-safe.
5. **Given** an approved recommendation, **When** the organizer asks why an item was included, **Then** the system shows the reasoning and the evidence the decision was based on.

---

### User Story 2 - Session Creation and Preference Collection (Priority: P2)

An organizer creates a named ordering session, sets the budget, the cuisine preferences, and the minimum serving requirements, then invites the group. Each invited participant opens the invitation and submits their own constraints in their own words — allergies, dietary restrictions, dislikes, favourite foods, their personal maximum spend, and how much food they need. The organizer sees who has responded and who has not, and can request a recommendation once enough of the group has answered.

**Why this priority**: It replaces the organizer's secondhand guesses about other people's allergies with each person's own statement. That materially improves safety and removes the most tedious part of the job. It is second rather than first only because Story 1 can be demonstrated without it.

**Independent Test**: Create a session, invite several participants, have each submit a distinct preference set, and confirm the session accurately aggregates them and reports response status. Testable without any planning, verification, or payment.

**Acceptance Scenarios**:

1. **Given** a new session with a budget and serving minimums, **When** the organizer invites participants, **Then** each receives an invitation that lets them submit preferences without needing to understand the rest of the session.
2. **Given** a participant who declares a nut allergy, **When** they submit, **Then** that allergy is recorded as a hard constraint distinct from a dislike or a preference.
3. **Given** a session where some invitees have not responded, **When** the organizer views the session, **Then** outstanding responses are clearly identified.
4. **Given** a participant who updates their allergy after submitting, **When** they save the change, **Then** any existing recommendation for that session is invalidated rather than left standing.
5. **Given** two participants whose stated requirements conflict with the session budget, **When** the organizer requests a recommendation, **Then** the conflict is surfaced before any order is proposed.

---

### User Story 3 - Group Review and Approval (Priority: P3)

Before anything is bought, every participant sees the recommended order: what was selected, what it costs in total, what it costs them personally, why each item was chosen, and a dietary satisfaction report confirming their own requirements are met. Participants can approve or raise an objection. The order does not advance until the session's approval condition is met.

**Why this priority**: Group ordering is a social act; people want to see what they are being signed up for. It also converts the verification work into visible trust, which is the product's whole claim.

**Independent Test**: Present a fixed approved recommendation to several participants and confirm each sees correct per-person cost and a dietary report specific to them, and that approvals and objections are recorded and gate advancement. Testable without planning or payment.

**Acceptance Scenarios**:

1. **Given** an approved recommendation, **When** a participant opens it, **Then** they see the order, their own share of the cost, the selection reasoning, and confirmation of how their own dietary requirements are satisfied.
2. **Given** a participant with a declared allergy, **When** they review, **Then** the report states which specific items are safe for them and on what evidence.
3. **Given** a participant who objects, **When** the objection is submitted, **Then** the order does not advance and the objection reason is visible to the organizer.
4. **Given** a session whose approval condition is not yet met, **When** anyone attempts to advance to checkout, **Then** the attempt is refused.

---

### User Story 4 - Checkout and Payment (Priority: P4)

With the group's approval in hand, the organizer proceeds to checkout. Immediately before any money moves, the system re-verifies the order from scratch, confirms the restaurant is still able to fulfil it, and confirms that the cart about to be submitted is item-for-item the cart the group approved. Only then is payment taken and the order placed. Each participant sees what they owe or paid.

**Why this priority**: This is where the product becomes useful rather than advisory, and where mistakes become expensive. It is sequenced after review because it depends on an approved order existing.

**Independent Test**: Take a pre-approved order through re-verification, cart comparison, and payment against a test payment environment, and confirm that any mismatch or staleness blocks submission. Testable independently of how the order was produced.

**Acceptance Scenarios**:

1. **Given** an approved order, **When** checkout begins, **Then** all constraint checks are re-run from current data rather than reusing the earlier result.
2. **Given** that a price has changed since approval such that the order now exceeds budget, **When** checkout runs, **Then** submission is blocked and the group is informed of the change.
3. **Given** that the prepared cart differs in any item or quantity from the approved order, **When** the comparison runs, **Then** submission is blocked.
4. **Given** that the restaurant has stopped accepting orders, **When** checkout runs, **Then** submission is blocked and no payment is taken.
5. **Given** a payment that fails, **When** the failure occurs, **Then** no order is placed, the group is notified, and no participant is charged.
6. **Given** a successful payment, **When** the order is placed, **Then** every participant receives confirmation showing the final order and their own amount.

---

### User Story 5 - Menu and Availability Integrity (Priority: P5)

The platform keeps its view of restaurants, menus, prices, and availability current, normalizes differently-shaped menu data into one consistent form, and detects when a menu changes underneath an in-flight session. When a change affects a pending recommendation, the affected session is told before it reaches checkout rather than after.

**Why this priority**: Every guarantee the product makes rests on the menu data being true. Stale data silently converts a verified order into an unverified one. It is not higher priority only because the earlier stories can be validated against fixed menu data first.

**Independent Test**: Feed differently-structured menu sources and confirm consistent normalization; then mutate a menu underneath a pending recommendation and confirm the change is detected and the recommendation invalidated. Testable with no user-facing flow at all.

**Acceptance Scenarios**:

1. **Given** menu data from sources with different structures, **When** it is ingested, **Then** items, prices, portions, and ingredient information are available in one consistent form.
2. **Given** an item removed from a menu after a recommendation was approved, **When** the change is detected, **Then** the recommendation is invalidated and the session is notified.
3. **Given** a price that cannot be read from the source, **When** the item is considered, **Then** its price remains unknown and the item cannot contribute to a budget-satisfying order.
4. **Given** a restaurant outside its operating hours or unable to serve the delivery location, **When** planning runs, **Then** that restaurant is excluded with a stated reason.

---

### User Story 6 - Mobile Application Experience (Priority: P6)

Participants and organizers use GatherBite as a polished mobile application: they are guided through first use, sign in securely, receive a push notification when a session needs them, can open an invitation link directly into the right session, keep reading a session's state when the network drops, see their own actions reflected immediately, and can use the app comfortably with assistive technology, in dark mode, and in their own language.

**Why this priority**: The brief requires public App Store launch, so this is mandatory for release, not optional. It is sequenced here because the underlying guarantees must be real before the surface presenting them matters.

**Independent Test**: Exercise onboarding, sign-in, notification delivery, link handling, offline reading, accessibility navigation, dark mode, and language switching against fixed session data. Testable without any live planning or payment.

**Acceptance Scenarios**:

1. **Given** a first-time user, **When** they open the app, **Then** they are guided to a state where they can join or create a session without external instruction.
2. **Given** an invitation link, **When** it is opened on a device with the app installed, **Then** the app opens directly to that session.
3. **Given** a session awaiting a participant's preferences, **When** the deadline approaches, **Then** that participant receives a notification.
4. **Given** a lost network connection, **When** a participant opens a previously viewed session, **Then** the last known state is readable and clearly marked as potentially stale.
5. **Given** a user navigating with a screen reader, **When** they review a recommendation, **Then** the order, costs, and dietary report are all reachable and announced meaningfully.

---

### User Story 7 - Decision Audit and Operations (Priority: P7)

For any order the platform ever approved or rejected, an operator can reconstruct the decision after the fact: what the group asked for, what data was retrieved, what was proposed, what was checked, what the verdict was, and why. Operators can see error rates, rejection reasons, and the health of the agents in production.

**Why this priority**: Required to defend a safety claim, diagnose a failure, and operate the service — but it has no value until there are decisions to audit.

**Independent Test**: Run a set of orders through to approval and rejection, then reconstruct each decision end to end from stored records alone. Testable without any user interface.

**Acceptance Scenarios**:

1. **Given** any past order, **When** an operator inspects it, **Then** the inputs, retrieved evidence, proposal, checks, and verdict are all recoverable.
2. **Given** a rejected order, **When** an operator inspects it, **Then** the rejection and its reason are recorded with the same completeness as an approval.
3. **Given** a verification that failed because evidence was missing, **When** an operator inspects it, **Then** the specific missing evidence is identifiable.
4. **Given** a stored decision record, **When** the agent that produced it runs again, **Then** the original record is unchanged.

---

### Edge Cases

- **Allergy evidence absent**: an item's ingredient information is incomplete or unavailable. The order must be rejected, not approved on the strength of the item's name.
- **Constraints mutually unsatisfiable**: dietary requirements that no menu can satisfy, or a budget too low for the required portions. Must be reported as impossible, with the blocking constraint named.
- **Menu changes mid-session**: an item is removed, repriced, or has its ingredients changed between recommendation and checkout.
- **Restaurant becomes unavailable**: the store closes, stops delivering, or cannot serve the address, after planning but before checkout.
- **Participant never responds**: the session must either proceed on a stated rule or stall visibly; it must not silently treat a non-response as "no restrictions".
- **Participant changes constraints late**: an allergy added after approval, or after payment has begun.
- **Participant leaves the group**: portion and cost math must be recomputed, and the order re-verified.
- **Quantity and duplicate logic**: the same item proposed twice, or a quantity that does not match the portions it is claimed to provide.
- **Portion ambiguity**: an item whose serving size is unknown cannot be counted toward a serving requirement.
- **Verification times out or the agent hangs**: must resolve as a rejection, not an indefinite wait and not an optimistic pass.
- **Conflicting participant requirements**: one participant's allergy excludes another's declared favourite food.
- **Zero viable restaurants**: no open, serviceable restaurant can meet the requirements.
- **Payment partially succeeds**: some participants charged, some not, with an order not yet placed.
- **Duplicate submission**: checkout triggered twice in quick succession must not place two orders.
- **Very large group**: the group is big enough that portion and cost arithmetic spans many items and several restaurants.

## Requirements *(mandatory)*

### Functional Requirements

**Sessions and participants**

- **FR-001**: Users MUST be able to create an ordering session specifying attendee count, spending budget, cuisine preferences, and minimum serving requirements.
- **FR-002**: Organizers MUST be able to invite people to a session, and invitees MUST be able to submit preferences without first creating a session of their own.
- **FR-003**: Participants MUST be able to declare allergies, dietary restrictions, dislikes, favourite foods, a personal maximum spend, and portion requirements.
- **FR-004**: The system MUST record allergies and dietary restrictions as hard constraints, distinct in kind from dislikes and preferences, and MUST NOT trade a hard constraint against a preference.
- **FR-005**: The system MUST report which invitees have not yet responded, and MUST NOT interpret a non-response as the absence of restrictions.
- **FR-006**: When a participant's constraints change, the system MUST invalidate any recommendation for that session that was produced under the previous constraints.
- **FR-007**: The system MUST recompute portion and cost requirements when a participant joins or leaves, and MUST re-verify any standing order.

**Planning and verification**

- **FR-008**: The system MUST produce candidate group orders from a session's requirements and current restaurant data.
- **FR-009**: The component that proposes an order MUST NOT be the component that approves it, and a proposing component MUST NOT be able to mark its own output as verified.
- **FR-010**: Candidate orders MUST be independently validated for allergy constraints, budget constraints, serving constraints, menu availability, per-participant requirements, duplicate-item logic, and quantity logic.
- **FR-011**: The final check preceding any approval MUST be deterministic and reproducible: the same inputs MUST always yield the same verdict.
- **FR-012**: The system MUST NOT present, advance, or submit any order that has not passed verification.
- **FR-013**: When evidence is insufficient to decide a constraint, the system MUST return a rejection and MUST NOT upgrade that state into an approval at any later point.
- **FR-014**: The system MUST NOT infer ingredients or allergens from an item's name, category, cuisine, price, or similarity to another item; every allergen conclusion MUST trace to retrieved ingredient data with its source recorded.
- **FR-015**: The system MUST produce a confidence assessment for ingredient and allergen determinations, and MUST block approval when confidence falls below the configured threshold.
- **FR-016**: The system MUST report detected missing ingredient information as an explicit gap rather than folding it into a pass or fail verdict.
- **FR-017**: The system MUST detect conflicts between participant requirements and report them rather than silently satisfying one at another's expense.
- **FR-018**: Retry attempts after a rejection MUST be bounded, and MUST terminate on a verified order, a provably impossible request, or a fixed attempt ceiling — never on eventual approval.
- **FR-019**: A verification that times out, aborts, or fails to produce a well-formed verdict MUST be treated as a rejection.
- **FR-020**: When an order cannot be produced, the system MUST state which constraint blocks it.
- **FR-021**: The system MUST explain, for any recommended order, why each item was selected.

**Restaurant and menu data**

- **FR-022**: The system MUST normalize menu data from differently-structured sources into one consistent representation of items, prices, portions, and ingredient information.
- **FR-023**: The system MUST retrieve current restaurant availability, operating hours, and ability to serve the delivery location, and MUST exclude restaurants that fail any of these with a stated reason.
- **FR-024**: Unreadable or absent data MUST remain explicitly unknown and MUST NOT be substituted with a zero, an empty value, or a default that allows a check to pass.
- **FR-025**: The system MUST detect menu changes affecting an in-flight session and invalidate affected recommendations before checkout.

**Review, approval, and checkout**

- **FR-026**: Participants MUST be able to see the recommended order, its total cost, their own share, the selection reasoning, and a dietary satisfaction report specific to their own declared requirements.
- **FR-027**: Participants MUST be able to approve or object, and the system MUST NOT advance a session past review until its approval condition is met.
- **FR-028**: The system MUST re-run all constraint checks from current data at checkout rather than reusing an earlier verdict.
- **FR-029**: The system MUST compare the cart about to be submitted against the approved order item-for-item and quantity-for-quantity, and MUST block submission on any difference.
- **FR-030**: The system MUST re-confirm restaurant fulfilment capability immediately before submission.
- **FR-031**: The system MUST NOT trust a submitting component's own claim that its result is verified; the result MUST be independently confirmed after execution.
- **FR-032**: The system MUST process payment and split costs among participants [NEEDS CLARIFICATION: money movement model — does one organizer pay the full amount and settle with the group outside the platform, or does the platform collect each participant's share individually? This determines refund behaviour, partial-failure handling, and who bears financial liability].
- **FR-033**: A failed payment MUST result in no order placed and no participant left charged.
- **FR-034**: Duplicate checkout attempts MUST NOT produce duplicate orders.
- **FR-035**: Every participant MUST receive confirmation of the final order and their own amount.
- **FR-036**: The system MUST place confirmed orders with the restaurant [NEEDS CLARIFICATION: fulfilment model — does the platform submit orders directly into restaurant ordering systems (and if so, which partners, under what agreements), or does it produce a verified order for a human to place? This decides whether the product is transactional or advisory and governs most of the integration scope].

**Safety posture**

- **FR-037**: When constraints conflict, the system MUST resolve them in a fixed precedence: allergy and dietary safety first, then order integrity, then budget, then preferences — and this precedence MUST NOT be reorderable by configuration or user request.
- **FR-038**: The system MUST present its allergen information to users [NEEDS CLARIFICATION: safety claim posture — does GatherBite assert that an order is safe for a declared allergy, or present restaurant-provided allergen information with an explicit disclaimer and no safety assertion? This is legally significant and changes required user-facing language, consent flows, and App Store review positioning].

**Notifications**

- **FR-039**: The system MUST notify participants when a session requires their input, when a recommendation is ready for review, when a recommendation is invalidated, and when an order is confirmed.
- **FR-040**: Users MUST be able to control which notifications they receive.

**Accounts, access, and mobile experience**

- **FR-041**: Users MUST be able to create an account and sign in securely.
- **FR-042**: Access to a session's data MUST be restricted by role; participants MUST NOT be able to perform organizer-only actions, and no user MUST be able to read a session they were not invited to.
- **FR-043**: The system MUST guide first-time users to a state where they can create or join a session.
- **FR-044**: Invitation links MUST open directly to the relevant session on devices where the application is installed.
- **FR-045**: Previously viewed session state MUST remain readable without a network connection, and MUST be marked as potentially stale.
- **FR-046**: A user's own actions MUST be reflected immediately, and MUST be reconciled or clearly reverted if they later fail.
- **FR-047**: The application MUST be operable with assistive technology, MUST support dark mode, and MUST support presentation in more than one language.

**Audit and operations**

- **FR-048**: Every agent run MUST persist its inputs, the evidence it received, its outputs, and its decision, sufficient for a human to reconstruct why an order was approved or rejected.
- **FR-049**: Rejections and failures MUST be recorded with the same completeness as approvals.
- **FR-050**: Stored decision records MUST NOT be modified by subsequent runs.
- **FR-051**: Verification results MUST be retained as first-class records associated with the order they govern.
- **FR-052**: The system MUST record security-relevant events, including authentication, authorization failures, and payment activity.
- **FR-053**: The system MUST limit request rates and detect abusive or fraudulent usage patterns.
- **FR-054**: Operators MUST be able to observe error rates, rejection reasons, and agent health in production.

### Key Entities

- **User**: A person with an account. Identity, contact details, notification preferences, language, and the sessions they belong to.
- **Session**: One group ordering occasion. Budget, cuisine preferences, serving minimums, delivery location and time, approval condition, and current state.
- **Participant**: One person's membership in one session. Their declared allergies, restrictions, dislikes, favourite foods, personal spending cap, portion requirement, and response status.
- **Restaurant**: A place that can fulfil an order. Location, operating hours, service area, and fulfilment capability.
- **Menu**: A restaurant's offering at a point in time, with the version identity needed to detect change.
- **MenuItem**: One orderable thing. Name, price (possibly unknown), portions provided (possibly unknown), ingredient information, and the provenance and completeness of that information.
- **Order**: A candidate or confirmed group order. Its items and quantities, totals and fees, originating session, and state.
- **VerificationResult**: The verdict on one order at one moment. Approve or reject, the specific checks performed, their outcomes, the failing constraint where applicable, and the evidence relied on.
- **AgentRun**: One execution of one agent. Its inputs, the evidence it received, its outputs, its decision, and its timing.
- **Approval**: One participant's acceptance of a recommendation, or their objection and its reason.
- **Vote**: A participant's expressed preference among options where a session offers a choice.
- **Payment**: A money movement associated with an order. Amount, payer, state, and relationship to a participant's share.
- **Notification**: A message sent to a user. Its trigger, channel, delivery state, and the session it concerns.
- **AuditLog**: An immutable record of a consequential action — who or what did it, when, and to what.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No order is ever presented to users or submitted without having passed independent verification — zero exceptions across all testing and production.
- **SC-002**: In a reference set of adversarial cases covering allergy edge cases, budget edge cases, and menus that mutate between planning and checkout, 100% of orders that violate a declared hard constraint are rejected before reaching a user.
- **SC-003**: No case exists in which incomplete or unavailable ingredient data results in an approval.
- **SC-004**: An organizer can go from starting a session to a verified recommendation in under 5 minutes for a group of 12.
- **SC-005**: A participant can submit their own preferences in under 90 seconds.
- **SC-006**: 90% of organizers reach a verified recommendation on their first attempt without needing to retry or revise their inputs.
- **SC-007**: When no order can satisfy the constraints, 95% of organizers can correctly identify which constraint blocked it from the explanation given.
- **SC-008**: Any approval or rejection can be fully reconstructed after the fact from stored records alone, for 100% of decisions.
- **SC-009**: Recommendations are returned within 30 seconds for 95% of sessions.
- **SC-010**: Every participant's own dietary requirements are individually confirmed in the report they see, for 100% of approved orders.
- **SC-011**: The platform sustains 10,000 concurrent active sessions without degradation of recommendation times beyond SC-009.
- **SC-012**: Zero instances of a confirmed order differing from the order the group approved.
- **SC-013**: Zero instances of a participant being charged for an order that was not placed.
- **SC-014**: The application passes public app store review and is usable with assistive technology across all primary flows.
- **SC-015**: Menu changes affecting a pending recommendation are detected and the recommendation invalidated before checkout in 100% of cases.

## Assumptions

Defaults chosen where the brief did not specify. Each is a decision that can be revisited in planning.

- **Platform scope**: iOS is the launch target. The existing web application in this repository is treated as an internal and demonstration surface, not a launch deliverable. Android is out of scope for initial launch.
- **Market and language**: a single launch market with one primary language, with the application built so additional languages can be added without rework.
- **Session authority**: sessions are organizer-led — one person creates the session, sets the budget and constraints, and drives it to checkout. Fully peer-to-peer sessions with no organizer are out of scope.
- **Approval condition**: the default is organizer approval plus the absence of unresolved objections from participants with declared hard constraints. Requiring unanimous explicit approval is a configurable alternative, not the default.
- **Non-response handling**: a non-responding invitee is excluded from the order rather than included with assumed-unrestricted requirements, and the organizer is told this is happening.
- **Single restaurant per order**: one session produces one order from one restaurant. Splitting a group across multiple restaurants is out of scope for initial launch.
- **Restaurant data provenance**: restaurant, menu, price, and ingredient data comes from restaurant-operated sources. The platform does not author ingredient data itself, and the completeness of its allergen checking is bounded by what those sources publish — a limit that must be visible to users.
- **Payment timing**: payment is taken at checkout, after approval and re-verification, not at session creation.
- **Data retention**: decision and audit records are retained long enough to investigate a safety incident after the fact; participant dietary data is treated as sensitive personal data throughout.
- **Existing foundation**: the planner/verifier separation, the deterministic verification gate, bounded retries, and post-execution re-verification already exist in this repository for a pizza-ordering case against fixture data, and are the starting point rather than new work. The mobile application, accounts, sessions, participants, persistence, payments, notifications, and live restaurant integration do not yet exist.
- **Governing constraints**: the project constitution at `.specify/memory/constitution.md` v1.0.0 governs this specification. Where this spec and the constitution appear to conflict, the constitution wins.
