"use client";

import { useState } from "react";
import Link from "next/link";
import { ALL_RESTRICTIONS, RESTRICTION_LABELS } from "@/lib/types";
import type { BuildOrderInput, BuildOrderResult, DietaryGroupInput, Restriction } from "@/lib/types";
import { ActivityLog, OrderSheet } from "@/components/OrderResult";

let nextGroupId = 1;
function newGroup(): DietaryGroupInput {
  return { id: `g${nextGroupId++}`, people: 1, restrictions: [], notes: "" };
}

export default function Home() {
  const [attendees, setAttendees] = useState(18);
  const [budget, setBudget] = useState(120);
  const [groups, setGroups] = useState<DietaryGroupInput[]>([
    { id: "g0", people: 2, restrictions: ["vegetarian", "glutenFriendly"], notes: "No mushrooms" },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildOrderResult | null>(null);
  const [visibleSteps, setVisibleSteps] = useState(0);
  // The exact input the current result was built/verified against - kept
  // separate from the live form state so a later buffer recalculation is
  // always deterministic against what's actually displayed, even if the
  // user tweaks the form afterward without rebuilding.
  const [lastOrderInput, setLastOrderInput] = useState<BuildOrderInput | null>(null);

  function updateGroup(id: string, patch: Partial<DietaryGroupInput>) {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  function toggleRestriction(id: string, r: Restriction) {
    setGroups((gs) =>
      gs.map((g) =>
        g.id === id
          ? {
              ...g,
              restrictions: g.restrictions.includes(r)
                ? g.restrictions.filter((x) => x !== r)
                : [...g.restrictions, r],
            }
          : g
      )
    );
  }

  async function buildTonightsOrder() {
    setLoading(true);
    setError(null);
    setResult(null);
    setVisibleSteps(0);

    const requestInput: BuildOrderInput = {
      attendees,
      budget,
      storeId: "10088",
      groups: groups.map((g) => ({
        id: g.id,
        people: g.people,
        restrictions: g.restrictions,
        notes: g.notes || undefined,
      })),
    };

    try {
      const res = await fetch("/api/build-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestInput),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
      }

      const built = data as BuildOrderResult;
      setResult(built);
      setLastOrderInput(requestInput);

      // Play the (already-computed, deterministic) step log back with a
      // short delay per step so the agent's activity is visible rather
      // than appearing all at once.
      built.steps.forEach((_, i) => {
        setTimeout(() => setVisibleSteps((v) => Math.max(v, i + 1)), i * 420);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const groupPeopleSum = groups.reduce((sum, g) => sum + g.people, 0);
  const overAllocated = groupPeopleSum > attendees;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header>
        <p className="text-xs font-semibold tracking-widest text-accent uppercase">
          PEI IT Alliance
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          The Night Shift — Pizza Order
        </h1>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Tonight&apos;s Crew</h2>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">People</span>
            <input
              type="number"
              min={1}
              max={200}
              value={attendees}
              onChange={(e) => setAttendees(Number(e.target.value))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Budget ($ CAD)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Location</span>
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-base text-muted">
            Little Caesars — Store #10088
          </div>
        </div>
      </section>

      <section
        id="dietary-groups"
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6 scroll-mt-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Dietary Groups</h2>
          {overAllocated && (
            <span className="text-xs font-medium text-danger">
              {groupPeopleSum} in groups exceeds {attendees} attendees
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {groups.length === 0 && (
            <p className="text-sm text-muted">No dietary restrictions added</p>
          )}
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-2.5 rounded-lg border border-border p-3.5">
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  value={g.people}
                  onChange={(e) => {
                    // A dietary group must always have at least 1 person -
                    // "no restrictions" is represented by removing the
                    // group entirely, never by a group with 0 people.
                    const parsed = Number(e.target.value);
                    const people = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
                    updateGroup(g.id, { people });
                  }}
                  className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
                <span className="text-sm text-muted">people</span>
                <button
                  onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}
                  className="ml-auto text-xs font-medium text-muted hover:text-danger"
                  aria-label="Remove group"
                >
                  Remove
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {ALL_RESTRICTIONS.map((r) => {
                  const active = g.restrictions.includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => toggleRestriction(g.id, r)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        active
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-muted hover:border-accent/50"
                      }`}
                    >
                      {RESTRICTION_LABELS[r]}
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                placeholder="Notes (optional) — e.g. no mushrooms"
                value={g.notes ?? ""}
                onChange={(e) => updateGroup(g.id, { notes: e.target.value })}
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
          ))}
        </div>

        <button
          onClick={() => setGroups((gs) => [...gs, newGroup()])}
          className="self-start text-sm font-medium text-accent hover:underline"
        >
          + Add dietary group
        </button>
      </section>

      <button
        onClick={buildTonightsOrder}
        disabled={loading || overAllocated}
        className="rounded-xl bg-accent px-6 py-4 text-base font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-[#c04a1a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Building tonight's order…" : "Build Tonight's Order"}
      </button>

      <Link
        href="/compare-dominos"
        className="rounded-xl border border-border bg-surface px-6 py-3 text-center text-sm font-semibold text-foreground transition-colors hover:border-accent hover:text-accent"
      >
        Compare live Domino&apos;s stores
      </Link>

      {error && (
        <div className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</div>
      )}

      {result && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Agent Activity</h2>
          <ActivityLog steps={result.steps} visibleCount={visibleSteps} />
          {visibleSteps >= result.steps.length && (
            <OrderSheet result={result} orderInput={lastOrderInput} onUseBudget={setBudget} />
          )}
        </section>
      )}
    </div>
  );
}
