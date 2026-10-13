"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  // `retry()` re-fetches and re-renders this segment. `reset()` only clears the
  // boundary without re-fetching, so it cannot recover a failed server render.
  retry: () => void;
}) {
  useEffect(() => {
    console.error("GatherBite page error", error.digest ?? "unknown");
  }, [error]);

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl place-items-center px-4 py-12">
      <section className="form-card w-full" role="alert">
        <p className="section-label">Something went wrong</p>
        <h1 className="text-2xl font-bold tracking-tight">This page could not finish loading.</h1>
        <p className="text-sm leading-relaxed text-muted">
          Your order has not been placed or paid for. Try the page again, or return home if the problem continues.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="primary-action" onClick={() => retry()}>Try again</button>
          <Link href="/" className="secondary-action inline-flex">Return home</Link>
        </div>
      </section>
    </main>
  );
}
