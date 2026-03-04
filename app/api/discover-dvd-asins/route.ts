import axios from "axios";
import aws4 from "aws4";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ITEM_COUNT = 10;
const MAX_ITEMPAGE = 10; // PA-API max ItemPage is 10

function toCents(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? Math.round(x * 100) : null;
}

function uniqClean(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => (s || "").trim()).filter(Boolean)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractAxiosError(e: any) {
  const status = e?.response?.status ?? null;
  const data = e?.response?.data ?? null;
  const message = data?.Errors?.[0]?.Message ?? data?.message ?? e?.message ?? "Unknown error";
  const code = data?.Errors?.[0]?.Code ?? null;
  return { status, code, message };
}

function pickBuyBoxListingOnly(item: any) {
  const listings: any[] = item?.Offers?.Listings ?? [];
  if (!listings.length) return null;

  const buyBox = listings.find((l) => l?.IsBuyBoxWinner);
  if (!buyBox) return null;

  const priceCents = toCents(buyBox?.Price?.Amount);
  if (!priceCents) return null;

  return buyBox;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4) {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;
      const code = e?.response?.data?.Errors?.[0]?.Code;
      if (status === 429 || code === "TooManyRequests") {
        await sleep(600 * Math.pow(2, i));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function paapiSearch({
  keyword,
  itemPage,
}: {
  keyword: string;
  itemPage: number;
}) {
  const host = process.env.AMAZON_HOST!;
  const region = process.env.AMAZON_REGION!;
  const accessKey = process.env.AMAZON_ACCESS_KEY!;
  const secretKey = process.env.AMAZON_SECRET_KEY!;
  const partnerTag = process.env.AMAZON_PARTNER_TAG!;

  const body = {
    Keywords: keyword,
    SearchIndex: "MoviesAndTV",
    ItemCount: ITEM_COUNT,
    ItemPage: itemPage,
    Condition: "New",
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Resources: [
      "ItemInfo.Title",
      "Images.Primary.Large",
      "Offers.Listings.Price",
      "Offers.Listings.IsBuyBoxWinner",
      "Offers.Listings.MerchantInfo",
    ],
  };

  const signed = aws4.sign(
    {
      host,
      method: "POST",
      path: "/paapi5/searchitems",
      service: "ProductAdvertisingAPI",
      region,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-encoding": "amz-1.0",
        "x-amz-target": "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
      },
      body: JSON.stringify(body),
    },
    { accessKeyId: accessKey, secretAccessKey: secretKey }
  );

  const resp = await axios.post(`https://${host}/paapi5/searchitems`, signed.body, {
    headers: signed.headers as any,
    timeout: 15000,
  });

  return resp.data?.SearchResult?.Items || [];
}

async function upsertTrackedAsins(rows: any[]) {
  if (!rows.length) return;

  const supabase = getSupabaseAdmin();
  const CHUNK = 500;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    let { error } = await supabase.from("tracked_asins").upsert(chunk, {
      onConflict: "asin,media_type",
    });

    // Some environments only have a primary key on asin.
    if (error && /on conflict|constraint|unique/i.test(String(error.message ?? ""))) {
      const fallback = await supabase.from("tracked_asins").upsert(chunk, {
        onConflict: "asin",
      });
      error = fallback.error;
    }

    if (error) throw new Error(error.message);
  }
}

function makeMovieKeywords(title: string, suffixes: string[]): string[] {
  const clean = String(title).replace(/"/g, "").trim();
  if (!clean) return [];
  return suffixes.map((s) => `"${clean}" ${s}`.trim());
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = searchParams.get("token") ?? "";
  if (!process.env.REFRESH_TOKEN || token !== process.env.REFRESH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const maxPagesRaw = Number(searchParams.get("maxPages") ?? "2");
  const maxPages = Math.min(Math.max(maxPagesRaw, 1), 2); // force discovery to 1–2 pages
  const delayMs = Math.min(Math.max(Number(searchParams.get("delayMs") ?? "1200"), 0), 5000);
  const moviesPerRun = Math.min(Math.max(Number(searchParams.get("moviesPerRun") ?? "120"), 0), 500);

  const mediaType = "dvd";
  const suffixesParam = (searchParams.get("suffixes") ?? "").trim();

  // Safer defaults per media type
  const defaultSuffixesByType: Record<string, string[]> = {
    "4k-uhd": ["4k uhd", "ultra hd blu-ray", "4k steelbook"],
    "blu-ray": ["blu-ray", "blu-ray steelbook"],
    "dvd": ["dvd"],
  };

  const suffixes =
    suffixesParam.length
      ? uniqClean(suffixesParam.split(",").map((s) => s.trim()))
      : defaultSuffixesByType[mediaType] ?? [];

  if (!suffixes.length) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid media_type or missing suffixes", media_type: mediaType }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const hourSeed = Math.floor(Date.now() / 3600000);
  const now = new Date().toISOString();

  const moviesAll = uniqClean(await readArtistFile("data/movies_master.txt"));
  const batch = rotateSlice(moviesAll, moviesPerRun, hourSeed);

  // For each movie, generate 1–3 keywords depending on suffixes
  const keywords = batch.flatMap((t) => makeMovieKeywords(t, suffixes));
  const seenAsins = new Set<string>();
  const toUpsert: any[] = [];
  const errors: any[] = [];

  let itemsReturned = 0;
  let asinsDiscovered = 0;

  for (const kw of keywords) {
    const pagesForThisKeyword = Math.min(Math.max(maxPages, 1), MAX_ITEMPAGE);

    for (let page = 1; page <= pagesForThisKeyword; page++) {
      let items: any[] = [];
      try {
        items = await withRetry(() => paapiSearch({ keyword: kw, itemPage: page }));
      } catch (e: any) {
        errors.push({ keyword: kw, page, error: extractAxiosError(e) });
        break;
      }

      itemsReturned += items.length;
      if (!items.length) break;

      for (const item of items) {
        const asin = item?.ASIN;
        if (!asin || seenAsins.has(`${mediaType}:${asin}`)) continue;

        const listing = pickBuyBoxListingOnly(item);
        if (!listing) continue;

        const priceCents = toCents(listing?.Price?.Amount);
        if (!priceCents) continue;

        const title = item?.ItemInfo?.Title?.DisplayValue ?? asin;
        const imageUrl = item?.Images?.Primary?.Large?.URL ?? null;

        toUpsert.push({
          asin,
          media_type: mediaType,
          title,
          artist: null,
          image_url: imageUrl,
          amazon_url: `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_PARTNER_TAG}`,
          last_seen_at: now,
          is_active: true,
        });

        seenAsins.add(`${mediaType}:${asin}`);
        asinsDiscovered += 1;
      }

      if (delayMs > 0) await sleep(delayMs);
    }
  }

  await upsertTrackedAsins(toUpsert);

  return Response.json({
    ok: true,
    kind: "discover_movie_asins",
    media_type: mediaType,
    now,
    movies_total: moviesAll.length,
    movies_batch: batch.length,
    keywords: keywords.length,
    maxPages,
    delayMs,
    itemsReturned,
    asinsDiscovered,
    upserted: toUpsert.length,
    suffixes,
    errors,
  });
}
