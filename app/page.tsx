import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Amazon Blu-ray Deals, 4K UHD Deals & DVD Deals",
  description:
    "Find live Amazon Blu-ray deals, 4K UHD deals, DVD deals, vinyl deals, and CD deals. New items only, 15%+ off, refreshed hourly.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Amazon Blu-ray, 4K UHD, DVD, Vinyl & CD Deals",
    description:
      "Live Amazon deal tracking for Blu-ray, 4K UHD, DVD, vinyl, and CD with hourly price refreshes.",
    url: "/",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-slate-50 via-white to-white" />

      <div className="mx-auto max-w-6xl px-6 py-10">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Prices Updated Hourly
          </div>

          <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Amazon Physical Media Deals
          </h1>

          <p className="mt-3 max-w-3xl text-lg leading-relaxed text-slate-700">
            Find live <strong>Blu-ray deals</strong>, <strong>4K UHD deals</strong>, and <strong>DVD deals</strong>,
            plus <strong>vinyl</strong> and <strong>CD</strong> discounts. We track new listings with
            at least 15% off and refresh pricing hourly.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <PrimaryButton href="/blu-ray">Blu-ray Deals</PrimaryButton>
            <SecondaryButton href="/4k-uhd">4K UHD Deals</SecondaryButton>
            <SecondaryButton href="/dvd">DVD Deals</SecondaryButton>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold text-slate-900">Browse Formats</h2>
          <p className="mt-1 text-sm text-slate-600">Use filters inside each page for discount ranges and sorting.</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FormatCard href="/blu-ray" title="Blu-ray" subtitle="Movie Deals" />
            <FormatCard href="/4k-uhd" title="4K UHD" subtitle="Movie Deals" />
            <FormatCard href="/dvd" title="DVD" subtitle="Movie Deals" />
            <FormatCard href="/vinyl" title="Vinyl" subtitle="Record Deals" />
            <FormatCard href="/cd" title="CD" subtitle="Album Deals" />
          </div>
        </section>

        <p className="mt-10 pb-2 text-center text-xs text-slate-500">© {new Date().getFullYear()} MediaDealsHub</p>
      </div>
    </main>
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

function FormatCard({ href, title, subtitle }: { href: string; title: string; subtitle: string }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
      <div className="mt-3 text-xs font-semibold text-slate-500 group-hover:text-slate-700">Open page →</div>
    </Link>
  );
}
