# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Stack

The target stack recorded in the project constitution is React Native with Expo
and TypeScript for the iOS client; Next.js API and tRPC for backend boundaries;
PostgreSQL with Prisma for persistence; Clerk for identity; Supabase Realtime or
LiveKit for collaboration; Stripe for payments; OneSignal for notifications;
Google Maps for location; and PostHog, OpenTelemetry, and Sentry for operations.

This is a target, not current state. The repository currently contains a Next.js
web application and a deterministic order-verification core. Any phase-level
deviation must be documented rather than silently substituted.

## Users

GatherBite serves organizers and participants in friend groups, office teams,
student organizations, families, and events. The organizer creates and advances
one group-ordering session. Participants state their own hard dietary constraints
and softer preferences, review what is proposed, and approve or object.

Operators are a secondary audience. They must be able to reconstruct every
approval, rejection, and failure from immutable evidence and audit records.

## Product Purpose

GatherBite makes group food ordering safer and less tedious. It collects each
person's requirements, proposes a single-restaurant order, independently checks
every hard constraint, explains the result, and keeps a human decision between
verification and checkout.

Success means the app never presents or submits an unverified order; incomplete
evidence stays incomplete; participants can understand how their own needs are
covered; and any decision can be reconstructed after the fact.

## Positioning

The planner that proposes an order is structurally unable to approve it. A
separate verifier and a deterministic final gate decide whether the candidate can
advance. Missing evidence rejects the candidate rather than being guessed away.

## Operating Context

The launch product is an organizer-led iOS application. A user creates or joins a
session, participants submit constraints, the system plans and verifies an order,
the group reviews it, and the organizer advances it toward checkout only after the
approval condition is met. Invitation links, notifications, offline reading of
previously viewed sessions, accessibility, dark mode, and localization are release
requirements.

The current web application is an internal and demonstration surface. Its live
Domino's path is guided-handoff only and intentionally cannot approve a candidate
without candidate-bound official price evidence.

## Capabilities and Constraints

- The proposal/approval separation, deterministic gate, bounded retries,
  fail-closed evidence handling, and cart comparison are non-negotiable.
- Allergy and dietary safety outrank order integrity, budget, and preferences in
  that order. This precedence cannot be configured away.
- Restaurant-operated sources must provide menu, price, ingredient, availability,
  and serviceability evidence. The product must not author or infer missing facts.
- One launch session produces one order from one restaurant. Android,
  organizer-less sessions, and multi-restaurant splitting are out of scope.
- Non-responding invitees are excluded with an explicit warning; they are never
  assumed unrestricted.
- Participant dietary data is sensitive personal data. Access control, immutable
  audit records, encryption, rate limiting, abuse prevention, and signed payment
  webhooks are required before production.
- The product must not claim an order was placed, a payment was taken, or an
  allergen requirement was satisfied without authoritative evidence.

### Open product decisions

These decisions are deliberately unresolved in the authoritative specification
and must be answered by the product owner before implementation can define the
corresponding flows:

1. **Money movement** — organizer pays the full amount, or the platform collects
   individual participant shares.
2. **Restaurant fulfilment** — verified guided handoff, or direct submission under
   supported restaurant partnerships and agreements.
3. **Allergen claim posture** — an affirmative safety claim, or presentation of
   restaurant-provided evidence with an explicit no-guarantee disclaimer.

Apple Developer, restaurant-partner, payment-provider, identity-provider, and
production data-service accounts are also external prerequisites; their existence
or terms are not established by this repository.

## Brand Commitments

The product name is GatherBite. Its voice is direct, calm, evidence-led, and
human-controlled. It never overstates certainty or implies restaurant affiliation.
The incumbent warm cream and orange identity, circular GatherBite mark, concise
workflow language, and clear safety disclosures are established assets for future
native work to adapt—not a license to reproduce web conventions inside iOS.

## Evidence on Hand

- Product specification: `specs/001-group-ordering-platform/spec.md`
- Governing principles: `.specify/memory/constitution.md`
- Approved web design and implementation: `src/app/`, `src/components/`, and
  `public/gatherbite-mark.svg`
- Deterministic verification and adversarial tests: `src/lib/`
- App Store and production blockers:
  `docs/deployment/app-store-readiness.md` and
  `docs/deployment/gatherbite-production-checklist.md`
- Candid and independent review evidence is recorded in the current pull request.

There are no confirmed customers, testimonials, restaurant partnerships, Apple
submission assets, legal opinions, or production payment evidence. Future work
must not fabricate them.

## Product Principles

1. Propose creatively; approve independently and deterministically.
2. Unknown evidence stays unknown and blocks advancement.
3. Safety is never traded for price, speed, preference, or conversion.
4. People see and control consequential decisions before money or submission.
5. Every outcome is explainable and auditable, including rejection and failure.

## Accessibility & Inclusion

The public iOS release must support VoiceOver and other assistive technologies
across every primary flow, Dynamic Type without clipped content, sufficient
contrast, reduced motion, dark mode, and more than one presentation language.
Dietary information must not rely on color alone, and uncertainty must be stated
in text that a screen reader can reach.
