// Single entry point for final GatherBite contract tests as the feature
// grows. Importing registers each node:test suite without hiding it from
// the normal test runner.
import "./gatherbite/contracts.test";
import "./gatherbite/events.test";
import "./gatherbite/timing.test";
import "./pricing/peiTax.test";
import "./restaurants/dominosCatalog.test";
import "./restaurants/dominosServiceability.test";
import "./restaurants/dominosCapacity.test";
import "./restaurants/dominosPreferences.test";
