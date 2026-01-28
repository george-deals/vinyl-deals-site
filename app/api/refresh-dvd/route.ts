import { refreshMedia } from "@/lib/refreshMedia";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";

export const runtime = "nodejs";

const CORE_KEYWORDS = [
  "dvd",
  "movie dvd",
  "dvd box set",
  "complete series dvd",
  "collector edition dvd",
  "remastered dvd"
];

function uniqClean(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => (s || "").trim()).filter(Boolean)));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Movies are sourced from data/movies_master.txt (one title per line)
  const moviesPerRun = Number(searchParams.get("moviesPerRun") ?? "200");
  const moviesOffsetRaw = searchParams.get("moviesOffset");

  const moviesAll = await readArtistFile("data/movies_master.txt");

  let movieBatch: string[] = [];
  if (moviesOffsetRaw != null) {
    const moviesOffset = Number(moviesOffsetRaw ?? "0");
    const start = Math.max(0, moviesOffset);
    const size = Math.max(0, moviesPerRun);
    movieBatch = moviesAll.slice(start, start + size);
  } else {
    const hourSeed = Math.floor(Date.now() / 3600000);
    movieBatch = rotateSlice(moviesAll, Math.max(0, moviesPerRun), hourSeed);
  }

  const movieKeywords = movieBatch.map((t) => `"${String(t).replace(/"/g, "").trim()}" dvd`);
  const keywords = uniqClean([...CORE_KEYWORDS, ...movieKeywords]);

  return refreshMedia(req, {
    media_type: "dvd",
    searchIndex: "MoviesAndTV",
    keywords,
    feed_key: "discount-15",
    mode: "discount",
    min_discount: 15,
  });
}
