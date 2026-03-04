import axios from "axios";
import aws4 from "aws4";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ITEM_COUNT = 10;
const MAX_ITEMPAGE = 10; // PA-API max ItemPage is 10
const PAAPI_MIN_INTERVAL_MS = 1100;
const REQUEST_BUDGET_MS_DEFAULT = 120000;
const REQUEST_BUDGET_MS_MAX = 240000;

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

let _paapiLastAt = 0;
let _paapiChain: Promise<void> = Promise.resolve();

async function paapiGate() {
  _paapiChain = _paapiChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, _paapiLastAt + PAAPI_MIN_INTERVAL_MS - now);
    if (wait > 0) await sleep(wait);
    _paapiLastAt = Date.now();
  });
  await _paapiChain;
}

function extractAxiosError(e: any) {
  const status = e?.response?.status ?? null;
  const data = e?.response?.data ?? null;
  const message = data?.Errors?.[0]?.Message ?? data?.message ?? e?.message ?? "Unknown error";
  const code = data?.Errors?.[0]?.Code ?? null;
  return { status, code, message };
}

function extractArtist(item: any): string | null {
  const by = item?.ItemInfo?.ByLineInfo;

  const contributors = by?.Contributors;
  if (Array.isArray(contributors) && contributors.length) {
    const primary =
      contributors.find((c: any) => c?.RoleType === "Primary") ??
      contributors.find((c: any) => String(c?.Role || "").toLowerCase().includes("artist")) ??
      contributors[0];

    const name = primary?.Name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }

  const brand = by?.Brand?.DisplayValue;
  if (typeof brand === "string" && brand.trim()) return brand.trim();

  const manu = by?.Manufacturer?.DisplayValue;
  if (typeof manu === "string" && manu.trim()) return manu.trim();

  return null;
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
      await paapiGate();
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;
      const code = e?.response?.data?.Errors?.[0]?.Code;
      const is429 = status === 429 || code === "TooManyRequests";
      const isTransient =
        is429 ||
        status === 408 ||
        status === 425 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;
      if (!isTransient || i === attempts - 1) break;
      await sleep((is429 ? 1200 : 600) * Math.pow(2, i));
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
    SearchIndex: "Music",
    ItemCount: ITEM_COUNT,
    ItemPage: itemPage,
    Condition: "New",
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Resources: [
      "ItemInfo.Title",
      "ItemInfo.ByLineInfo",
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
    const { error } = await supabase.from("tracked_asins").upsert(chunk, {
      onConflict: "asin",
    });
    if (error) throw new Error(error.message);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = searchParams.get("token") ?? "";
  if (!process.env.REFRESH_TOKEN || token !== process.env.REFRESH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const maxPagesRaw = Number(searchParams.get("maxPages") ?? "2");
  const maxPages = Math.min(Math.max(maxPagesRaw, 1), 2);
  const delayMs = Math.min(Math.max(Number(searchParams.get("delayMs") ?? "1200"), 0), 5000);
  const catalogPerRun = Math.min(Math.max(Number(searchParams.get("catalogPerRun") ?? "150"), 0), 500);
  const requestBudgetMs = Math.min(
    Math.max(Number(searchParams.get("requestBudgetMs") ?? String(REQUEST_BUDGET_MS_DEFAULT)), 15000),
    REQUEST_BUDGET_MS_MAX
  );

  const hourSeed = Math.floor(Date.now() / 3600000);
  const now = new Date().toISOString();
  const startedAtMs = Date.now();
  const requestElapsedMs = () => Date.now() - startedAtMs;
  const budgetExceeded = () => requestElapsedMs() >= requestBudgetMs;
  let stoppedEarlyReason: string | null = null;

  const catalogArtistsAll = uniqClean(await readArtistFile("data/catalog-artists.txt"));
  const batch = rotateSlice(catalogArtistsAll, catalogPerRun, hourSeed);

  // CD keywords (same artists list as vinyl, but with "cd")
  const keywords = batch.map((a) => `"${String(a).replace(/"/g, "").trim()}" cd`);

  const seenAsins = new Set<string>();
  const toUpsert: any[] = [];
  const errors: any[] = [];

  let itemsReturned = 0;
  let asinsDiscovered = 0;

  keywordLoop: for (const kw of keywords) {
    if (budgetExceeded()) {
      stoppedEarlyReason = "request_budget_exceeded_before_keyword";
      break keywordLoop;
    }

    const pagesForThisKeyword = Math.min(Math.max(maxPages, 1), MAX_ITEMPAGE);

    for (let page = 1; page <= pagesForThisKeyword; page++) {
      if (budgetExceeded()) {
        stoppedEarlyReason = "request_budget_exceeded_during_pages";
        break keywordLoop;
      }

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
        if (!asin || seenAsins.has(asin)) continue;

        const listing = pickBuyBoxListingOnly(item);
        if (!listing) continue;

        const priceCents = toCents(listing?.Price?.Amount);
        if (!priceCents) continue;

        const title = item?.ItemInfo?.Title?.DisplayValue ?? asin;
        const artist = extractArtist(item);
        const imageUrl = item?.Images?.Primary?.Large?.URL ?? null;

        toUpsert.push({
          asin,
          media_type: "cd",
          title,
          artist,
          image_url: imageUrl,
          amazon_url: `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_PARTNER_TAG}`,
          last_seen_at: now,
          is_active: true,
        });

        seenAsins.add(asin);
        asinsDiscovered += 1;
      }

      if (delayMs > 0) await sleep(delayMs);

      if (budgetExceeded()) {
        stoppedEarlyReason = "request_budget_exceeded_after_page";
        break keywordLoop;
      }
    }
  }

  await upsertTrackedAsins(toUpsert);

  return Response.json({
    ok: true,
    kind: "discover_cd_asins",
    now,
    catalog_total: catalogArtistsAll.length,
    catalog_batch: batch.length,
    keywords: keywords.length,
    maxPages,
    delayMs,
    request_budget_ms: requestBudgetMs,
    request_elapsed_ms: requestElapsedMs(),
    stopped_early_reason: stoppedEarlyReason,
    itemsReturned,
    asinsDiscovered,
    upserted: toUpsert.length,
    errors,
  });
}
