import Link from "next/link";

export default function SoundtracksVinylDealsPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-bold">Soundtrack Vinyl Deals</h1>

        <Link href="/vinyl" className="text-sm underline text-neutral-600">
          ← Back to all vinyl genres
        </Link>
        <p className="mt-3 text-slate-700">
          Deals on new soundtrack vinyl (movies, TV, games) on Amazon (US). Deals populate automatically once the feed is active.
        </p>
      </div>
    </main>
  );
}
