import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-4xl font-bold">
        Vinyl Deals
      </h1>

      <p className="mt-4 text-lg text-neutral-700">
        Find the best vinyl record deals from Amazon (US).  
        New deals will appear automatically once the feed is active.
      </p>

      <section className="mt-10">
        <h2 className="text-2xl font-bold">Browse Vinyl Deals</h2>

        <p className="mt-2 text-neutral-600">
          Explore vinyl record deals by genre.
        </p>

        <Link
          href="/vinyl"
          className="inline-block mt-4 underline text-lg"
        >
          View All Vinyl Deals →
        </Link>
      </section>
    </main>
  );
}
