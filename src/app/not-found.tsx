import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        <SiteNav />
        <section className="empty-page">
          <p className="section-label">404</p>
          <h1>That page is not on the menu.</h1>
          <p>The link may be outdated, but the GatherBite planner is ready when you are.</p>
          <Link href="/" className="primary-action inline-flex self-start">Return home</Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
