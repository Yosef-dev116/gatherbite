import Link from "next/link";

function BiteMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function BrandLink() {
  return (
    <Link href="/" className="brand-link" aria-label="GatherBite home">
      <BiteMark />
      <span>GatherBite</span>
    </Link>
  );
}

export function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Primary navigation">
      <BrandLink />
      <div className="flex items-center gap-1 sm:gap-2">
        <Link href="/privacy">Privacy</Link>
        <Link href="/support">Support</Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>GatherBite helps you decide. You always review and complete the order.</p>
        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Footer navigation">
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
          <a href="https://github.com/Yosef-dev116/gatherbite" target="_blank" rel="noreferrer">Source</a>
        </nav>
      </div>
    </footer>
  );
}
