import Link from "next/link";
import type { ReactNode } from "react";

function LogoMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 3c4.418 0 8 3.582 8 8 0 4.418-3.582 8-8 8s-8-3.582-8-8c0-4.418 3.582-8 8-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9.5 9.2h5v5.6h-5V9.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function PillLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white hover:text-slate-900"
    >
      {children}
    </Link>
  );
}

function MobilePillLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white shadow-sm">
              <LogoMark />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">
                MediaDealsHub
              </div>
              <div className="text-xs text-slate-600">
                Daily Amazon Deals • Physical Media
              </div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1 rounded-full bg-slate-100 p-1">
            <PillLink href="/movie-deals">Movies</PillLink>
            <PillLink href="/blu-ray">Blu-ray</PillLink>
            <PillLink href="/4k-uhd">4K UHD</PillLink>
            <PillLink href="/dvd">DVDs</PillLink>
            <PillLink href="/vinyl">Vinyl</PillLink>
            <PillLink href="/cd">CD</PillLink>
          </nav>
        </div>

        {/* Mobile nav (scrollable) */}
        <nav className="sm:hidden -mx-6 px-6 pb-3">
          <div className="flex gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <MobilePillLink href="/movie-deals">Movies</MobilePillLink>
            <MobilePillLink href="/blu-ray">Blu-ray</MobilePillLink>
            <MobilePillLink href="/4k-uhd">4K UHD</MobilePillLink>
            <MobilePillLink href="/dvd">DVDs</MobilePillLink>
            <MobilePillLink href="/vinyl">Vinyl</MobilePillLink>
            <MobilePillLink href="/cd">CD</MobilePillLink>
          </div>
        </nav>
      </div>
    </header>
  );
}
