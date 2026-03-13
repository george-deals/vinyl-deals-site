import { refreshMedia } from "@/lib/refreshMedia";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";

export const runtime = "nodejs";

const CORE_KEYWORDS = [
  "vinyl",
  "vinyl record",
  "vinyl records",
  "lp",
  "lp vinyl",
  "record",
  "records",
  "reissue vinyl",
  "remastered vinyl",
  "vinyl reissue",
  "standard edition vinyl",
  "vinyl 1lp",
  "colored vinyl",
  "limited edition vinyl",
];

function uniqClean(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => (s || "").trim()).filter(Boolean)));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const hotPerRun = Math.min(Math.max(Number(searchParams.get("hotPerRun") ?? "20"), 0), 60);
  const catalogPerRun = Math.min(Math.max(Number(searchParams.get("catalogPerRun") ?? "25"), 0), 100);
  const catalogOffsetRaw = searchParams.get("catalogOffset");

  const hotArtistsAll = await readArtistFile("data/hot-artists.txt");
  const catalogArtistsAll = await readArtistFile("data/catalog-artists.txt");

  // Always include popular artists so vinyl discovery stays anchored to high-intent terms.
  const hotArtists = hotArtistsAll.slice(0, hotPerRun);

  let catalogBatch: string[] = [];
  if (catalogOffsetRaw != null) {
    const catalogOffset = Number(catalogOffsetRaw ?? "0");
    const start = Math.max(0, catalogOffset);
    catalogBatch = catalogArtistsAll.slice(start, start + catalogPerRun);
  } else {
    const hourSeed = Math.floor(Date.now() / 3600000);
    catalogBatch = rotateSlice(catalogArtistsAll, catalogPerRun, hourSeed);
  }

  const artistKeywords = [...hotArtists, ...catalogBatch].map((a) => `"${String(a).replace(/"/g, "").trim()}" vinyl`);
  const maxKeywords = 80;
  const keywords = uniqClean([...CORE_KEYWORDS, ...artistKeywords]).slice(0, maxKeywords);

  return refreshMedia(req, {
    media_type: "vinyl",
    searchIndex: "Music",
    keywords,
    feed_key: "discount-15",
    mode: "discount",
    min_discount: 15,
  });
}
