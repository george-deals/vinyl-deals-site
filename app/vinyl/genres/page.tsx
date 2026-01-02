import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vinyl Deals by Genre | Vinyl Deals",
  description:
    "Browse Amazon (US) vinyl record deals by genre: rock, hip-hop, jazz, soundtracks, pop, metal, country, classical, electronic, and R&B/soul.",
};


import Link from "next/link";

export default function VinylHubPage() {
  const genres = [
    ["rock", "Rock"],
    ["hip-hop", "Hip-Hop"],
    ["jazz", "Jazz"],
    ["soundtracks", "Soundtracks"],
    ["pop", "Pop"],
    ["metal", "Metal"],
    ["country", "Country"],
    ["classical", "Classical"],
    ["electronic", "Electronic"],
    ["rnb-soul", "R&B / Soul"],
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">Vinyl Deals by Genre</h1>
      <p className="mt-3 text-neutral-600">
        Browse vinyl record deals by genre. Amazon deal data will appear once the API feed is re-enabled.
      </p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {genres.map(([slug, label]) => (
          <li key={slug} className="rounded border p-4">
            <Link href={`/vinyl/${slug}`} className="text-lg underline">
              {label} Vinyl Deals
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
