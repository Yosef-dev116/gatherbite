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

function safeName(value: string): string | null {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) return null;
  return value;
}

function safeDescription(value: string): string {
  // Server-Timing descriptions are deliberately plain text and bounded. This
  // prevents request-shaped data (addresses, headers, prompts, etc.) from
  // entering response headers through a timing callback.
  const normalized = value.replace(/[^a-zA-Z0-9 .'’:_-]/g, "").slice(0, 80);
  return normalized || "GatherBite stage";
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
        description: safeDescription(entry.description),
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
