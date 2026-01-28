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

  // Large keyword pool is OK; refreshMedia will chunk execution via maxKeywords/keywordOffset + time budget.
  const hotPerRun = Number(searchParams.get("hotPerRun") ?? "50");

  // Catalog selection: if catalogOffset is provided, use deterministic paging; otherwise rotate by hour.
  const catalogPerRun = Number(searchParams.get("catalogPerRun") ?? "100");
  const catalogOffsetRaw = searchParams.get("catalogOffset");

  const hotArtistsAll = await readArtistFile("data/hot-artists.txt");
  const catalogArtistsAll = await readArtistFile("data/catalog-artists.txt");

  const hotArtists = hotArtistsAll.slice(0, Math.max(0, hotPerRun));

  let catalogBatch: string[] = [];
  if (catalogOffsetRaw != null) {
    const catalogOffset = Number(catalogOffsetRaw ?? "0");
    const start = Math.max(0, catalogOffset);
    const size = Math.max(0, catalogPerRun);
    catalogBatch = catalogArtistsAll.slice(start, start + size);
  } else {
    const hourSeed = Math.floor(Date.now() / 3600000);
    catalogBatch = rotateSlice(catalogArtistsAll, Math.max(0, catalogPerRun), hourSeed);
  }

  const artistKeywords = [...hotArtists, ...catalogBatch].map((a) => `"${a}" vinyl`);
  const keywords = uniqClean([...CORE_KEYWORDS, ...artistKeywords]);

  return refreshMedia(req, {
    media_type: "vinyl",
    searchIndex: "Music",
    keywords,
    feed_key: "discount-15",
    mode: "discount",
    min_discount: 15,
  });
}
