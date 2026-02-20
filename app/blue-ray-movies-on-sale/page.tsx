import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blue Ray Movies on Sale (Amazon US)",
  description:
    "Looking for blue ray movies on sale? Browse live Amazon Blu-ray discounts with 15%+ off and filter by discount range.",
  alternates: { canonical: "/blue-ray-movies-on-sale" },
  openGraph: {
    title: "Blue Ray Movies on Sale",
    description:
      "Live Amazon Blu-ray discounts with direct links to 15%+, 30%+, and 50%+ off pages.",
    url: "/blue-ray-movies-on-sale",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function BlueRayMoviesOnSalePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Blue Ray Movies on Sale</h1>
        <p className="max-w-3xl text-slate-700">
          This page targets users searching for blue ray movies on sale. Use the links below to go
          straight into live Blu-ray deal buckets.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <DealLink href="/blu-ray">15%+ Blu-ray Deals</DealLink>
        <DealLink href="/blu-ray?discount=30-40">30%–40% OFF</DealLink>
        <DealLink href="/blu-ray?discount=40-50">40%–50% OFF</DealLink>
        <DealLink href="/blu-ray?discount=50plus">50%+ OFF</DealLink>
        <DealLink href="/movie-deals">All Movie Deals</DealLink>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Related Search Paths</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LinkRow href="/blu-ray" label="blu ray deals" />
          <LinkRow href="/blu-ray" label="bluray deals" />
          <LinkRow href="/dvd" label="dvd deals" />
          <LinkRow href="/4k-uhd" label="4k uhd deals" />
        </div>
      </section>
    </main>
  );
}

function DealLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
    >
      {label}
    </Link>
  );
}
