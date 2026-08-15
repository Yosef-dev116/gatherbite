// Single entry point for final GatherBite contract tests as the feature
// grows. Importing registers each node:test suite without hiding it from
// the normal test runner.
import "./gatherbite/contracts.test";
import "./gatherbite/events.test";
import "./gatherbite/timing.test";
import "./pricing/peiTax.test";
import "./restaurants/dominosCatalog.test";
import "./restaurants/dominosRetry.test";
import "./restaurants/dominosServiceability.test";
import "./restaurants/dominosCapacity.test";
import "./restaurants/dominosPreferences.test";
import "./restaurants/dominosEvidence.test";
import "./agents/verifierGuard.test";
import "./agents/dominosVerifier.test";
import "./gatherbite/agentLoop.test";
import "./agents/dominosPlanner.test";
import "./gatherbite/ranking.test";
import "./gatherbite/normalize.test";
import "./gatherbite/retry.test";
import "./gatherbite/orchestrator.test";
import "../app/api/gatherbite/route.test";
import "./gatherbite/stream.test";
import "../components/GroupRequirementsForm.test";
import "../components/GatherBiteResults.test";
