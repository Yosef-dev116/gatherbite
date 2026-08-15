export interface TimingEntry {
  name: string;
  durationMs: number;
  description: string;
}

export interface TimingCollector {
  record(entry: TimingEntry): void;
  entries(): TimingEntry[];
  serverTiming(): string;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function safeDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

const FIXED_DESCRIPTIONS: Record<string, string> = {
  planner: "Planner",
  verifier: "Verification",
  evidence: "Evidence checks",
  ranking: "Option ranking",
  total: "GatherBite evaluation",
  observation: "Live observation",
  dominos: "Domino's live data",
  "dominos-fetch": "Domino's live data",
  comparison: "Deterministic comparison",
  normalize: "Result normalization",
  cart: "Cart preparation",
  groq: "Groq model",
  little_caesars: "Little Caesars evaluation",
};

function safeName(value: string): string | null {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) return null;
  if (FIXED_DESCRIPTIONS[value]) return value;
  if (/^(?:dom|groq|evidence|verifier|planner|cart)_[a-z0-9_-]{1,58}$/.test(value)) return value;
  return null;
}

function safeDescription(name: string): string {
  if (FIXED_DESCRIPTIONS[name]) return FIXED_DESCRIPTIONS[name];
  if (name.startsWith("dom_")) return FIXED_DESCRIPTIONS.dominos;
  if (name.startsWith("groq_")) return FIXED_DESCRIPTIONS.groq;
  if (name.startsWith("evidence_")) return FIXED_DESCRIPTIONS.evidence;
  if (name.startsWith("verifier_")) return FIXED_DESCRIPTIONS.verifier;
  if (name.startsWith("planner_")) return FIXED_DESCRIPTIONS.planner;
  if (name.startsWith("cart_")) return FIXED_DESCRIPTIONS.cart;
  return "GatherBite stage";
}

function escapeHeader(value: string): string {
  return value.replace(/[\\\"]/g, "\\$&");
}

export function createTimingCollector(): TimingCollector {
  const collected: TimingEntry[] = [];

  return {
    record(entry) {
      const name = safeName(entry.name);
      if (!name) return;
      collected.push({
        name,
        durationMs: safeDuration(entry.durationMs),
        description: safeDescription(name),
      });
    },
    entries() {
      return collected.slice();
    },
    serverTiming() {
      return collected
        .map((entry) => `${entry.name};dur=${roundMilliseconds(entry.durationMs)};desc="${escapeHeader(entry.description)}"`)
        .join(", ");
    },
  };
}
