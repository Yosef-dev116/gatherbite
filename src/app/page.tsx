"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ALL_PIZZA_PREFERENCES,
  ALL_RESTRICTIONS,
  PIZZA_PREFERENCE_LABELS,
  RESTRICTION_LABELS,
} from "@/lib/types";
import type { BuildOrderInput, DietaryGroupInput, PizzaPreference, Restriction } from "@/lib/types";
import type { GatherBiteResult } from "@/lib/gatherbite";
import { GatherBiteResults } from "@/components/GatherBiteResults";

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
  const [pizzaPreferences, setPizzaPreferences] = useState<PizzaPreference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GatherBiteResult | null>(null);

  function updateGroup(id: string, patch: Partial<DietaryGroupInput>) {
    setGroups((current) => current.map((group) => (group.id === id ? { ...group, ...patch } : group)));
  }

  function toggleRestriction(id: string, restriction: Restriction) {
    setGroups((current) =>
      current.map((group) =>
        group.id === id
          ? {
              ...group,
              restrictions: group.restrictions.includes(restriction)
                ? group.restrictions.filter((item) => item !== restriction)
                : [...group.restrictions, restriction],
            }
          : group
      )
    );
  }

  function togglePizzaPreference(preference: PizzaPreference) {
    setPizzaPreferences((current) =>
      current.includes(preference)
        ? current.filter((item) => item !== preference)
        : [...current, preference]
    );
  }

  async function evaluateOptions() {
    setLoading(true);
    setError(null);
    setResult(null);

    const requestInput: BuildOrderInput = {
      attendees,
      budget,
      storeId: "10088",
      groups: groups.map((group) => ({
        id: group.id,
        people: group.people,
        restrictions: group.restrictions,
        notes: group.notes || undefined,
      })),
      pizzaPreferences,
    };

    try {
      const response = await fetch("/api/gatherbite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestInput),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
      }
      setResult(data as GatherBiteResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const groupPeopleSum = groups.reduce((sum, group) => sum + group.people, 0);
  const overAllocated = groupPeopleSum > attendees;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <p className="text-xs font-semibold tracking-widest text-accent uppercase">PEI IT Alliance</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">GatherBite</h1>
        <p className="mt-1.5 text-sm text-muted">The AI agent that figures out how to feed your group.</p>
      </header>

      <div className="grid grid-cols-5 items-center gap-2 text-center text-xs font-medium text-muted" aria-label="GatherBite process">
        <span className="rounded-lg border border-border bg-surface px-2 py-2">Group requirements</span>
        <span aria-hidden="true">→</span>
        <span className="rounded-lg border border-border bg-surface px-2 py-2">Verified options</span>
        <span aria-hidden="true">→</span>
        <span className="rounded-lg border border-border bg-surface px-2 py-2">Your decision</span>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Group requirements</h2>
          <p className="mt-1 text-sm text-muted">Night Shift demo · pizza capacity uses 3 slices per person.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">People</span>
            <input
              type="number"
              min={1}
              max={200}
              value={attendees}
              onChange={(event) => setAttendees(Number(event.target.value))}
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
              onChange={(event) => setBudget(Number(event.target.value))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Location / stores with supported data</span>
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-base text-muted">
            Charlottetown, PE · Little Caesars #10088 + nearby Domino&apos;s stores
          </div>
        </div>
      </section>

      <section
        id="dietary-groups"
        className="flex scroll-mt-6 flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Dietary groups</h2>
          {overAllocated && (
            <span className="text-right text-xs font-medium text-danger">
              {groupPeopleSum} in groups exceeds {attendees} attendees
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {groups.length === 0 && <p className="text-sm text-muted">No dietary restrictions added</p>}
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-2.5 rounded-lg border border-border p-3.5">
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  value={group.people}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const people = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
                    updateGroup(group.id, { people });
                  }}
                  className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
                <span className="text-sm text-muted">people</span>
                <button
                  type="button"
                  onClick={() => setGroups((current) => current.filter((item) => item.id !== group.id))}
                  className="ml-auto text-xs font-medium text-muted hover:text-danger"
                  aria-label="Remove group"
                >
                  Remove
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {ALL_RESTRICTIONS.map((restriction) => {
                  const active = group.restrictions.includes(restriction);
                  return (
                    <button
                      type="button"
                      key={restriction}
                      onClick={() => toggleRestriction(group.id, restriction)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        active
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-muted hover:border-accent/50"
                      }`}
                    >
                      {RESTRICTION_LABELS[restriction]}
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                placeholder="Notes (optional) — e.g. no mushrooms"
                value={group.notes ?? ""}
                onChange={(event) => updateGroup(group.id, { notes: event.target.value })}
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setGroups((current) => [...current, newGroup()])}
          className="self-start text-sm font-medium text-accent hover:underline"
        >
          + Add dietary group
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Pizza preferences</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Optional taste preferences for general pizza lines. Dietary coverage is secured first, and these choices
            never replace items relied upon for dietary verification.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_PIZZA_PREFERENCES.map((preference) => {
            const active = pizzaPreferences.includes(preference);
            return (
              <button
                type="button"
                key={preference}
                onClick={() => togglePizzaPreference(preference)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-muted hover:border-accent/50"
                }`}
              >
                {PIZZA_PREFERENCE_LABELS[preference]}
              </button>
            );
          })}
        </div>
        {pizzaPreferences.length > 0 && (
          <button
            type="button"
            onClick={() => setPizzaPreferences([])}
            className="self-start text-xs font-medium text-muted hover:text-accent hover:underline"
          >
            Clear preferences
          </button>
        )}
      </section>

      <button
        type="button"
        onClick={evaluateOptions}
        disabled={loading || overAllocated}
        className="rounded-xl bg-accent px-6 py-4 text-base font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-[#c04a1a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Evaluating trusted restaurant data…" : "Evaluate My Options"}
      </button>

      {error && <div className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{error}</div>}

      {result && <GatherBiteResults options={result.options} dominosTradeoff={result.dominosTradeoff} />}

      <Link href="/compare-dominos" className="self-center text-xs text-muted hover:text-accent hover:underline">
        Domino&apos;s adapter debug view
      </Link>
    </div>
  );
}
