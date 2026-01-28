import axios from "axios";
import aws4 from "aws4";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * Optional (supported on many Next/Vercel setups):
 * Keep low while stabilizing to encourage short work units.
 */
export const maxDuration = 10;

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

async function paapiSearch({ keyword, itemPage }: { keyword: string; itemPage: number }) {
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
  if (!rows.length) return { upserted: 0 };

  const supabase = getSupabaseAdmin();
  const CHUNK = 250; // smaller chunks reduce chance of large payload issues

  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("tracked_asins").upsert(chunk, {
      onConflict: "asin,media_type",
    });
    if (error) throw new Error(error.message);
    total += chunk.length;
  }

  return { upserted: total };
}

function createTimeBudget(hardMs: number, safetyMs: number) {
  const started = Date.now();
  return {
    elapsedMs: () => Date.now() - started,
    remainingMs: () => hardMs - (Date.now() - started),
    shouldStop: () => Date.now() - started >= hardMs - safetyMs,
    snapshot: () => ({
      hardMs,
      safetyMs,
      elapsedMs: Date.now() - started,
      remainingMs: hardMs - (Date.now() - started),
    }),
  };
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(Math.floor(x), min), max);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = searchParams.get("token") ?? "";
  if (!process.env.REFRESH_TOKEN || token !== process.env.REFRESH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  /**
   * SAFE DEFAULTS (stability-first)
   * - tiny work units so Actions can loop-call this endpoint
   */
  const maxPages = clampInt(searchParams.get("maxPages"), 1, 2, 1); // 1 by default
  const delayMs = clampInt(searchParams.get("delayMs"), 0, 500, 0); // default 0 (no artificial delay)
  const catalogPerRun = clampInt(searchParams.get("catalogPerRun"), 1, 25, 3); // default 3
  const flushEvery = clampInt(searchParams.get("flushEvery"), 25, 300, 75); // upsert periodically

  /**
   * Time budget (stop early before serverless timeout)
   * You can tune via query params, but keep caps conservative.
   */
  const hardMs = clampInt(searchParams.get("hardMs"), 3000, 20000, 9000);
  const safetyMs = clampInt(searchParams.get("safetyMs"), 500, 5000, 1500);
  const budget = createTimeBudget(hardMs, safetyMs);

  // Rotate hourly so you eventually cover the whole catalog
  const hourSeed = Math.floor(Date.now() / 3600000);
  const now = new Date().toISOString();

  const catalogArtistsAll = uniqClean(await readArtistFile("data/catalog-artists.txt"));
  const batch = rotateSlice(catalogArtistsAll, catalogPerRun, hourSeed);
  const keywords = batch.map((a) => `"${String(a).replace(/"/g, "").trim()}" vinyl`);

  const seenAsins = new Set<string>();
  const toUpsert: any[] = [];
  const errors: any[] = [];

  let itemsReturned = 0;
  let asinsDiscovered = 0;
  let upsertedTotal = 0;

  const log = (obj: any) => console.log(JSON.stringify(obj));

  log({
    kind: "discover_vinyl_asins_start",
    now,
    maxPages,
    delayMs,
    catalogPerRun,
    flushEvery,
    budget: budget.snapshot(),
    catalog_total: catalogArtistsAll.length,
    catalog_batch: batch.length,
    keywords: keywords.length,
  });

  let stoppedEarly = false;
  let stopReason: string | null = null;
  let keywordIndex = 0;
  let pageIndex = 0;

  try {
    for (keywordIndex = 0; keywordIndex < keywords.length; keywordIndex++) {
      const kw = keywords[keywordIndex];

      if (budget.shouldStop()) {
        stoppedEarly = true;
        stopReason = "time_budget_before_keyword";
        log({ kind: "discover_vinyl_asins_stop", stopReason, keywordIndex, budget: budget.snapshot() });
        break;
      }

      const pagesForThisKeyword = Math.min(Math.max(maxPages, 1), MAX_ITEMPAGE);

      for (pageIndex = 1; pageIndex <= pagesForThisKeyword; pageIndex++) {
        if (budget.shouldStop()) {
          stoppedEarly = true;
          stopReason = "time_budget_before_page";
          log({
            kind: "discover_vinyl_asins_stop",
            stopReason,
            keywordIndex,
            pageIndex,
            budget: budget.snapshot(),
          });
          break;
        }

        let items: any[] = [];
        try {
          items = await withRetry(() => paapiSearch({ keyword: kw, itemPage: pageIndex }));
        } catch (e: any) {
          errors.push({ keyword: kw, page: pageIndex, error: extractAxiosError(e) });
          log({
            kind: "discover_vinyl_asins_paapi_error",
            keyword: kw,
            page: pageIndex,
            error: extractAxiosError(e),
            budget: budget.snapshot(),
          });
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
            media_type: "vinyl",
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

        // Flush periodically so we don't accumulate a huge payload + so progress is saved even if we exit early
        if (toUpsert.length >= flushEvery) {
          if (budget.shouldStop()) {
            stoppedEarly = true;
            stopReason = "time_budget_before_flush";
            log({
              kind: "discover_vinyl_asins_stop",
              stopReason,
              keywordIndex,
              pageIndex,
              queued: toUpsert.length,
              budget: budget.snapshot(),
            });
            break;
          }

          const { upserted } = await upsertTrackedAsins(toUpsert);
          upsertedTotal += upserted;
          toUpsert.length = 0;

          log({
            kind: "discover_vinyl_asins_flush",
            upserted,
            upsertedTotal,
            itemsReturned,
            asinsDiscovered,
            budget: budget.snapshot(),
          });
        }

        if (delayMs > 0) await sleep(delayMs);

        if (budget.shouldStop()) {
          stoppedEarly = true;
          stopReason = "time_budget_after_page";
          log({
            kind: "discover_vinyl_asins_stop",
            stopReason,
            keywordIndex,
            pageIndex,
            budget: budget.snapshot(),
          });
          break;
        }
      }

      if (stoppedEarly) break;
    }

    // Final flush
    if (toUpsert.length) {
      if (!budget.shouldStop()) {
        const { upserted } = await upsertTrackedAsins(toUpsert);
        upsertedTotal += upserted;
        toUpsert.length = 0;
      } else {
        stoppedEarly = true;
        stopReason = stopReason ?? "time_budget_before_final_flush";
      }
    }
  } catch (e: any) {
    // Never crash the whole run without returning useful debug info
    log({
      kind: "discover_vinyl_asins_fatal",
      message: e?.message ?? "Unknown fatal error",
      budget: budget.snapshot(),
    });
    return Response.json(
      {
        ok: false,
        kind: "discover_vinyl_asins",
        now,
        maxPages,
        delayMs,
        catalogPerRun,
        flushEvery,
        itemsReturned,
        asinsDiscovered,
        upsertedTotal,
        stoppedEarly,
        stopReason,
        errors,
        fatal: { message: e?.message ?? "Unknown fatal error" },
        budget: budget.snapshot(),
      },
      { status: 200 } // keep Actions from marking entire job as failed on one run
    );
  }

  log({
    kind: "discover_vinyl_asins_done",
    now,
    itemsReturned,
    asinsDiscovered,
    upsertedTotal,
    stoppedEarly,
    stopReason,
    errorsCount: errors.length,
    budget: budget.snapshot(),
  });

  return Response.json({
    ok: true,
    kind: "discover_vinyl_asins",
    now,
    catalog_total: catalogArtistsAll.length,
    catalog_batch: batch.length,
    keywords: keywords.length,
    maxPages,
    delayMs,
    catalogPerRun,
    flushEvery,
    itemsReturned,
    asinsDiscovered,
    upsertedTotal,
    stoppedEarly,
    stopReason,
    keywordIndexStoppedAt: stoppedEarly ? keywordIndex : null,
    pageIndexStoppedAt: stoppedEarly ? pageIndex : null,
    errors,
    budget: budget.snapshot(),
  });
}
