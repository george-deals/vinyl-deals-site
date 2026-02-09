import axios from "axios";
import aws4 from "aws4";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const BUILD_ID = "simple-15pct-2026-01-10-feedkey-fix";

const DEFAULT_MIN_DISCOUNT = 15;
const ITEM_COUNT = 10;
const MAX_ITEMPAGE = 10;
const MAX_PAGES_HARD_CAP = 30;
const STALE_PURGE_DAYS = 3;

const PAAPI_MIN_INTERVAL_MS = 1200;
const PAAPI_429_BASE_BACKOFF_MS = 6000;
const PAAPI_429_MAX_BACKOFF_MS = 60000;
const PAAPI_TRANSIENT_BASE_BACKOFF_MS = 1000;
const PAAPI_TRANSIENT_MAX_BACKOFF_MS = 15000;

type RefreshMode = "discount" | "under-price";

type MediaConfig = {
  media_type: "vinyl" | "cd" | "4k-uhd" | "blu-ray" | "dvd";
  searchIndex: "Music" | "MoviesAndTV";
  keywords: string[];
  feed_key?: string;
  mode?: RefreshMode;
  min_discount?: number;
  max_price_cents?: number;
};

type DealRow = {
  asin: string;
  title: string;
  artist: string | null;
  image_url: string | null;
  amazon_url: string;
  price_cents: number;
  list_price_cents: number | null;
  currency: string | null;
  discount_pct: number | null;
  category: string;
  media_type: string;
  feed_key: string;
  sales_rank: number | null;
  genre: string | null;
  browse_node_id: number | null;
  updated_at: string;
  last_seen_at: string;
  sync_id: string;
};

function toCents(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? Math.round(x * 100) : null;
}

