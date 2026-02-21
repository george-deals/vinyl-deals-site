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

  const moviesPerRun = Number(searchParams.get("moviesPerRun") ?? "25");
  const moviesOffsetRaw = searchParams.get("moviesOffset");
  const perRun = Math.min(Math.max(moviesPerRun || 0, 0), 75);

  const moviesAll = await readArtistFile("data/movies_master.txt");

  let movieBatch: string[] = [];
  if (moviesOffsetRaw != null) {
    const moviesOffset = Number(moviesOffsetRaw ?? "0");
    const start = Math.max(0, moviesOffset);
    movieBatch = moviesAll.slice(start, start + perRun);
  } else {
    const hourSeed = Math.floor(Date.now() / 3600000);
    movieBatch = rotateSlice(moviesAll, perRun, hourSeed);
  }

  const movieKeywords = movieBatch.map((t) => `"${String(t).replace(/"/g, "").trim()}" dvd`);
  const maxKeywords = 80;
  const keywords = uniqClean([...CORE_KEYWORDS, ...movieKeywords]).slice(0, maxKeywords);

  return refreshMedia(req, {
    media_type: "dvd",
    searchIndex: "MoviesAndTV",
    keywords,
    feed_key: "discount-15",
    mode: "discount",
    min_discount: 15,
  });
}
