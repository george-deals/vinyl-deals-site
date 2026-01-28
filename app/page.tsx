// app/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "MediaDealsHub — Amazon Deals on Vinyl Records, 4K UHD, Blu-ray, CDs & DVDs",
  description:
    "Track daily Amazon price drops on physical media. New copies only, 15%+ off minimum, sorted by best sellers first.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "MediaDealsHub — Daily Amazon Physical Media Deals",
    description:
      "Daily Amazon price drops on Vinyl Records, 4K UHD, Blu-ray, CDs, and DVDs. New copies only. 15%+ off minimum. Best sellers first.",
    url: "/",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Subtle background (light-only) */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-slate-50 via-white to-white" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-60 [background:radial-gradient(60%_50%_at_50%_0%,rgba(15,23,42,0.06),transparent_70%)]" />

      <div className="mx-auto max-w-6xl px-6">
        <header className="py-10">
          {/* Hero */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white/80 p-10 shadow-sm backdrop-blur">
            {/* Subtle “confidence bar” accent */}
            <div className="absolute inset-x-0 top-0 h-1 bg-slate-900" />

            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Prices Updated Hourly
            </div>

            <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Daily Amazon Deals on Physical Media.
            </h1>

            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-700">
              Find daily price drops on <strong>Vinyl Records</strong>, <strong>4K UHD Movies</strong>,{" "}
              <strong>Blu-ray Discs</strong>, <strong>CDs</strong> and <strong>DVDs.</strong> <br></br>
              15%+ OFF Drops • New Condition • Best Sellers
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <PrimaryButton href="/vinyl">Vinyl Deals</PrimaryButton>
              <SecondaryButton href="/4k-uhd">4K UHD Deals</SecondaryButton>
            </div>

            {/* Quiet proof points */}
            <div className="mt-8 grid gap-3 text-sm text-slate-700 sm:grid-cols-4">
              <MiniStat title="Updated Daily" desc="fresh price drops" />
              <MiniStat title="New Only" desc="no used listings" />
              <MiniStat title="15%+ OFF" desc="minimum discount" />
              <MiniStat title="Best Sellers First" desc="popularity ranked" />
            </div>
          </div>
        </header>

        {/* Top deal pages */}
        <section className="pb-12">
          <div className="flex items-end justify-between gap-6">
            <h2 className="text-xl font-semibold text-slate-900">
              Top Amazon Deal Pages
            </h2>
            <div className="hidden text-sm text-slate-600 sm:block">
              The Fastest Way To Find Great Prices.
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BucketCard
              href="/vinyl/under-20"
              badge="Vinyl Records"
              title="Vinyl Under $20"
              subtitle="LPs at Low Prices"
            />
            <BucketCard
              href="/vinyl/30-percent-off"
              badge="Vinyl Records"
              title="Vinyl 30%+ OFF"
              subtitle="Biggest Discounts"
            />
            <BucketCard
              href="/4k-uhd/under-15"
              badge="4K UHD"
              title="4K UHD Under $15"
              subtitle="Upgrade for Less"
            />
            <BucketCard
              href="/4k-uhd/30-percent-off"
              badge="4K UHD"
              title="4K UHD 30%+ OFF"
              subtitle="Best Value Titles"
            />
          </div>
        </section>

        {/* Browse by format */}
        <section className="pb-12">
          <div className="flex items-end justify-between gap-6">
            <h2 className="text-xl font-semibold text-slate-900">
              Browse Deals by Format
            </h2>
            <div className="hidden text-sm text-slate-600 sm:block">
              Chose Your Media, Select Your Deals:
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FormatCard
              href="/vinyl"
              title="Vinyl"
              subtitle="LPs, EPs & Box Sets"
              icon={<IconVinyl />}
            />
            <FormatCard
              href="/cd"
              title="CD"
              subtitle="Albums & Collections"
              icon={<IconCD />}
            />
            <FormatCard
              href="/4k-uhd"
              title="4K UHD"
              subtitle="Best Picture Quality"
              icon={<Icon4K />}
            />
            <FormatCard
              href="/blu-ray"
              title="Blu-ray"
              subtitle="Movies & TV"
              icon={<IconBluRay />}
            />
            <FormatCard
              href="/dvd"
              title="DVDs"
              subtitle="Catalog Favorites"
              icon={<IconDVD />}
            />
          </div>
        </section>

        {/* Disclosure */}
        <section className="pb-14">
          <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Disclosure</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              MediaDealsHub participates in the Amazon Associates program. If you click a link and
              make a purchase, we may earn a commission at no extra cost to you.
            </p>

            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link href="/disclosure" className="text-slate-700 underline hover:text-slate-900">
                Full disclosure
              </Link>
              <Link href="/privacy" className="text-slate-700 underline hover:text-slate-900">
                Privacy
              </Link>
              <Link href="/terms" className="text-slate-700 underline hover:text-slate-900">
                Terms
              </Link>
            </div>
          </div>

          <p className="mt-6 pb-2 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} MediaDealsHub
          </p>
        </section>
      </div>
    </main>
  );
}

/* ---------- UI helpers ---------- */

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white hover:text-slate-900"
    >
      {children}
    </Link>
  );
}

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

function BucketCard({
  href,
  badge,
  title,
  subtitle,
}: {
  href: string;
  badge: string;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex items-center rounded-md border border-slate-200 bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
          {badge}
        </div>
        <span className="text-xs text-slate-400 group-hover:text-slate-600">Open →</span>
      </div>

      <div className="mt-4">
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
      </div>
    </Link>
  );
}

function InfoCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-6">
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{desc}</div>
    </div>
  );
}

function MiniStat({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-xs text-slate-600">{desc}</div>
    </div>
  );
}

function FormatCard({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700">
          {icon}
        </div>
        <span className="text-xs text-slate-400 group-hover:text-slate-600">View →</span>
      </div>

      <div className="mt-4">
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
      </div>
    </Link>
  );
}

/* ---------- Icons ---------- */

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 3.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
function IconVinyl() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
        fill="currentColor"
      />
    </svg>
  );
}
function IconCD() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
        fill="currentColor"
      />
    </svg>
  );
}
function IconBluRay() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M7 5h10a2 2 0 0 1 2 2v12H5V7a2 2 0 0 1 2-2Zm0 2v10h10V7H7Zm2 1h6v2H9V8Zm0 3h6v2H9v-2Z"
        fill="currentColor"
      />
    </svg>
  );
}
function Icon4K() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M5 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v6h14V9H5Zm2 1h2v4H7v-4Zm4 0h2l2 2v-2h2v4h-2l-2-2v2h-2v-4Z"
        fill="currentColor"
      />
    </svg>
  );
}
function IconDVD() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M6 6h12v12H6V6Zm2 2v8h8V8H8Zm2 1h4v2h-4V9Zm0 3h4v2h-4v-2Z"
        fill="currentColor"
      />
    </svg>
  );
}
