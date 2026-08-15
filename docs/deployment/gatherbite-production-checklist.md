# GatherBite production deployment checklist

Deployed project: `yosefs-projects-ffbb7bee/gatherbite-hackathon-final`
Preview URL: `https://gatherbite-hackathon-final.vercel.app`
Production URL: `https://gatherbite-hackathon-final.vercel.app`

Both URLs are currently the same deployment/alias. This is intentional for
the hackathon — there is one deployed target, not a separate promoted
production environment.

## Environment variables

- [x] **`GROQ_API_KEY`** — server-only. Referenced by name only in this
      checklist; its value is never displayed or logged anywhere, including
      here. Already configured on this Vercel project's **Production** and
      **Preview** environments (added via `vercel env add`). Used by
      `src/lib/groq.ts` (`createGroq({ apiKey: process.env.GROQ_API_KEY })`)
      for both the Planner and Verification Agent model calls.
- [ ] **`GATHERBITE_VERIFIER_MODEL`** — optional, server-only. **Currently
      unset** on this deployment. When unset, `src/lib/groq.ts` falls back to
      `openai/gpt-oss-120b` for both `PLANNER_MODEL` and `VERIFIER_MODEL`:
      ```ts
      export const VERIFIER_MODEL = groq(
        process.env.GATHERBITE_VERIFIER_MODEL ?? "openai/gpt-oss-120b",
      );
      ```
      Per Task 17's ruling, this stays unset until a faster candidate model
      demonstrates zero false approvals and equivalent fail-closed behavior
      via `npm run eval:verifier` — no such evidence exists yet, so leaving
      it unset (rather than guessing a value) is the correct current state.
- [x] **No approved browser-automation environment variable exists.**
      Checked directly: `src/lib/cart/dominosCartExecutor.ts` and every other
      file under `src/lib/cart/` contain zero `process.env` references. Cart
      mode is locked to `guided-handoff` (Task 15 ruling — see the demo
      runbook, Section 6), which performs no browser or network session at
      all, so there is nothing for a browser-provider credential to
      configure yet. If `transferable-browser` mode is ever enabled with a
      real driver in a future session, its configuration variable(s) must be
      added here at that time — not before.

## Node runtime

- [x] Confirmed by reading the route files directly (not assumed): all three
      GatherBite API routes declare `export const runtime = "nodejs";`
      explicitly —
      - `src/app/api/gatherbite/route.ts`
      - `src/app/api/gatherbite/stream/route.ts`
      - `src/app/api/gatherbite/cart/prepare/route.ts`
      None run on the Edge runtime. This matters because the Planner/Verifier
      tool-calling loop and the live Domino's fetches are not Edge-safe
      assumptions to make silently.

## Host / function duration limits

- [x] No route declares `export const maxDuration` (checked directly — none
      of the three files above set it). Actual duration is therefore bounded
      by whichever default applies to this Vercel project's plan tier for
      Node.js Serverless Functions, **not** by an explicit override in this
      codebase.
- [x] The application enforces its own internal deadline regardless of the
      host limit: `DEFAULT_DEADLINE_MS = 15_000` in
      `src/lib/gatherbite/orchestrator.ts` aborts a stuck evaluation after 15
      seconds and returns `"GatherBite evaluation deadline exceeded."` rather
      than hanging until the host kills the function. This is the deadline
      that actually governs a normal request; the host limit is a backstop
      behind it, not the primary control.
- [ ] If a future session raises `DEFAULT_DEADLINE_MS` beyond the host's
      default duration limit, an explicit `maxDuration` export must be added
      to match — not verified as a live constraint yet because the 15s
      internal deadline is comfortably inside any current Vercel Node
      function default.

## Stream endpoint check

- [x] `POST /api/gatherbite/stream` — NDJSON event stream
      (`Content-Type: application/x-ndjson; charset=utf-8`,
      `Cache-Control: no-store`).
- [x] **Confirmed directly in code:** the streaming route does **not** set a
      `Server-Timing` header. `scripts/check-gatherbite-live.ts`'s
      `runStreamCheck` documents this explicitly and prints
      `"Server-Timing: not applicable (the streaming endpoint does not set
      this header)"` rather than fabricating one. Only the plain JSON route
      (`POST /api/gatherbite`) sets `Server-Timing`
      (`route.ts`: `headers: { "Server-Timing": timing.serverTiming() } }`).
      Use the JSON route, not `/stream`, when timing evidence is needed.
- [ ] Live check command (not part of `npm test`, opt-in, network-dependent):
      ```
      npm run test:live -- --url=https://gatherbite-hackathon-final.vercel.app --stream
      ```

## Cart capability statement

