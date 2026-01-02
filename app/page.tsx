import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "MediaDealsHub | Daily Amazon Deals on Vinyl, 4K UHD, Blu-ray, CDs & DVDs",
  description:
    "MediaDealsHub is a fast, SEO-friendly dashboard that tracks daily Amazon discounts on physical media—vinyl records, CDs, Blu-ray, 4K UHD, and DVDs. New condition only. 15%+ off. Sorted by best sellers first.",
  alternates: {
    canonical: "https://www.mediadealshub.com/",
  },
  openGraph: {
    title: "MediaDealsHub | Daily Physical Media Deals",
    description:
      "Track daily Amazon discounts on vinyl, CDs, Blu-ray, 4K UHD, and DVDs. New only. 15%+ off. Best sellers first.",
    url: "https://www.mediadealshub.com/",
    siteName: "MediaDealsHub",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MediaDealsHub | Daily Physical Media Deals",
    description:
      "Daily Amazon discounts on vinyl, CDs, Blu-ray, 4K UHD, and DVDs. New only. 15%+ off. Best sellers first.",
  },
};


export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Subtle background (no images, no JS) */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-slate-50 via-white to-white" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-70 [background:radial-gradient(60%_50%_at_50%_0%,rgba(15,23,42,0.06),transparent_70%)]" />

      <div className="mx-auto max-w-6xl px-6">
        {/* Top bar */}
        <header className="py-10">
          <div className="flex items-center justify-between gap-6">
            <Link href="/" className="group inline-flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white shadow-sm">
                <LogoMark />
              </div>
              <div className="leading-tight">
                <div className="text-base font-semibold tracking-tight text-slate-900">
                  MediaDealsHub
                </div>
                <div className="text-xs text-slate-500">
                  Daily Amazon deals on physical media
                </div>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
              <NavLink href="/vinyl">Vinyl</NavLink>
              <NavLink href="/cds">CDs</NavLink>
              <NavLink href="/blu-ray">Blu-ray</NavLink>
              <NavLink href="/4k-uhd">4K UHD</NavLink>
              <NavLink href="/dvd">DVD</NavLink>
              <NavLink href="/disclosure">Disclosure</NavLink>
            </nav>
          </div>
        </header>

        {/* Hero */}
        <section className="pb-8">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-7">
              <p className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-900" />
                Updated daily • New condition only • 15%+ off
              </p>

              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                Daily Amazon Deals on Vinyl & Physical Media
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
                MediaDealsHub tracks discounted <strong>new-condition</strong> titles from Amazon
                across vinyl, CDs, Blu-ray, 4K UHD, and DVDs. Listings are prioritized by
                best sellers first—so you can find great deals fast without coupon spam.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <PrimaryButton href="/vinyl">Browse Vinyl Deals</PrimaryButton>
                <SecondaryButton href="/4k-uhd">Browse 4K UHD Deals</SecondaryButton>
                <Link
                  href="#how-it-works"
                  className="text-sm font-medium text-slate-600 underline-offset-4 hover:underline"
                >
                  How it works
                </Link>
              </div>

              <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-500">
                <TrustPill>Fast, crawlable pages</TrustPill>
                <TrustPill>Sorted by best sellers</TrustPill>
                <TrustPill>No popups / no gimmicks</TrustPill>
              </div>
            </div>

            {/* Right side: “Trust card” (static) */}
            <aside className="lg:col-span-5">
              <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <h2 className="text-base font-semibold text-slate-900">
                  What you’ll see on every category page
                </h2>

                <div className="mt-4 grid gap-3 text-sm text-slate-600">
                  <Bullet
                    title="Top 50 deals"
                    desc="Curated list per category for quick scanning."
                  />
                  <Bullet
                    title="Hard filters"
                    desc="New condition only, 15%+ discount threshold."
                  />
                  <Bullet
                    title="Useful sorting"
                    desc="Best sellers first, then higher discounts."
                  />
                </div>

                <div className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
                  This site uses affiliate links. You pay nothing extra.
                  <span className="ml-1">
                    <Link href="/disclosure" className="font-medium underline underline-offset-4">
                      Disclosure
                    </Link>
                    .
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* Categories */}
        <section className="py-10">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Browse by format</h2>
              <p className="mt-1 text-sm text-slate-600">
                Five categories. Simple, consistent layouts. Built for deal hunters.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CategoryCard
              href="/vinyl"
              title="Vinyl Records"
              description="Top 50 vinyl deals, sorted by best sellers."
              icon={<IconVinyl />}
            />
            <CategoryCard
              href="/cds"
              title="CDs"
              description="Discounted CDs updated daily."
              icon={<IconCD />}
            />
            <CategoryCard
              href="/blu-ray"
              title="Blu-ray"
              description="Blu-ray deals from Amazon best sellers."
              icon={<IconDisc />}
            />
            <CategoryCard
              href="/4k-uhd"
              title="4K UHD"
              description="4K movie deals, filtered to 15%+ off."
              icon={<Icon4K />}
            />
            <CategoryCard
              href="/dvd"
              title="DVDs"
              description="Discounted DVD titles updated daily."
              icon={<IconDVD />}
            />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-12">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                How MediaDealsHub works
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                A straightforward methodology designed for reliability and speed.
                No client-side fetching, no hidden content—just clean lists that search engines
                can crawl and collectors can trust.
              </p>
            </div>

            <div className="lg:col-span-7">
              <div className="grid gap-4 sm:grid-cols-3">
                <StepCard
                  number="01"
                  title="Scan daily"
                  text="We pull Amazon listings each day to identify discounted physical media."
                />
                <StepCard
                  number="02"
                  title="Filter hard"
                  text="New condition only, 15%+ off threshold. No clutter, no filler."
                />
                <StepCard
                  number="03"
                  title="Sort for usefulness"
                  text="Best sellers first, then higher discounts—built for fast browsing."
                />
              </div>

              <div className="mt-6 rounded-2xl border bg-white p-5 text-sm text-slate-600 shadow-sm">
                <div className="font-medium text-slate-900">Not a store. Not a blog. Not coupon spam.</div>
                <p className="mt-2 leading-relaxed">
                  MediaDealsHub is a utility dashboard for physical media discounts. We send you to Amazon
                  for checkout; we don’t collect payments or user data.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Vinyl subgenres (internal linking) */}
        <section className="pb-12">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Popular vinyl genres</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Jump straight to curated vinyl subcategories.
                </p>
              </div>
              <Link
                href="/vinyl"
                className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
              >
                View all vinyl deals
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ["Rock", "/vinyl/rock"],
                ["Hip-Hop", "/vinyl/hip-hop"],
                ["Jazz", "/vinyl/jazz"],
                ["Soundtracks", "/vinyl/soundtracks"],
                ["Pop", "/vinyl/pop"],
                ["Metal", "/vinyl/metal"],
                ["Country", "/vinyl/country"],
                ["Classical", "/vinyl/classical"],
                ["Electronic", "/vinyl/electronic"],
                ["R&B / Soul", "/vinyl/rnb-soul"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-full border bg-slate-50 px-3 py-1 text-sm text-slate-700 hover:bg-white hover:text-slate-900"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t py-10 text-sm text-slate-500">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              © {new Date().getFullYear()} MediaDealsHub • Prices can change on Amazon.
            </div>
            <div className="flex flex-wrap gap-4">
              <Link href="/disclosure" className="hover:text-slate-700 underline underline-offset-4">
                Disclosure
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

/* ------------------------------ Components ------------------------------ */

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium hover:text-slate-900">
      {children}
    </Link>
  );
}

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-xl border bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

function TrustPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border bg-white px-3 py-1 shadow-sm">
      {children}
    </span>
  );
}

function Bullet({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-900" />
      <div>
        <div className="font-medium text-slate-900">{title}</div>
        <div className="text-slate-600">{desc}</div>
      </div>
    </div>
  );
}

function StepCard({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold text-slate-500">{number}</div>
      <div className="mt-2 font-semibold text-slate-900">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}

function CategoryCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 place-items-center rounded-xl border bg-slate-50 text-slate-900">
          {icon}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
          <div className="mt-4 text-sm font-medium text-slate-700 underline-offset-4 group-hover:underline">
            View deals →
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100 [background:radial-gradient(70%_70%_at_50%_0%,rgba(15,23,42,0.06),transparent_60%)]" />
    </Link>
  );
}

/* ------------------------------ Icons (inline SVG) ------------------------------ */

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 20V4h10v16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M7 16h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconVinyl() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="2" />
      <path d="M12 3v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCD() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M16.5 7.5c-1.2-1.2-2.8-2-4.5-2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconDisc() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function Icon4K() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M7 15V9l4 6V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 15V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M17 15l-3-3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconDVD() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 7h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
