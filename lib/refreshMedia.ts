import axios from "axios";
import aws4 from "aws4";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const BUILD_ID = "simple-15pct-2026-01-10-feedkey-fix";

const DEFAULT_MIN_DISCOUNT = 15;
const ITEM_COUNT = 10;
const MAX_ITEMPAGE = 10;
const MAX_PAGES_HARD_CAP = 30;

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

type ActiveDealRow = {
  asin: string;
  title: string | null;
  price_cents: number | null;
  list_price_cents: number | null;
  currency: string | null;
  discount_pct: number | null;
};

type CurrentPricing = {
  priceCents: number | null;
  listCents: number | null;
  currency: string | null;
  discountPct: number | null;
  hadDiscountSignal: boolean;
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

function normalizeText(v: any): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function hasToken(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function extractBinding(item: any): string {
  return normalizeText(item?.ItemInfo?.Classifications?.Binding?.DisplayValue);
}

function titleLooks4k(title: string): boolean {
  return hasToken(title, /\b(4k|uhd|ultra hd)\b/i);
}

function itemMatchesMediaType(
  mediaType: MediaConfig["media_type"],
  item: any,
  fallbackTitle?: string | null
): boolean {
  const binding = extractBinding(item);
  const title = normalizeText(item?.ItemInfo?.Title?.DisplayValue ?? fallbackTitle ?? "");
  const hasSignal = Boolean(binding || title);

  if (mediaType === "4k-uhd") {
    return titleLooks4k(title) || hasToken(binding, /(4k|ultra hd|uhd)/i);
  }

  if (mediaType === "blu-ray") {
    if (titleLooks4k(title) || hasToken(binding, /(4k|ultra hd|uhd)/i)) return false;
    if (hasToken(binding, /(blu[- ]?ray|bluray|bd)/i)) return true;
    if (hasToken(title, /\bblu[- ]?ray\b|\bbluray\b/i)) return true;
    if (hasToken(binding, /dvd|vinyl|\bcd\b|audio\s*cd/i)) return false;
    if (hasToken(title, /\bdvd\b|\bvinyl\b|\blp\b|\bcd\b/i)) return false;
    return !hasSignal;
  }

  if (mediaType === "dvd") {
    if (titleLooks4k(title)) return false;
    if (hasToken(binding, /(4k|ultra hd|uhd|blu[- ]?ray|bluray|bd)/i)) return false;
    if (hasToken(title, /\bblu[- ]?ray\b|\bbluray\b/i)) return false;
    if (hasToken(binding, /dvd/i)) return true;
    if (hasToken(title, /\bdvd\b/i)) return true;
    if (hasToken(binding, /vinyl|\bcd\b|audio\s*cd/i)) return false;
    if (hasToken(title, /\bvinyl\b|\blp\b|\bcd\b/i)) return false;
    return !hasSignal;
  }

  if (mediaType === "vinyl") {
    if (hasToken(binding, /vinyl/i)) return true;
    if (hasToken(binding, /dvd|blu[- ]?ray|bluray|bd|4k|ultra hd|uhd/i)) return false;
    if (hasToken(binding, /(audio\s*cd|\bcd\b)/i)) return false;
    if (hasToken(title, /\b(vinyl|lp)\b/i)) return true;
    if (hasToken(title, /\bdvd\b|\bblu[- ]?ray\b|\bbluray\b|\b4k\b|\buhd\b|\bcd\b/i)) return false;
    return !hasSignal;
  }

  if (mediaType === "cd") {
    if (hasToken(binding, /vinyl/i)) return false;
    if (hasToken(binding, /(audio\s*cd|\bcd\b)/i)) return true;
    if (hasToken(binding, /dvd|blu[- ]?ray|bluray|bd|4k|ultra hd|uhd/i)) return false;
    if (hasToken(title, /\bcd\b/i)) return true;
    if (hasToken(title, /\bvinyl\b|\blp\b|\bdvd\b|\bblu[- ]?ray\b|\bbluray\b|\b4k\b|\buhd\b/i))
      return false;
    return !hasSignal;
  }

  return true;
}

function pickBuyBoxListingOnly(item: any) {
  const listings: any[] = item?.Offers?.Listings ?? [];
  if (!listings.length) return null;

  const buyBox = listings.find((l) => l?.IsBuyBoxWinner);
  const candidate = buyBox ?? listings.find((l) => toCents(l?.Price?.Amount));
  if (!candidate) return null;

  const priceCents = toCents(candidate?.Price?.Amount);
  if (!priceCents) return null;

  return candidate;
}

function extractCurrentPricing(item: any): CurrentPricing {
  const listing = pickBuyBoxListingOnly(item);
  if (!listing) {
    return {
      priceCents: null,
      listCents: null,
      currency: null,
      discountPct: null,
      hadDiscountSignal: false,
    };
  }

  const priceCents = toCents(listing?.Price?.Amount);
  const listFromBasis = toCents(listing?.SavingBasis?.Amount) ?? toCents(listing?.ListPrice?.Amount);
  const savingsPct = Number(listing?.Price?.Savings?.Percentage);
  const savingsAmt = toCents(listing?.Price?.Savings?.Amount);
  const listCents = listFromBasis ?? (priceCents && savingsAmt ? priceCents + savingsAmt : null);

  let discountPct: number | null = null;
  let hadDiscountSignal = false;

  if (Number.isFinite(savingsPct) && savingsPct > 0) {
    discountPct = Math.round(savingsPct * 10) / 10;
    hadDiscountSignal = true;
  } else if (savingsAmt && listCents) {
    discountPct = Math.round((savingsAmt / listCents) * 1000) / 10;
    hadDiscountSignal = true;
  } else if (priceCents && listCents) {
    discountPct = computeDiscountPct(priceCents, listCents);
    hadDiscountSignal = discountPct != null;
  }

  return {
    priceCents,
    listCents,
    currency: listing?.Price?.Currency ?? null,
    discountPct,
    hadDiscountSignal,
  };
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

async function withRetry<T>(fn: () => Promise<T>, attempts = 4) {
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

function getPaapiAuthConfig() {
  return {
    host: process.env.AMAZON_HOST!,
    region: process.env.AMAZON_REGION!,
    accessKey: process.env.AMAZON_ACCESS_KEY!,
    secretKey: process.env.AMAZON_SECRET_KEY!,
    partnerTag: process.env.AMAZON_PARTNER_TAG!,
  };
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
  const { host, region, accessKey, secretKey, partnerTag } = getPaapiAuthConfig();

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
      "ItemInfo.Classifications",
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

async function paapiGetItems(asins: string[]) {
  const { host, region, accessKey, secretKey, partnerTag } = getPaapiAuthConfig();

  const body = {
    ItemIds: asins,
    ItemIdType: "ASIN",
    Condition: "New",
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Resources: [
      "ItemInfo.Title",
      "ItemInfo.Classifications",
      "Offers.Listings.Price",
      "Offers.Listings.SavingBasis",
      "Offers.Listings.IsBuyBoxWinner",
      "Offers.Listings.MerchantInfo",
    ],
  };

  const signed = aws4.sign(
    {
      host,
      method: "POST",
      path: "/paapi5/getitems",
      service: "ProductAdvertisingAPI",
      region,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-encoding": "amz-1.0",
        "x-amz-target": "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems",
      },
      body: JSON.stringify(body),
    },
    { accessKeyId: accessKey, secretAccessKey: secretKey }
  );

  const resp = await axios.post(`https://${host}/paapi5/getitems`, signed.body, {
    headers: signed.headers as any,
    timeout: 15000,
  });

  return resp.data?.ItemsResult?.Items || [];
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

async function updateDealRows(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  rows: Array<Record<string, any>>;
}) {
  const { mediaType, feedKey, rows } = opts;
  if (!rows.length) return { updated: 0, errors: [] as any[] };

  const supabase = getSupabaseAdmin();
  const errors: any[] = [];
  let updated = 0;

  for (const row of rows) {
    const { asin, ...fields } = row;
    if (!asin) continue;

    const { error } = await supabase
      .from("deals")
      .update(fields)
      .eq("media_type", mediaType)
      .eq("feed_key", feedKey)
      .eq("asin", asin);

    if (error) {
      errors.push({ asin, error: error.message });
      continue;
    }

    updated += 1;
  }

  return { updated, errors };
}

async function revalidateActiveDeals(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
}) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("deals")
    .select("asin,title,price_cents,list_price_cents,currency,discount_pct")
    .eq("media_type", opts.mediaType)
    .eq("feed_key", opts.feedKey)
    .gte("discount_pct", opts.minDiscount)
    .order("last_seen_at", { ascending: true })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (error) throw new Error(error.message);

  const byAsin = new Map<string, ActiveDealRow>();
  for (const row of rows ?? []) {
    if (!row?.asin) continue;
    byAsin.set(String(row.asin), {
      asin: String(row.asin),
      title: row.title ?? null,
      price_cents: row.price_cents ?? null,
      list_price_cents: row.list_price_cents ?? null,
      currency: row.currency ?? null,
      discount_pct: row.discount_pct == null ? null : Number(row.discount_pct),
    });
  }

  const asins = Array.from(byAsin.keys());
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += ITEM_COUNT) {
    chunks.push(asins.slice(i, i + ITEM_COUNT));
  }

  const discountedRows: any[] = [];
  const invalidRows: any[] = [];
  const errorsOut: any[] = [];

  for (const chunk of chunks) {
    let items: any[] = [];
    try {
      items = await withRetry(() => paapiGetItems(chunk));
    } catch (e: any) {
      errorsOut.push({ asins: chunk, error: extractAxiosError(e) });
      continue;
    }

    const itemByAsin = new Map<string, any>();
    for (const item of items ?? []) {
      const asin = item?.ASIN;
      if (!asin) continue;
      itemByAsin.set(String(asin), item);
    }

    const hasPartialResponse = (items?.length ?? 0) < chunk.length;
    if (hasPartialResponse) {
      errorsOut.push({ asins: chunk, error: { message: "paapi_partial_response", returned: items.length } });
    }

    for (const asin of chunk) {
      const existing = byAsin.get(asin) ?? {
        asin,
        title: null,
        price_cents: null,
        list_price_cents: null,
        currency: null,
        discount_pct: null,
      };

      const item = itemByAsin.get(asin);
      if (!item) {
        if (hasPartialResponse) {
          errorsOut.push({ asin, error: { message: "paapi_missing_in_partial_response" } });
          continue;
        }

        invalidRows.push({
          asin,
          discount_pct: 0,
          updated_at: now,
        });
        continue;
      }

      if (!itemMatchesMediaType(opts.mediaType, item, existing.title)) {
        const mismatchPricing = extractCurrentPricing(item);
        invalidRows.push({
          asin,
          price_cents: mismatchPricing.priceCents ?? existing.price_cents,
          list_price_cents: mismatchPricing.listCents ?? existing.list_price_cents,
          currency: mismatchPricing.currency ?? existing.currency,
          discount_pct: 0,
          updated_at: now,
        });
        continue;
      }

      const pricing = extractCurrentPricing(item);
      const priceCents = pricing.priceCents ?? existing.price_cents;
      const listCents = pricing.listCents ?? existing.list_price_cents;
      const currency = pricing.currency ?? existing.currency;

      if (priceCents == null) {
        invalidRows.push({
          asin,
          discount_pct: 0,
          updated_at: now,
        });
        continue;
      }

      let discountPct = pricing.discountPct ?? computeDiscountPct(priceCents, listCents);

      if (
        discountPct == null &&
        existing.discount_pct != null &&
        existing.discount_pct >= opts.minDiscount &&
        existing.price_cents != null &&
        priceCents <= existing.price_cents
      ) {
        discountPct = existing.discount_pct;
      }

      if (discountPct != null && discountPct >= opts.minDiscount) {
        discountedRows.push({
          asin,
          price_cents: priceCents,
          list_price_cents: listCents,
          currency,
          discount_pct: discountPct,
          updated_at: now,
          last_seen_at: now,
        });
      } else {
        invalidRows.push({
          asin,
          price_cents: priceCents,
          list_price_cents: listCents,
          currency,
          discount_pct: 0,
          updated_at: now,
        });
      }
    }
  }

  const { updated: updatedDiscounted, errors: discountedErrors } = await updateDealRows({
    mediaType: opts.mediaType,
    feedKey: opts.feedKey,
    rows: discountedRows,
  });
  const { updated: updatedInvalid, errors: invalidErrors } = await updateDealRows({
    mediaType: opts.mediaType,
    feedKey: opts.feedKey,
    rows: invalidRows,
  });

  return {
    ok: true,
    attempted_asins: asins.length,
    updated_discounted: updatedDiscounted,
    updated_invalid: updatedInvalid,
    errors: [...errorsOut, ...discountedErrors, ...invalidErrors],
  };
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

  const revalidateActive = ["1", "true", "yes"].includes(
    String(url.searchParams.get("revalidateActive") ?? "").toLowerCase()
  );
  const activeLimit = Math.min(Math.max(Number(url.searchParams.get("activeLimit") ?? "300"), 1), 1000);
  const activeOffset = Math.max(0, Number(url.searchParams.get("activeOffset") ?? "0"));
  const revalidateOnlyParam = String(url.searchParams.get("revalidateOnly") ?? "").toLowerCase();
  const revalidateOnly = revalidateActive && ["1", "true", "yes"].includes(revalidateOnlyParam);

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
    filtered_wrong_media: 0,
    fallback_existing_list_used: 0,
    fallback_existing_discount_used: 0,
    kept: 0,
    db_sync_rows_after_upsert: null as number | null,
    db_feedkey_integrity_warning: null as string | null,
    revalidate_active: null as any,
  };

  const supabase = getSupabaseAdmin();

  const existingDealsByAsin = new Map<
    string,
    {
      title: string | null;
      artist: string | null;
      image_url: string | null;
      price_cents: number | null;
      list_price_cents: number | null;
      currency: string | null;
      discount_pct: number | null;
    }
  >();

  try {
    const { data: existingRows } = await supabase
      .from("deals")
      .select("asin,title,artist,image_url,price_cents,list_price_cents,currency,discount_pct")
      .eq("media_type", config.media_type)
      .eq("feed_key", feedKey);

    for (const row of existingRows ?? []) {
      if (!row?.asin) continue;
      existingDealsByAsin.set(String(row.asin), {
        title: row.title ?? null,
        artist: row.artist ?? null,
        image_url: row.image_url ?? null,
        price_cents: row.price_cents ?? null,
        list_price_cents: row.list_price_cents ?? null,
        currency: row.currency ?? null,
        discount_pct: row.discount_pct == null ? null : Number(row.discount_pct),
      });
    }
  } catch {}

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
    if (revalidateActive) {
      try {
        stats.revalidate_active = await revalidateActiveDeals({
          mediaType: config.media_type,
          feedKey,
          minDiscount,
          limit: activeLimit,
          offset: activeOffset,
        });
      } catch (e: any) {
        stats.revalidate_active = { ok: false, error: e?.message ?? String(e) };
      }

      if (revalidateOnly) {
        if (runId) {
          try {
            await supabase
              .from("refresh_runs")
              .update({
                ok: true,
                finished_at: new Date().toISOString(),
                found: 0,
                saved: 0,
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
          revalidate_only: true,
          revalidate_active: stats.revalidate_active,
          build_id: BUILD_ID,
          sync_id: syncId,
        });
      }
    }

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

          if (!itemMatchesMediaType(config.media_type, item)) {
            stats.filtered_wrong_media += 1;
            continue;
          }

          const existing = existingDealsByAsin.get(String(asin));
          const pricing = extractCurrentPricing(item);
          const priceCents = pricing.priceCents ?? existing?.price_cents ?? null;

          if (priceCents == null) continue;

          const listCents = pricing.listCents ?? existing?.list_price_cents ?? null;
          let discountPct = pricing.discountPct ?? computeDiscountPct(priceCents, listCents);

          if (!pricing.hadDiscountSignal && pricing.listCents == null && existing?.list_price_cents != null) {
            stats.fallback_existing_list_used += 1;
          }

          if (pricing.hadDiscountSignal) stats.items_with_discount_data += 1;

          if (mode === "under-price" && maxPriceCents != null && priceCents > maxPriceCents) {
            stats.filtered_over_max_price += 1;
            continue;
          }

          if (mode === "discount") {
            if (
              discountPct == null &&
              existing?.discount_pct != null &&
              existing.discount_pct >= minDiscount &&
              existing.price_cents != null &&
              priceCents <= existing.price_cents
            ) {
              discountPct = existing.discount_pct;
              stats.fallback_existing_discount_used += 1;
            }

            if (discountPct === null) continue;
            if (discountPct < minDiscount) {
              stats.filtered_under_min_discount += 1;
              continue;
            }
          }

          const rank = Number(item?.BrowseNodeInfo?.WebsiteSalesRank?.SalesRank) || null;
          const browseNodeId = getPrimaryBrowseNodeId(item);
          const artist = extractArtist(item) ?? existing?.artist ?? null;

          keep.push({
            asin,
            title: item?.ItemInfo?.Title?.DisplayValue ?? existing?.title ?? asin,
            artist,
            image_url: item?.Images?.Primary?.Large?.URL ?? existing?.image_url ?? null,
            amazon_url: `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_PARTNER_TAG}`,
            price_cents: priceCents,
            list_price_cents: listCents,
            currency: pricing.currency ?? existing?.currency ?? null,
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
