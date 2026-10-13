# App Store readiness

Status as of October 12, 2026: **web release candidate; not an iOS submission candidate**.

This repository contains a Next.js web application. It does not contain an
Xcode project, iOS bundle identifier, signing configuration, native build,
TestFlight archive, App Store Connect record, screenshots, or review metadata.
Those artifacts cannot be generated honestly from this repository or submitted
without access to the developer's Apple account.

## What is ready

- Responsive installable web experience with a web app manifest and icons.
- Public `/privacy` and `/support` destinations suitable for the deployed web app.
- Explicit dietary-safety, affiliation, checkout, and simulated-demo disclosures.
- Fail-closed verification: unknown price or dietary evidence cannot become an approval.
- No account system, application database, or in-app payment collection.
- Production build, deterministic test suite, lint, dependency audit, and security headers.

## Submission blockers

1. **There is no native app target.** A signed iOS build and matching App Store
   Connect record are required before a build can enter TestFlight or review.
2. **A thin web wrapper is not a safe shortcut.** Apple Review Guideline 4.2
   requires an app to provide features, content, and UI beyond a repackaged
   website, and 4.2.2 warns against web clippings. A native product should add
   meaningful platform value such as saved group profiles stored on-device,
   share-sheet intake, order reminders, and accessible native navigation—not
   merely embed this URL in a web view.
3. **Live approvals are intentionally unavailable.** The production path does
   not have a candidate-bound official checkout quote. Budget is a hard
   constraint, so price evidence remains `UNKNOWN` and every live candidate is
   rejected. The deployed demo illustrates the product flow with clearly marked
   simulated data.
4. **The current Groq account cannot accept the full live menu prompt.** The
   measured request is about 41,516 tokens against an 8,000 TPM limit. Fixing
   only this limit would not fix the independent quote-evidence blocker above.
5. **App Store account work remains.** The owner must choose the bundle ID and
   SKU, complete age-rating and export-compliance questions, provide review
   contact information, capture device screenshots, and describe every first-
   and third-party data practice in App Store Connect.

## Privacy declaration starting point

Apple requires a privacy-policy URL and an accurate App Privacy declaration,
including third-party partners. Before submission, the owner and counsel should
map the final native build's behavior to App Store Connect. For the current web
implementation, the relevant flows are:

- group headcount, budget, dietary needs, preferences, and notes are processed
  by the configured AI provider;
- delivery address is processed server-side for restaurant serviceability and
  is not included in the AI planning prompt;
- restaurant services may receive the address for a serviceability lookup;
- no account, ad tracking, or payment-card collection exists in the app.

Do not copy these bullets blindly into App Store Connect. The declaration must
match the final binary, SDKs, provider contracts, logging configuration, and
retention practices at submission time.

## Required path to an honest iOS release

1. Resolve official candidate-bound price evidence and compact the planner's
   menu context without weakening deterministic verification.
2. Write and approve a native product specification identifying platform value
   beyond a web wrapper.
3. Build an iOS target, accessibility-test it on supported device sizes, and
   add unit/UI tests around ordering, privacy, and failure states.
4. Configure signing, bundle ID, icons, launch assets, versioning, and export
   compliance in the owner's Apple Developer account.
5. Publish the final privacy and support URLs, complete App Privacy answers,
   upload a TestFlight build, run beta review, and then submit to App Review.

## Authoritative Apple references

- [App Review Guidelines, section 4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality)
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [App information reference](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
