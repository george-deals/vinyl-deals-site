import { refreshMedia } from "@/lib/refreshMedia";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";

export const runtime = "nodejs";

const CORE_KEYWORDS = [
  "4k uhd",
  "ultra hd blu ray",
  "4k steelbook",
  "4k collector edition",
  "4k box set",
  "4k limited edition",
  "4k remastered",
];

function uniqClean(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => (s || "").trim()).filter(Boolean)));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // ✅ safer defaults (old was 200)
  const moviesPerRunRaw = Number(searchParams.get("moviesPerRun") ?? "25");
  const moviesOffsetRaw = searchParams.get("moviesOffset");

  // ✅ hard cap so a bad param can't create a huge run
  const PER_RUN = Math.min(Math.max(moviesPerRunRaw || 0, 0), 75);

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
    (t) => `"${String(t).replace(/"/g, "").trim()}" 4k uhd`
  );

  // ✅ cap total keyword count so refreshMedia doesn't run forever
  const MAX_KEYWORDS = 80;
  const keywords = uniqClean([...CORE_KEYWORDS, ...movieKeywords]).slice(0, MAX_KEYWORDS);

  return refreshMedia(req, {
    media_type: "4k-uhd",
    searchIndex: "MoviesAndTV",
    keywords,
    feed_key: "discount-15",
    mode: "discount",
    min_discount: 15,
  });
}
