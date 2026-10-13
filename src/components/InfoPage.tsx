import type { ReactNode } from "react";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

interface InfoPageProps {
  title: string;
  intro: string;
  children: ReactNode;
}

export function InfoPage({ title, intro, children }: InfoPageProps) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-6 sm:px-6 sm:pb-8">
        <article className="info-page">
          <header>
            <p className="section-label">GatherBite</p>
            <h1>{title}</h1>
            <p className="info-intro">{intro}</p>
          </header>
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