function computeDiscountPct(priceCents: number, listCents: number | null): number | null {
  if (!listCents || listCents <= priceCents) return null;
  return Math.round(((listCents - priceCents) / listCents) * 1000) / 10;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number) {
  return Math.floor(ms * (0.85 + Math.random() * 0.3));
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

async function withRetry<T>(fn: () => Promise<T>, attempts = 6) {
  let lastErr: any = null;

  for (let i = 0; i < attempts; i++) {
    try {
      await paapiGate();
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status ?? null;
      const code = e?.response?.data?.Errors?.[0]?.Code ?? null;

      const is429 = status === 429 || code === "TooManyRequests";
      const isTransient =
        is429 ||
        status === 408 ||
        status === 425 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        code === "RequestTimeout" ||
        code === "ServiceUnavailable" ||
        code === "InternalServerError";

      if (!isTransient) throw e;
      if (i === attempts - 1) break;

      if (is429) {
        const backoff = Math.min(PAAPI_429_BASE_BACKOFF_MS * Math.pow(2, i), PAAPI_429_MAX_BACKOFF_MS);
        await sleep(jitter(backoff));
        continue;
      }

      const backoff = Math.min(
        PAAPI_TRANSIENT_BASE_BACKOFF_MS * Math.pow(2, i),
        PAAPI_TRANSIENT_MAX_BACKOFF_MS
      );
      await sleep(jitter(backoff));
    }
  }

  throw lastErr;
}

async function paapiSearch({
  keyword,
  itemPage,
  searchIndex,
}: {
  keyword: string;
  itemPage: number;
  searchIndex: string;
}) {
  const host = process.env.AMAZON_HOST!;
  const region = process.env.AMAZON_REGION!;
  const accessKey = process.env.AMAZON_ACCESS_KEY!;
  const secretKey = process.env.AMAZON_SECRET_KEY!;
  const partnerTag = process.env.AMAZON_PARTNER_TAG!;

  const body = {
    Keywords: keyword,
    SearchIndex: searchIndex,
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
      "Offers.Listings.SavingBasis",
      "Offers.Listings.IsBuyBoxWinner",
      "Offers.Listings.MerchantInfo",
      "BrowseNodeInfo.WebsiteSalesRank",
      "BrowseNodeInfo.BrowseNodes",
      "BrowseNodeInfo.BrowseNodes.Ancestor",
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

function pickBuyBoxListingOnly(item: any) {
  const listings: any[] = item?.Offers?.Listings ?? [];
  if (!listings.length) return null;

  const buyBox = listings.find((l) => l?.IsBuyBoxWinner);
  if (!buyBox) return null;

  const priceCents = toCents(buyBox?.Price?.Amount);
  if (!priceCents) return null;

  return buyBox;
}

async function upsertChunked(rows: DealRow[]) {
  const supabase = getSupabaseAdmin();
  const CHUNK = 500;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    const { error } = await supabase.from("deals").upsert(chunk, {
      onConflict: "media_type,feed_key,asin",
    });

    if (error) throw new Error(error.message);
  }
}

function getPrimaryBrowseNodeId(item: any): number | null {
  const ws = item?.BrowseNodeInfo?.WebsiteSalesRank;
  const wsId = Number(ws?.BrowseNodeId);
  if (Number.isFinite(wsId) && wsId > 0) return wsId;

  const nodes = item?.BrowseNodeInfo?.BrowseNodes;
  if (Array.isArray(nodes) && nodes.length) {
    const id = Number(nodes[0]?.Id);
    if (Number.isFinite(id) && id > 0) return id;
  }

  return null;
}

export async function refreshMedia(req: Request, config: MediaConfig) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token || token !== process.env.REFRESH_TOKEN) {
    return Response.json({ ok: false, error: "Unauthorized", build_id: BUILD_ID }, { status: 401 });
  }

  const feedKey = (config.feed_key ?? "discount-15").trim() || "discount-15";
  const mode: RefreshMode = config.mode ?? "discount";

  const minDiscount =
    typeof config.min_discount === "number" && Number.isFinite(config.min_discount)
      ? config.min_discount
      : DEFAULT_MIN_DISCOUNT;

  const maxPriceCents =
    typeof config.max_price_cents === "number" && Number.isFinite(config.max_price_cents)
      ? config.max_price_cents
      : null;

  const maxPages = Math.min(
    Math.max(Number(url.searchParams.get("maxPages") ?? "10"), 1),
    MAX_PAGES_HARD_CAP
  );

  const delayMs = Math.min(Math.max(Number(url.searchParams.get("delayMs") ?? "800"), 0), 5000);

  const now = new Date().toISOString();
  const syncId = randomUUID();

  const seen = new Set<string>();
  const keep: DealRow[] = [];
  const errors: any[] = [];

  const stats: any = {
    build_id: BUILD_ID,
    sync_id: syncId,
    media_type: config.media_type,
    feed_key: feedKey,
    mode,
    min_discount: minDiscount,
    max_price_cents: maxPriceCents,
    maxPages,
    delayMs,
    keywords: config.keywords.length,
    items_returned: 0,
    items_with_discount_data: 0,
    filtered_under_min_discount: 0,
    filtered_over_max_price: 0,
    kept: 0,
    db_sync_rows_after_upsert: null as number | null,
    db_feedkey_integrity_warning: null as string | null,
  };

  const supabase = getSupabaseAdmin();

  let runId: number | null = null;
  try {
    const { data: run } = await supabase
      .from("refresh_runs")
      .insert({
        media_type: config.media_type,
        feed_key: feedKey,
        build_id: BUILD_ID,
        sync_id: syncId,
        max_pages: maxPages,
        delay_ms: delayMs,
        started_at: now,
        ok: false,
      })
      .select("id")
      .single();

    runId = (run?.id as any) ?? null;
  } catch {
    runId = null;
  }

  try {
    for (const kw of config.keywords) {
      const pagesForThisKeyword = Math.min(Math.max(maxPages, 1), MAX_ITEMPAGE);

      for (let page = 1; page <= pagesForThisKeyword; page++) {
        let items: any[] = [];

        try {
          items = await withRetry(() =>
            paapiSearch({ keyword: kw, itemPage: page, searchIndex: config.searchIndex })
          );
        } catch (e: any) {
          errors.push({ keyword: kw, page, error: extractAxiosError(e) });
          break;
        }

        stats.items_returned += items.length;
        if (!items.length) break;

        for (const item of items) {
          const asin = item?.ASIN;
          if (!asin || seen.has(asin)) continue;

          const listing = pickBuyBoxListingOnly(item);
          if (!listing) continue;

          const priceCents = toCents(listing?.Price?.Amount);
          if (!priceCents) continue;

          if (mode === "under-price" && maxPriceCents != null && priceCents > maxPriceCents) {
            stats.filtered_over_max_price += 1;
            continue;
          }

          const savingsPct = Number(listing?.Price?.Savings?.Percentage);
          const savingsAmt = toCents(listing?.Price?.Savings?.Amount);
          let listCents = toCents(listing?.SavingBasis?.Amount) ?? toCents(listing?.ListPrice?.Amount);
          if (!listCents && savingsAmt && priceCents) listCents = priceCents + savingsAmt;

          let discountPct: number | null = null;
          if (Number.isFinite(savingsPct) && savingsPct > 0) {
            discountPct = Math.round(savingsPct * 10) / 10;
          } else if (savingsAmt && listCents) {
            discountPct = Math.round((savingsAmt / listCents) * 1000) / 10;
          } else {
            discountPct = computeDiscountPct(priceCents, listCents);
          }

          if (discountPct !== null) stats.items_with_discount_data += 1;

          if (mode === "discount") {
            if (discountPct === null) continue;
            if (discountPct < minDiscount) {
              stats.filtered_under_min_discount += 1;
              continue;
            }
          }

          const rank = Number(item?.BrowseNodeInfo?.WebsiteSalesRank?.SalesRank) || null;
          const browseNodeId = getPrimaryBrowseNodeId(item);
          const artist = extractArtist(item);

          keep.push({
            asin,
            title: item?.ItemInfo?.Title?.DisplayValue ?? asin,
            artist,
            image_url: item?.Images?.Primary?.Large?.URL ?? null,
            amazon_url: `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_PARTNER_TAG}`,
            price_cents: priceCents,
            list_price_cents: listCents,
            currency: listing?.Price?.Currency ?? null,
            discount_pct: discountPct,
            category: "media",
            media_type: config.media_type,
            feed_key: feedKey,
            sales_rank: rank,
            genre: null,
            browse_node_id: browseNodeId,
            updated_at: now,
            last_seen_at: now,
            sync_id: syncId,
          });

          seen.add(asin);
          stats.kept += 1;
        }

        if (delayMs > 0) await sleep(delayMs);
      }
    }

    keep.sort((a, b) => (a.sales_rank ?? 1e12) - (b.sales_rank ?? 1e12));

    let saved = 0;
    if (keep.length) {
      await upsertChunked(keep);
      saved = keep.length;
    }

    try {
      const { count } = await supabase
        .from("deals")
        .select("asin", { count: "exact", head: true })
        .eq("media_type", config.media_type)
        .eq("feed_key", feedKey)
        .eq("sync_id", syncId);

      stats.db_sync_rows_after_upsert = typeof count === "number" ? count : null;

      if (typeof count === "number" && saved > 0 && count < Math.max(1, Math.floor(saved * 0.7))) {
        stats.db_feedkey_integrity_warning =
          `WARNING: deals rows for this run are unexpectedly low (saved=${saved}, db_count=${count}). ` +
          `This usually means your deals table unique constraint does NOT include feed_key, so another feed is overwriting rows.`;
      }
    } catch {}

    const cutoff = new Date(Date.now() - STALE_PURGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    if (mode === "discount") {
      const del = await supabase
        .from("deals")
        .delete()
        .eq("media_type", config.media_type)
        .eq("feed_key", feedKey)
        .lt("discount_pct", minDiscount)
        .lt("last_seen_at", cutoff);

      if (del.error) throw new Error(del.error.message);

      const delNull = await supabase
        .from("deals")
        .delete()
        .eq("media_type", config.media_type)
        .eq("feed_key", feedKey)
        .is("discount_pct", null)
        .lt("last_seen_at", cutoff);

      if (delNull.error) throw new Error(delNull.error.message);
    } else {
      const delOld = await supabase
        .from("deals")
        .delete()
        .eq("media_type", config.media_type)
        .eq("feed_key", feedKey)
        .lt("last_seen_at", cutoff);

      if (delOld.error) throw new Error(delOld.error.message);
    }

    if (runId) {
      try {
        await supabase
          .from("refresh_runs")
          .update({
            ok: true,
            finished_at: new Date().toISOString(),
            found: keep.length,
            saved,
            stats,
            errors,
          })
          .eq("id", runId);
      } catch {}
    }

    return Response.json({
      ok: true,
      media_type: config.media_type,
      feed_key: feedKey,
      mode,
      min_discount: minDiscount,
      max_price_cents: maxPriceCents,
      maxPages,
      delayMs,
      found: keep.length,
      saved,
      build_id: BUILD_ID,
      sync_id: syncId,
      stats,
      errors,
    });
  } catch (e: any) {
    if (runId) {
      try {
        await supabase
          .from("refresh_runs")
          .update({
            ok: false,
            finished_at: new Date().toISOString(),
            error: e?.message ?? String(e),
            stats,
            errors,
          })
          .eq("id", runId);
      } catch {}
    }

    return Response.json(
      { ok: false, error: e?.message ?? String(e), build_id: BUILD_ID, sync_id: syncId, stats, errors },
      { status: 500 }
    );
  }
}
