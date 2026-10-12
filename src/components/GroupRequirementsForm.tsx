"use client";

import { useRef, useState } from "react";

import { GatherBiteInputSchema, type GatherBiteInput } from "@/lib/gatherbite/contracts";
import {
  ALL_PIZZA_PREFERENCES,
  ALL_RESTRICTIONS,
  PIZZA_PREFERENCE_LABELS,
  RESTRICTION_LABELS,
  type PizzaPreference,
  type Restriction,
} from "@/lib/types";

type ServiceMethod = GatherBiteInput["serviceMethod"];

interface EditableDietaryGroup {
  id: string;
  people: string;
  restrictions: Restriction[];
  notes: string;
}

export interface GroupRequirementsFormProps {
  busy: boolean;
  onSubmit: (input: GatherBiteInput) => void | Promise<void>;
}

const fieldClassName =
  "w-full rounded-xl border border-border bg-background px-3.5 py-3 text-base outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/15";

function issueMessage(path: PropertyKey[]): string {
  const joined = path.join(".");
  if (joined === "attendees") return "Enter the number of people (1–200).";
  if (joined === "budgetCad") return "Enter a maximum budget greater than $0.";
  if (joined.startsWith("deliveryAddress")) return "Enter a complete PEI delivery address.";
  if (joined.includes("restrictions")) return "Choose at least one restriction for each dietary need.";
  if (joined.includes("people")) return "Each dietary need must include at least one person.";
  return "Check the group details and try again.";
}

