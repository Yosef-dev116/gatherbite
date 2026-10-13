import Link from "next/link";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-6 sm:px-6 sm:pb-8">
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
