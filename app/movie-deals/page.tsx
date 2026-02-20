import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Movie Deals: Blu-ray, 4K UHD & DVD (Amazon US)",
  description:
    "Find live Amazon movie deals across Blu-ray, 4K UHD, and DVD. Updated regularly with 15%+ discounts and direct links.",
  alternates: { canonical: "/movie-deals" },
  openGraph: {
    title: "Movie Deals on Blu-ray, 4K UHD & DVD",
    description:
      "Track Amazon movie deals on Blu-ray, 4K UHD, and DVD with 15%+ discounts.",
    url: "/movie-deals",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function MovieDealsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Movie Deals</h1>
        <p className="max-w-3xl text-slate-700">
          This page is focused on the movie formats that are currently showing the strongest search
          demand: <strong>Blu-ray</strong>, <strong>4K UHD</strong>, and <strong>DVD</strong>.
          All deal pages below use the same 15%+ discount threshold.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormatCard
          href="/blu-ray"
          title="Blu-ray Deals"
          subtitle="Top blu ray deals and catalog titles"
        />
        <FormatCard
          href="/4k-uhd"
          title="4K UHD Deals"
          subtitle="Premium video formats at lower prices"
        />
        <FormatCard
          href="/dvd"
          title="DVD Deals"
          subtitle="Budget-friendly movie deals"
        />
      </div>

      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Popular Movie Deal Searches</h2>
        <p className="mt-2 text-sm text-slate-600">
          Internal links are mapped to search terms already appearing in Search Console.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QueryLink href="/blu-ray" query="blu ray deals" />
          <QueryLink href="/blu-ray" query="bluray deals" />
          <QueryLink href="/blue-ray-movies-on-sale" query="blue ray movies on sale" />
          <QueryLink href="/dvd" query="dvd deals" />
          <QueryLink href="/4k-uhd" query="4k uhd deals" />
          <QueryLink href="/vinyl" query="amazon vinyl deals" />
        </div>
      </section>
    </main>
  );
}

function FormatCard({
  href,
  title,
  subtitle,
}: {
  href: string;
  title: string;
  subtitle: string;
}) {
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

function QueryLink({ href, query }: { href: string; query: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
    >
      {query}
    </Link>
  );
}
