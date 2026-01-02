import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <header>
          <h1 className="text-4xl font-bold">Daily Physical Media Deals</h1>
          <p className="mt-3 text-slate-600">
            We track Amazon US listings discounted at least 15% and surface the top savings
            across vinyl, CDs, and movies—updated daily.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            As an Amazon Associate, we earn from qualifying purchases.
          </p>
        </header>

        <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/vinyl"
            className="rounded-xl border bg-white p-5 hover:bg-slate-50"
          >
            <h2 className="text-xl font-semibold">Vinyl Deals</h2>
            <p className="mt-1 text-slate-600">Top 50 vinyl discounts (15%+ off).</p>
          </Link>

          <Link
            href="/cds"
            className="rounded-xl border bg-white p-5 hover:bg-slate-50"
          >
            <h2 className="text-xl font-semibold">CD Deals</h2>
            <p className="mt-1 text-slate-600">Top 50 CD discounts (15%+ off).</p>
          </Link>

          <Link
            href="/4k-uhd"
            className="rounded-xl border bg-white p-5 hover:bg-slate-50"
          >
            <h2 className="text-xl font-semibold">4K UHD Deals</h2>
            <p className="mt-1 text-slate-600">Top 50 4K UHD discounts (15%+ off).</p>
          </Link>

          <Link
            href="/blu-ray"
            className="rounded-xl border bg-white p-5 hover:bg-slate-50"
          >
            <h2 className="text-xl font-semibold">Blu-ray Deals</h2>
            <p className="mt-1 text-slate-600">Top 50 Blu-ray discounts (15%+ off).</p>
          </Link>

          <Link
            href="/dvd"
            className="rounded-xl border bg-white p-5 hover:bg-slate-50"
          >
            <h2 className="text-xl font-semibold">DVD Deals</h2>
            <p className="mt-1 text-slate-600">Top 50 DVD discounts (15%+ off).</p>
          </Link>

          <Link
            href="/disclosure"
            className="rounded-xl border bg-white p-5 hover:bg-slate-50"
          >
            <h2 className="text-xl font-semibold">Disclosure</h2>
            <p className="mt-1 text-slate-600">Affiliate disclosure and site info.</p>
          </Link>
        </section>

        <section className="mt-12 rounded-xl border bg-white p-6">
          <h3 className="text-lg font-semibold">How it works</h3>
          <ul className="mt-3 list-disc pl-6 text-slate-600">
            <li>We pull deals and prices from Amazon US.</li>
            <li>We only keep items discounted at least 15%.</li>
            <li>We store results and refresh daily.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