- [x] **Guided-handoff only.** Quoting the Task 15 ruling verbatim
      (`.superpowers/sdd/2026-08-14-gatherbite-hackathon-final/progress.md`):
      > "cart mode is locked to `guided-handoff` per Task 2's evidence
      > (`docs/research/2026-08-14-dominos-cart-feasibility.md`: "Selected
      > mode: guided-handoff... Exact official cart creation, secure session
      > takeover, and useful deep-link state were not reproduced"). ...
      > `supported-deep-link` and `transferable-browser` are not exercised
      > (no proof exists to back them)."
      This deployment never claims a prepared/transferred official cart. It
      always produces a guided order guide (exact store, deals, pizza
      configuration, per-line/whole-order copy, verified price evidence, and
      an "Open Domino's with my order guide" action) for the organizer to
      finish manually on Domino's own site.

## Secret-scan checklist

- [ ] Before any commit touching config/docs: `git status` and `git diff
      --check` reviewed; no `.env*` file staged.
- [ ] No `GROQ_API_KEY` value, browser session token, cookie, delivery
      address, or credential appears in any file in this repository,
      including this checklist and the demo runbook (both were written
      referencing variable *names* only, per the global constraint against
      logging secrets/addresses).
- [ ] Confirmed by direct inspection: `src/lib/cart/` contains no
      `process.env` reads at all, so there is no browser-provider credential
      surface to scan for yet.
- [ ] `git log` for this branch does not contain a raw API key, address, or
      credential in any commit message or diff (spot-check before the final
      demo push, not exhaustively re-verified in this document).

## Known issue — Groq TPM cap blocks live Planner calls

This is the single most important line item for anyone running the live
demo. Quoting the exact numbers from the confirmed root cause (see the demo
runbook, Section 3, for full detail):

> The Planner's live-catalog prompt requires approximately **41,516 tokens**
> per request. The connected Groq account is on the **on-demand/free tier,
> capped at 8,000 TPM**. Every live Planner call therefore fails with
> `AI_APICallError: Request too large for model openai/gpt-oss-120b ...
> tokens per minute (TPM): Limit 8000, Requested 41516`.

- [x] **This is not a crash.** Confirmed by reading
      `src/components/GatherBiteResults.tsx`: when no candidate is approved,
      the `NoViableResult` component renders a calm "No verified option yet"
      card with the concrete `noViableReason` string and a "safe adjustments"
      list — never a blank page, never an unhandled exception surfaced to the
      browser. A judge hitting the live demo with the runbook's example
      request right now will see this graceful explanation, not an error
      page.
- [x] **This is a Groq account-tier limit, not a code defect.** The same
      request path works token-for-token below the cap; basic model
      connectivity and tool-free calls succeed.
- [ ] **Not currently fixable within this deployment's constraints:** a Groq
      Dev Tier upgrade is unavailable (Groq's own capacity), and the
      reviewed Planner/catalog-serialization architecture
      (`src/lib/agents/dominosPlanner.ts`,
      `serializeDominosObservationForPlanner`, and the Tasks 6/7 evidence
      pipeline) is intentionally not modified to route around it this close
      to the deadline — an explicit user ruling, not an oversight.
- [ ] **Rollback-relevant:** if judging happens before this is resolved, the
      live demo should be framed around the runbook's screenshots/recording
      of a genuine reject→adapt→approve run captured before this constraint
      was hit, if one exists, or around the honest "No verified option yet"
      behavior itself as evidence of the fail-closed design working as
      intended — never around a fabricated live run.

## Guided-fallback rollback note

If cart preparation ever fails for any reason — timeout, automation
unavailable, a mismatch, or any other non-success `CartPreparationStatus`
(`PREPARED_AND_OBSERVED`, `NEEDS_HUMAN_CAPTCHA`, `NEEDS_HUMAN_LOGIN`,
`CART_MISMATCH`, `SESSION_NOT_TRANSFERABLE`, `AUTOMATION_UNAVAILABLE`,
`TIMED_OUT`, `FALLBACK_READY`) — the system degrades to the guided fallback.
It never leaves the organizer at a broken or ambiguous state:

- Every `CartPreparationResult`, success or not, carries a populated
  `fallback: GuidedOrderHandoff` field (non-optional in the type
  — `src/lib/cart/contracts.ts`). There is no code path that can omit it.
- On this deployment specifically, cart preparation is guided-handoff-only,
  so every "prepare my cart" action already *is* the fallback path — there
  is no partially-working browser flow to fail out of in the first place.
- What to tell users/judges if asked "what happens if cart prep fails right
  now": nothing can meaningfully "fail" further than guided-handoff already
  is, because guided-handoff performs no external session — it always
  succeeds at producing the order guide. The only way an organizer sees an
  error at this step is a network/server error on the
  `/api/gatherbite/cart/prepare` route itself, in which case the UI shows
  "Cart preparation could not be completed." (`src/app/page.tsx`,
  `cartPreparation` error state) and the previously verified option remains
  selected and reviewable — nothing is lost, and no broken/half-completed
  cart state is ever shown as if it were real.

## Final verification commands (run before judging)

```powershell
npx tsc --noEmit
npm run test
npm run lint
npm run build
git diff --check
```

`npm test` and `npx tsc --noEmit` were run fresh while writing this
checklist: 205/205 tests passing, no type errors. `npm run lint` and
`npm run build` were not re-run as part of writing this document — run them
again before the final demo push.
