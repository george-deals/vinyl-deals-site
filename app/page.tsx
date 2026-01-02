export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-4xl font-semibold tracking-tight">
            Vinyl Deals
          </h1>
          <p className="mt-3 text-lg text-neutral-600">
            Daily Amazon deals on new vinyl records. Updated automatically (once Amazon PA-API access is active).
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/vinyl"
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
            >
              View Top Deals
            </a>
            <a
              href="/about"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium"
            >
              About
            </a>
          </div>
        </header>

        <section className="rounded-xl border border-neutral-200 p-6">
          <h2 className="text-xl font-semibold">What you’ll see here</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-neutral-700">
            <li>Top vinyl deals from Amazon (US)</li>
            <li>Price, discount %, and quick “Buy on Amazon” links</li>
            <li>Only new items (no used listings)</li>
          </ul>

          <p className="mt-5 text-sm text-neutral-500">
            Affiliate disclosure: As an Amazon Associate I earn from qualifying purchases.
          </p>
        </section>
      </div>
    </main>
  );
}
