export {};

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const VINYL_GENRES = [
  "all",
  "rock",
  "hip-hop",
  "jazz",
  "soundtracks",
  "pop",
  "metal",
  "country",
  "classical",
  "electronic",
  "rnb-soul",
];

const OTHER_MEDIA = ["cds", "4k-uhd", "blu-ray", "dvd"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!process.env.REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, error: "Missing REFRESH_TOKEN" }, { status: 500 });
  }

  if (!token || token !== process.env.REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const results = [];

  // Vinyl (all + genres)
  for (const genre of VINYL_GENRES) {
    const res = await fetch(
      `${origin}/api/refresh-vinyl?genre=${genre}&token=${token}`,
      { cache: "no-store" }
    );
    results.push({
      task: `vinyl:${genre}`,
      status: res.status,
      ok: res.ok,
    });
  }

  // Other media
  for (const type of OTHER_MEDIA) {
    const res = await fetch(
      `${origin}/api/refresh-${type}?token=${token}`,
      { cache: "no-store" }
    );
    results.push({
      task: type,
      status: res.status,
      ok: res.ok,
    });
  }

  return NextResponse.json(
    {
      ok: results.every(r => r.ok),
      ran_at: new Date().toISOString(),
      results,
    },
    { status: 207 }
  );
}
