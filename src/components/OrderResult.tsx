"use client";

import { useMemo, useState } from "react";
import { RESTRICTION_LABELS } from "@/lib/types";
import type { BuildOrderInput, BuildOrderResult, OrderLine, PlanLine, StepEvent, VerifyResult } from "@/lib/types";
import { addBufferItem, linesToOrderLines } from "@/lib/scoring";
import { LITTLE_CAESARS_ORDER_URL } from "@/lib/menu";

function pluralPeople(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

/** Turns raw verification failures into human-readable explanations and a
 * single next-step suggestion. The internal error codes are still shown,
 * but only inside the collapsed "Technical details" section. */
function explainFailures(verification: VerifyResult): { explanations: string[]; advice: string } {
  const explanations: string[] = [];
  let hasDietaryIssue = false;

  for (const g of verification.groupCoverage) {
    if (g.satisfied) continue;
    hasDietaryIssue = true;
    const restrictionText = g.restrictions.map((r) => RESTRICTION_LABELS[r]).join(" + ");
    explanations.push(
      g.impossible
        ? `We couldn't find a trusted menu option that satisfies ${restrictionText} for ${pluralPeople(g.peopleCount)}.`
        : `The plan doesn't yet include enough verified ${restrictionText} slices for that ${pluralPeople(
            g.peopleCount
          )} group (needs ${g.requiredSlices}, has ${g.providedSlices}).`
    );
  }

  const hasBudgetIssue = verification.failures.some((f) => f.code === "BUDGET_EXCEEDED");
  if (hasBudgetIssue) {
    const over = verification.totals.totalCad - verification.totals.budgetCad;
    explanations.push(
      `This order totals $${verification.totals.totalCad.toFixed(2)}, which is $${over.toFixed(
        2
      )} over the $${verification.totals.budgetCad.toFixed(2)} budget.`
    );
  }

  const hasSliceIssue = verification.failures.some((f) => f.code === "INSUFFICIENT_TOTAL_SLICES");
  if (hasSliceIssue) {
    explanations.push(
      `This order provides ${verification.totals.totalSlices} slices, but ${verification.totals.requiredSlices} are needed to feed everyone.`
    );
  }

  const hasInvalidItem = verification.failures.some((f) => f.code === "INVALID_ITEM_REFERENCE");
  if (hasInvalidItem) {
    explanations.push("The agent referenced a menu item that couldn't be matched to the store menu.");
  }

  let advice: string;
  if (hasDietaryIssue) {
    advice = "Adjust those dietary requirements or arrange food for that group separately.";
  } else if (hasBudgetIssue) {
    advice = "Increase the budget or reduce the number of attendees.";
  } else if (hasSliceIssue) {
    advice = "Increase the budget so more slices can be added, or reduce attendees.";
  } else {
    advice = "Adjust the inputs above and try again.";
  }

  return { explanations, advice };
}

function focusDietaryGroups() {
  const section = document.getElementById("dietary-groups");
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  // preventScroll avoids the focus jump cancelling the smooth scroll above.
  section.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
}

function StepRow({ step, visible }: { step: StepEvent; visible: boolean }) {
  const dotColor =
    step.kind === "success" ? "bg-success" : step.kind === "failure" ? "bg-danger" : "bg-accent";
  return (
    <li
      className={`flex items-center gap-2.5 text-sm transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
      <span
        className={
          step.kind === "failure"
            ? "text-danger"
            : step.kind === "success"
              ? "font-medium text-success"
              : "text-foreground/80"
        }
      >
        {step.label}
      </span>
    </li>
  );
}

export function ActivityLog({ steps, visibleCount }: { steps: StepEvent[]; visibleCount: number }) {
  return (
    <ol className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      {steps.map((step, i) => (
        <StepRow key={i} step={step} visible={i < visibleCount} />
      ))}
    </ol>
  );
}

export function OrderSheet({
  result,
  orderInput,
  onUseBudget,
}: {
  result: BuildOrderResult;
  orderInput: BuildOrderInput | null;
  onUseBudget?: (amountCad: number) => void;
}) {
  const { order, verification, verified, budgetSuggestion, foodBuffer } = result;
  const [bufferAdded, setBufferAdded] = useState(false);

  // The buffer item, once added, is a real deterministic recalculation of
  // the SAME verified plan (one more real menu item, re-verified from
  // scratch) — never a mutation of the original baseline order/verification.
  const withBuffer = useMemo(() => {
    if (!bufferAdded || !foodBuffer?.extraItem || !order || !orderInput) return null;
    const baseLines: PlanLine[] = order.map((l) => ({ itemId: l.itemId, quantity: l.quantity }));
    const { lines, verification: newVerification } = addBufferItem(baseLines, foodBuffer.extraItem.itemId, orderInput);
    const newOrder: OrderLine[] = linesToOrderLines(lines);
    newOrder[newOrder.length - 1] = { ...newOrder[newOrder.length - 1], isBuffer: true };
    return { order: newOrder, verification: newVerification };
  }, [bufferAdded, foodBuffer, order, orderInput]);

  const displayOrder = withBuffer?.order ?? order;
  const displayVerification = withBuffer?.verification ?? verification;
  const displayVerified = displayVerification?.verified ?? verified;
  const canAddBuffer = Boolean(
    !bufferAdded && orderInput && foodBuffer?.isSmallBuffer && foodBuffer.extraItem && foodBuffer.fitsBudget
  );

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Tonight&apos;s Order</h2>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase ${
            displayVerified ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
          }`}
        >
          {displayVerified ? "Verified ✓" : "Not fully verified"}
        </span>
      </div>

      {displayOrder && displayOrder.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {displayOrder.map((line, i) => (
            <li
              key={`${line.itemId}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5 text-sm"
            >
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 break-words">
                <span>
                  <span className="font-medium">{line.quantity} ×</span> {line.name}
                </span>
                {line.isBuffer && (
                  <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
                    Buffer
                  </span>
                )}
              </span>
              <span className="shrink-0 text-muted tabular-nums">${line.lineTotalCad.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No plan was produced.</p>
      )}

      {displayVerification && (
        <>
          <div className="rounded-lg bg-accent-soft px-3.5 py-2.5 text-sm font-medium text-accent">
            {displayVerification.totals.totalSlices} slices • covers up to{" "}
            {Math.floor(displayVerification.totals.totalSlices / 3)} people (
            {displayVerification.totals.requiredSlices} slices required)
          </div>

          {foodBuffer && (
            <div className="rounded-lg border border-border px-3.5 py-2.5 text-sm">
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-muted">
                <span>{displayVerification.totals.totalSlices} slices planned</span>
                <span>{displayVerification.totals.requiredSlices} slices baseline</span>
                <span className="font-medium text-foreground">
                  +{displayVerification.totals.totalSlices - displayVerification.totals.requiredSlices} slice
                  buffer
                </span>
              </div>

              {bufferAdded ? (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2.5">
                  <p className="font-medium text-success">Extra buffer added ✓</p>
                  <button
                    onClick={() => setBufferAdded(false)}
                    className="text-xs font-medium text-muted hover:text-danger"
                  >
                    Undo extra pizza
                  </button>
                </div>
              ) : (
                foodBuffer.isSmallBuffer && (
                  <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border pt-2.5 text-muted">
                    <p>
                      This order has only {foodBuffer.bufferSlices} spare slice
                      {foodBuffer.bufferSlices === 1 ? "" : "s"}. Consider adding a little extra if some
                      guests may eat more.
                    </p>
                    {foodBuffer.extraItem &&
                      (foodBuffer.fitsBudget ? (
                        <div className="flex flex-col items-start gap-1.5">
                          <p>+{foodBuffer.extraItem.slices} slices</p>
                          <p>+${foodBuffer.additionalCostCad.toFixed(2)} estimated total</p>
                          <p>New remaining budget: ${foodBuffer.newRemainingBudgetCad.toFixed(2)}</p>
                          <button
                            onClick={() => setBufferAdded(true)}
                            disabled={!canAddBuffer}
                            className="mt-1 inline-flex items-center justify-center rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Add 1 extra {foodBuffer.extraItem.name} · +{foodBuffer.extraItem.slices} slices
                          </button>
                        </div>
                      ) : (
                        <p className="font-medium text-foreground">
                          An extra pizza would exceed your budget by ${foodBuffer.overBudgetByCad.toFixed(2)}.
                        </p>
                      ))}
                  </div>
                )
              )}
            </div>
          )}

          {displayVerification.groupCoverage.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                Dietary coverage
              </h3>
              <ul className="flex flex-col gap-1.5">
                {displayVerification.groupCoverage.map((g) => (
                  <li
                    key={g.groupId}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                  >
                    <span className="min-w-0 break-words">
                      {g.peopleCount}× {g.restrictions.map((r) => RESTRICTION_LABELS[r]).join(" + ")}
                    </span>
                    <span
                      className={
                        g.satisfied
                          ? "shrink-0 font-medium text-success"
                          : "shrink-0 font-medium text-danger"
                      }
                    >
                      {g.satisfied
                        ? `${g.providedSlices}/${g.requiredSlices} slices ✓`
                        : g.impossible
                          ? "not available at this store"
                          : `${g.providedSlices}/${g.requiredSlices} slices`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {displayVerification.bundlesUsed.length > 0 && (
            <p className="text-sm text-muted">
              Deal applied: <span className="text-foreground">{displayVerification.bundlesUsed.join(", ")}</span>
            </p>
          )}

          <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between text-muted">
              <span>Subtotal</span>
              <span className="tabular-nums">${displayVerification.totals.subtotalCad.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Fees</span>
              <span className="tabular-nums">${displayVerification.totals.feesCad.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">${displayVerification.totals.totalCad.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Remaining budget</span>
              <span className="tabular-nums">
                ${displayVerification.totals.remainingBudgetCad.toFixed(2)} of $
                {displayVerification.totals.budgetCad.toFixed(2)}
              </span>
            </div>
          </div>

          {displayVerification.failures.length > 0 &&
            (() => {
              if (budgetSuggestion) {
                return (
                  <div className="rounded-lg bg-danger-soft px-3.5 py-3 text-sm text-danger">
                    <h3 className="text-xs font-semibold tracking-wide uppercase">
                      Why this order couldn&apos;t be verified
                    </h3>
                    <p className="mt-1.5">Your current budget is too low for the cheapest verified order.</p>
                    <p className="mt-3">
                      Minimum workable budget:{" "}
                      <span className="font-semibold">
                        ${budgetSuggestion.minimumWorkableBudgetCad.toFixed(2)}
                      </span>
                    </p>
                    <p className="mt-1">
                      You&apos;re short by:{" "}
                      <span className="font-semibold">${budgetSuggestion.shortfallCad.toFixed(2)}</span>
                    </p>
                    {onUseBudget && (
                      <button
                        onClick={() => onUseBudget(budgetSuggestion.minimumWorkableBudgetCad)}
                        className="mt-3 rounded-md border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
                      >
                        Use ${budgetSuggestion.minimumWorkableBudgetCad.toFixed(2)} Budget
                      </button>
                    )}
                    <details className="mt-3 text-xs text-danger/70">
                      <summary className="cursor-pointer select-none">Technical details</summary>
                      <ul className="mt-1 flex flex-col gap-0.5 font-mono">
                        {displayVerification.failures.map((f, i) => (
                          <li key={i} className="break-words">
                            {f.code}: {f.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                );
              }

              const { explanations, advice } = explainFailures(displayVerification);
              return (
                <div className="rounded-lg bg-danger-soft px-3.5 py-3 text-sm text-danger">
                  <h3 className="text-xs font-semibold tracking-wide uppercase">
                    Why this order couldn&apos;t be verified
                  </h3>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {explanations.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                  <h3 className="mt-3 text-xs font-semibold tracking-wide uppercase">What you can do</h3>
                  <p className="mt-1.5">{advice}</p>
                  <details className="mt-3 text-xs text-danger/70">
                    <summary className="cursor-pointer select-none">Technical details</summary>
                    <ul className="mt-1 flex flex-col gap-0.5 font-mono">
                      {displayVerification.failures.map((f, i) => (
                        <li key={i} className="break-words">
                          {f.code}: {f.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              );
            })()}
        </>
      )}

      {displayVerified ? (
        <>
          <a
            href={LITTLE_CAESARS_ORDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center justify-center rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-[#c04a1a]"
          >
            Approve Order — Open Little Caesars
          </a>
          <p className="text-center text-xs text-muted">
            Opens the real store 10088 ordering page. Nothing is purchased automatically — review and
            check out there yourself.
          </p>
        </>
      ) : (
        <>
          <button
            onClick={focusDietaryGroups}
            className="mt-1 inline-flex items-center justify-center rounded-lg border border-border bg-surface px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            Adjust Constraints
          </button>
          <p className="text-center text-xs text-muted">
            Ordering is disabled until every requirement is verified.
          </p>
        </>
      )}
    </div>
  );
}
