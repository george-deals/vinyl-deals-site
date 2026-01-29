import { refreshMedia } from "@/lib/refreshMedia";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";

export const runtime = "nodejs";

const CORE_KEYWORDS = [
  "blu ray",
  "blu-ray",
  "blu ray steelbook",
  "criterion blu ray",
  "blu ray box set",
  "remastered blu ray",
];

function uniqClean(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => (s || "").trim()).filter(Boolean)));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // ✅ safer defaults (old was 200)
  const moviesPerRun = Number(searchParams.get("moviesPerRun") ?? "25");
  const moviesOffsetRaw = searchParams.get("moviesOffset");

  // ✅ hard cap so a bad param can't nuke the run
  const PER_RUN = Math.min(Math.max(moviesPerRun || 0, 0), 75);

  const moviesAll = await readArtistFile("data/movies_master.txt");

  let movieBatch: string[] = [];
  if (moviesOffsetRaw != null) {
    const moviesOffset = Number(moviesOffsetRaw ?? "0");
    const start = Math.max(0, moviesOffset);
    movieBatch = moviesAll.slice(start, start + PER_RUN);
  } else {
    const hourSeed = Math.floor(Date.now() / 3600000);
    movieBatch = rotateSlice(moviesAll, PER_RUN, hourSeed);
  }

  const movieKeywords = movieBatch.map(
    (t) => `"${String(t).replace(/"/g, "").trim()}" blu-ray`
  );

  // ✅ cap total keyword count so refreshMedia doesn't run forever
  const MAX_KEYWORDS = 80;
  const keywords = uniqClean([...CORE_KEYWORDS, ...movieKeywords]).slice(0, MAX_KEYWORDS);

  return refreshMedia(req, {
    media_type: "blu-ray",
    searchIndex: "MoviesAndTV",
    keywords,
    feed_key: "discount-15",
    mode: "discount",
    min_discount: 15,
  });
}
