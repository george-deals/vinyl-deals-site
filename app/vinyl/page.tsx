export const metadata = {
  title: "Best Vinyl Deals Today (Top Amazon Discounts)",
  description:
    "Browse the best vinyl record deals on Amazon. New LPs only. Updated daily with top discounts across rock, jazz, hip hop, and more.",
};

export default function VinylDealsPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Best Vinyl Deals Today
          </h1>
          <p className="mt-3 text-lg text-neutral-600">
            Hand-picked Amazon deals on new vinyl records. No used listings.
          </p>
        </header>

        {/* Placeholder state until Amazon API is active */}
        <section className="rounded-xl border border-neutral-200 p-6">
          <h2 className="text-xl font-semibold">Top Vinyl Deals</h2>

          <p className="mt-4 text-neutral-600">
            Deals are currently syncing. Once Amazon Product Advertising API
            access is active, the top discounted vinyl records will appear here
            automatically.
          </p>

          <ul className="mt-6 list-disc space-y-2 pl-5 text-neutral-700">
            <li>Rock, jazz, hip hop, soundtracks, and more</li>
            <li>Discount percentage + current price</li>
            <li>Direct “Buy on Amazon” links</li>
          </ul>

          <p className="mt-6 text-sm text-neutral-500">
            Affiliate disclosure: As an Amazon Associate I earn from qualifying purchases.
          </p>
        </section>
      </div>
    </main>
  );
}