export function GroupRequirementsForm({ busy, onSubmit }: GroupRequirementsFormProps) {
  const [attendees, setAttendees] = useState("");
  const [budgetCad, setBudgetCad] = useState("");
  const [serviceMethod, setServiceMethod] = useState<ServiceMethod>("either");
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [groups, setGroups] = useState<EditableDietaryGroup[]>([]);
  const [pizzaPreferences, setPizzaPreferences] = useState<PizzaPreference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nextGroupId = useRef(0);
  const needsAddress = serviceMethod !== "carryout";

  function addDietaryGroup() {
    nextGroupId.current += 1;
    setGroups((current) => [...current, {
      id: `dietary-${nextGroupId.current}`,
      people: "",
      restrictions: [],
      notes: "",
    }]);
  }

  function updateGroup(id: string, patch: Partial<EditableDietaryGroup>) {
    setGroups((current) => current.map((group) => group.id === id ? { ...group, ...patch } : group));
  }

  function toggleRestriction(id: string, restriction: Restriction) {
    setGroups((current) => current.map((group) => {
      if (group.id !== id) return group;
      return {
        ...group,
        restrictions: group.restrictions.includes(restriction)
          ? group.restrictions.filter((value) => value !== restriction)
          : [...group.restrictions, restriction],
      };
    }));
  }

  function togglePreference(preference: PizzaPreference) {
    setPizzaPreferences((current) => current.includes(preference)
      ? current.filter((value) => value !== preference)
      : [...current, preference]);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = GatherBiteInputSchema.safeParse({
      attendees: Number(attendees),
      budgetCad: Number(budgetCad),
      serviceMethod,
      deliveryAddress: needsAddress ? {
        street,
        unit: unit.trim() || undefined,
        city,
        province: "PE" as const,
        postalCode,
      } : undefined,
      groups: groups.map((group) => ({
        id: group.id,
        people: Number(group.people),
        restrictions: group.restrictions,
        notes: group.notes.trim() || undefined,
      })),
      pizzaPreferences,
    });
    if (!parsed.success) {
      setError(issueMessage(parsed.error.issues[0]?.path ?? []));
      return;
    }
    void onSubmit(parsed.data);
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <section className="form-card">
        <div>
          <p className="section-label">Group requirements</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">What does your group need?</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="attendees">
            People
            <input id="attendees" name="attendees" type="number" inputMode="numeric" min={1} max={200}
              value={attendees} onChange={(event) => setAttendees(event.target.value)}
              className={fieldClassName} placeholder="e.g. 18" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="budgetCad">
            Maximum total budget (CAD)
            <input id="budgetCad" name="budgetCad" type="number" inputMode="decimal" min={0.01} max={5000}
              step="0.01" value={budgetCad} onChange={(event) => setBudgetCad(event.target.value)}
              className={fieldClassName} placeholder="e.g. 120" />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-sm font-medium">How should the order be fulfilled?</legend>
          <div className="grid grid-cols-3 gap-2">
            {(["delivery", "carryout", "either"] as const).map((method) => (
              <label key={method} className={`service-choice ${serviceMethod === method ? "service-choice-selected" : ""}`}>
                <input type="radio" name="serviceMethod" value={method} checked={serviceMethod === method}
                  onChange={() => setServiceMethod(method)} className="sr-only" />
                {method === "delivery" ? "Delivery" : method === "carryout" ? "Carryout" : "Either"}
              </label>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted">Either lets GatherBite choose the best verified service and store.</p>
        </fieldset>

        {needsAddress && (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="col-span-full mb-1 text-sm font-medium">Delivery address</legend>
            <label className="flex flex-col gap-1.5 text-sm sm:col-span-2" htmlFor="street">
              Street address
              <input id="street" name="street" autoComplete="street-address" value={street}
                onChange={(event) => setStreet(event.target.value)} className={fieldClassName} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm" htmlFor="unit">
              Unit <span className="text-muted">(optional)</span>
              <input id="unit" name="unit" autoComplete="address-line2" value={unit}
                onChange={(event) => setUnit(event.target.value)} className={fieldClassName} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm" htmlFor="city">
              City
              <input id="city" name="city" autoComplete="address-level2" value={city}
                onChange={(event) => setCity(event.target.value)} className={fieldClassName} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm" htmlFor="postalCode">
              Postal code
              <input id="postalCode" name="postalCode" autoComplete="postal-code" value={postalCode}
                onChange={(event) => setPostalCode(event.target.value.toUpperCase())}
                className={fieldClassName} placeholder="C1A 1A1" />
            </label>
            <div className="flex flex-col gap-1.5 text-sm">
              <span>Province</span>
              <div className={`${fieldClassName} text-muted`} aria-label="Province: Prince Edward Island">Prince Edward Island</div>
            </div>
          </fieldset>
        )}
      </section>

      <section className="form-card">
        <div>
          <p className="section-label">Dietary needs</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">Add only what applies. Each need is verified independently from trusted evidence.</p>
        </div>
        <p className="safety-note">
          For severe allergies, confirm ingredients and cross-contact directly with the restaurant before ordering.
        </p>
        {groups.map((group, index) => (
          <fieldset key={group.id} data-dietary-group={group.id} className="rounded-xl border border-border bg-background p-4">
            <legend className="px-1 text-sm font-semibold">Dietary need {index + 1}</legend>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex w-28 flex-col gap-1.5 text-sm" htmlFor={`${group.id}-people`}>
                People
                <input id={`${group.id}-people`} name={`${group.id}-people`} type="number" inputMode="numeric"
                  min={1} max={200} value={group.people} onChange={(event) => updateGroup(group.id, { people: event.target.value })}
                  className={fieldClassName} />
              </label>
              <button type="button" onClick={() => setGroups((current) => current.filter((value) => value.id !== group.id))}
                className="mb-3 ml-auto text-sm font-medium text-muted hover:text-danger focus-visible:text-danger"
                aria-label={`Remove dietary need ${index + 1}`}>Remove</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" aria-label={`Restrictions for dietary need ${index + 1}`}>
              {ALL_RESTRICTIONS.map((restriction) => {
                const active = group.restrictions.includes(restriction);
                return (
                  <button type="button" key={restriction} aria-pressed={active}
                    onClick={() => toggleRestriction(group.id, restriction)}
                    className={`intent-chip ${active ? "intent-chip-selected" : ""}`}>
                    {RESTRICTION_LABELS[restriction]}
                  </button>
                );
              })}
            </div>
            <label className="mt-3 flex flex-col gap-1.5 text-sm" htmlFor={`${group.id}-notes`}>
              Notes <span className="text-muted">(optional)</span>
              <input id={`${group.id}-notes`} name={`${group.id}-notes`} value={group.notes}
                onChange={(event) => updateGroup(group.id, { notes: event.target.value })}
                className={fieldClassName} placeholder="e.g. no mushrooms" />
            </label>
          </fieldset>
        ))}
        <button type="button" onClick={addDietaryGroup} className="secondary-action self-start">Add dietary need</button>
      </section>

      <section className="form-card">
        <div>
          <p className="section-label">Food preferences</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Optional — pick any. GatherBite chooses the pizzas, quantities, deals, and configurations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_PIZZA_PREFERENCES.map((preference) => {
            const active = pizzaPreferences.includes(preference);
            return (
              <button type="button" key={preference} aria-pressed={active} onClick={() => togglePreference(preference)}
                className={`intent-chip ${active ? "intent-chip-selected" : ""}`}>
                {PIZZA_PREFERENCE_LABELS[preference]}
              </button>
            );
          })}
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="primary-action">
        {busy ? "Finding a verified order…" : "Find my verified order"}
      </button>
    </form>
  );
}
