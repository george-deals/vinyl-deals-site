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

type ExistingDealSnapshot = {
  title: string | null;
  artist: string | null;
  image_url: string | null;
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

function parseDisplayAmountToCents(display: any): number | null {
  if (typeof display !== "string") return null;
  const cleaned = display.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const x = Number(cleaned);
  return Number.isFinite(x) && x > 0 ? Math.round(x * 100) : null;
}

function toCentsFromPriceObj(price: any): number | null {
  return toCents(price?.Amount) ?? parseDisplayAmountToCents(price?.DisplayAmount);
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
    return true;
  }

  if (mediaType === "dvd") {
    if (titleLooks4k(title)) return false;
    if (hasToken(binding, /(4k|ultra hd|uhd|blu[- ]?ray|bluray|bd)/i)) return false;
    if (hasToken(title, /\bblu[- ]?ray\b|\bbluray\b/i)) return false;
    if (hasToken(binding, /dvd/i)) return true;
    if (hasToken(title, /\bdvd\b/i)) return true;
    if (hasToken(binding, /vinyl|\bcd\b|audio\s*cd/i)) return false;
    if (hasToken(title, /\bvinyl\b|\blp\b|\bcd\b/i)) return false;
    return true;
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
    return true;
  }

  return true;
}

function pickBuyBoxListingOnly(item: any) {
  const listings: any[] = item?.Offers?.Listings ?? [];
  if (!listings.length) return null;

  const buyBox = listings.find((l) => l?.IsBuyBoxWinner);
  const candidate = buyBox ?? listings.find((l) => toCentsFromPriceObj(l?.Price));
  if (!candidate) return null;

  const priceCents = toCentsFromPriceObj(candidate?.Price);
  if (!priceCents) return null;

  return candidate;
}

function pickOfferSummary(item: any) {
  const summaries: any[] = item?.Offers?.Summaries ?? [];
  if (!summaries.length) return null;

  const summaryForNew =
    summaries.find(
      (s) => String(s?.Condition?.Value ?? s?.Condition?.DisplayValue ?? "").toLowerCase() === "new"
    ) ?? summaries[0];

  return summaryForNew ?? null;
}

function extractCurrentPricing(item: any): CurrentPricing {
  const listing = pickBuyBoxListingOnly(item);
  const summary = pickOfferSummary(item);

  const summaryLow = toCentsFromPriceObj(summary?.LowestPrice);
  const summaryHigh = toCentsFromPriceObj(summary?.HighestPrice);
  const summaryCurrency = summary?.LowestPrice?.Currency ?? summary?.HighestPrice?.Currency ?? null;
  const listFromProductInfo = toCents(item?.ItemInfo?.ProductInfo?.ListPrice?.Amount);

  if (!listing && summaryLow == null) {
    return {
      priceCents: null,
      listCents: null,
      currency: null,
      discountPct: null,
      hadDiscountSignal: false,
    };
  }

  const priceCents = toCentsFromPriceObj(listing?.Price) ?? summaryLow;
  if (priceCents == null) {
    return {
      priceCents: null,
      listCents: null,
      currency: null,
      discountPct: null,
      hadDiscountSignal: false,
    };
  }

  const listFromBasis =
    toCentsFromPriceObj(listing?.SavingBasis) ?? toCentsFromPriceObj(listing?.ListPrice) ?? listFromProductInfo;
  const savingsPct = Number(listing?.Price?.Savings?.Percentage);
  const savingsAmt = toCentsFromPriceObj(listing?.Price?.Savings);

  const listCents =
    listFromBasis ??
    (priceCents && savingsAmt ? priceCents + savingsAmt : null) ??
    (summaryHigh && summaryHigh > priceCents ? summaryHigh : null);

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
    currency: listing?.Price?.Currency ?? summaryCurrency,
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
      "ItemInfo.ProductInfo",
      "Images.Primary.Large",
      "Offers.Listings.Price",
      "Offers.Listings.SavingBasis",
      "Offers.Listings.IsBuyBoxWinner",
      "Offers.Listings.MerchantInfo",
      "Offers.Summaries.LowestPrice",
      "Offers.Summaries.HighestPrice",
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
      "ItemInfo.ProductInfo",
      "Offers.Listings.Price",
      "Offers.Listings.SavingBasis",
      "Offers.Listings.IsBuyBoxWinner",
      "Offers.Listings.MerchantInfo",
      "Offers.Summaries.LowestPrice",
      "Offers.Summaries.HighestPrice",
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

async function loadRecentPriceBaselines(opts: {
  supabase: any;
  asins: string[];
  lookbackDays?: number;
}) {
  const uniqAsins = Array.from(new Set((opts.asins ?? []).filter(Boolean)));
  if (!uniqAsins.length) return new Map<string, number>();

  const sinceIso = new Date(Date.now() - (opts.lookbackDays ?? 30) * 24 * 60 * 60 * 1000).toISOString();
  const out = new Map<string, number>();
  const CHUNK = 150;

  for (let i = 0; i < uniqAsins.length; i += CHUNK) {
    const chunk = uniqAsins.slice(i, i + CHUNK);

    const { data, error } = await opts.supabase
      .from("asin_price_history")
      .select("asin,price_cents,list_price_cents")
      .in("asin", chunk)
      .gte("checked_at", sinceIso);

    if (error) continue;

    for (const row of data ?? []) {
      const asin = row?.asin ? String(row.asin) : "";
      if (!asin) continue;

      const price = Number(row?.price_cents);
      const list = Number(row?.list_price_cents);
      const baseline = Math.max(Number.isFinite(price) ? price : 0, Number.isFinite(list) ? list : 0);
      if (!Number.isFinite(baseline) || baseline <= 0) continue;

      const prev = out.get(asin) ?? 0;
      if (baseline > prev) out.set(asin, Math.round(baseline));
    }
  }

  return out;
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
      const priceCents = pricing.priceCents;
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

async function bootstrapFromExistingDeals(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  now: string;
  syncId: string;
  existingDealsByAsin: Map<string, ExistingDealSnapshot>;
  supabase: any;
}) {
  const ordered = Array.from(opts.existingDealsByAsin.entries()).sort((a, b) => {
    const discA = Number(a[1]?.discount_pct ?? -1);
    const discB = Number(b[1]?.discount_pct ?? -1);
    if (discA !== discB) return discB - discA;

    const listA = a[1]?.list_price_cents != null ? 1 : 0;
    const listB = b[1]?.list_price_cents != null ? 1 : 0;
    return listB - listA;
  });

  const asins = ordered.slice(0, opts.limit).map(([asin]) => asin);
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += ITEM_COUNT) {
    chunks.push(asins.slice(i, i + ITEM_COUNT));
  }

  const rows: DealRow[] = [];
  const errorsOut: any[] = [];
  let fallbackExistingDiscountUsed = 0;
  let fallbackHistoryBaselineUsed = 0;

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

    const historyBaselineByAsin = await loadRecentPriceBaselines({
      supabase: opts.supabase,
      asins: chunk,
    });

    for (const asin of chunk) {
      const existing = opts.existingDealsByAsin.get(asin);
      if (!existing) continue;

      const item = itemByAsin.get(asin);
      if (!item) continue;
      if (!itemMatchesMediaType(opts.mediaType, item, existing.title)) continue;

      const pricing = extractCurrentPricing(item);
      const priceCents = pricing.priceCents;
      if (priceCents == null) continue;

      let listCents = pricing.listCents ?? existing.list_price_cents;
      let discountPct = pricing.discountPct ?? computeDiscountPct(priceCents, listCents);

      const historyBaseline = historyBaselineByAsin.get(asin) ?? null;
      if (discountPct == null && historyBaseline != null && historyBaseline > priceCents) {
        const historyDiscount = computeDiscountPct(priceCents, historyBaseline);
        if (historyDiscount != null) {
          discountPct = historyDiscount;
          listCents = Math.max(listCents ?? 0, historyBaseline);
          fallbackHistoryBaselineUsed += 1;
        }
      }

      if (
        discountPct == null &&
        existing.discount_pct != null &&
        existing.discount_pct >= opts.minDiscount &&
        existing.price_cents != null &&
        priceCents <= existing.price_cents
      ) {
        discountPct = existing.discount_pct;
        fallbackExistingDiscountUsed += 1;
      }

      if (discountPct == null || discountPct < opts.minDiscount) continue;

      rows.push({
        asin,
        title: item?.ItemInfo?.Title?.DisplayValue ?? existing.title ?? asin,
        artist: existing.artist ?? null,
        image_url: existing.image_url ?? null,
        amazon_url: "https://www.amazon.com/dp/" + asin + "?tag=" + process.env.AMAZON_PARTNER_TAG,
        price_cents: priceCents,
        list_price_cents: listCents,
        currency: pricing.currency ?? existing.currency ?? null,
        discount_pct: discountPct,
        category: "media",
        media_type: opts.mediaType,
        feed_key: opts.feedKey,
        sales_rank: null,
        genre: null,
        browse_node_id: null,
        updated_at: opts.now,
        last_seen_at: opts.now,
        sync_id: opts.syncId,
      });
    }
  }

  return {
    attempted_asins: asins.length,
    rows,
    fallback_existing_discount_used: fallbackExistingDiscountUsed,
    fallback_history_baseline_used: fallbackHistoryBaselineUsed,
    errors: errorsOut,
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
  const requestBudgetMs = Math.min(
    Math.max(Number(url.searchParams.get("requestBudgetMs") ?? "90000"), 20000),
    170000
  );

  const revalidateActive = ["1", "true", "yes"].includes(
    String(url.searchParams.get("revalidateActive") ?? "").toLowerCase()
  );
  const activeLimit = Math.min(Math.max(Number(url.searchParams.get("activeLimit") ?? "300"), 1), 1000);
  const activeOffset = Math.max(0, Number(url.searchParams.get("activeOffset") ?? "0"));
  const revalidateOnlyParam = String(url.searchParams.get("revalidateOnly") ?? "").toLowerCase();
  const revalidateOnly = revalidateActive && ["1", "true", "yes"].includes(revalidateOnlyParam);

  const now = new Date().toISOString();
  const syncId = randomUUID();
  const requestStartedAtMs = Date.now();
  const requestElapsedMs = () => Date.now() - requestStartedAtMs;
  const budgetExceeded = () => requestElapsedMs() >= requestBudgetMs;
  let stoppedEarlyReason: string | null = null;

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
    request_budget_ms: requestBudgetMs,
    keywords: config.keywords.length,
    items_returned: 0,
    items_with_discount_data: 0,
    filtered_under_min_discount: 0,
    filtered_over_max_price: 0,
    filtered_wrong_media: 0,
    fallback_existing_list_used: 0,
    fallback_existing_discount_used: 0,
    fallback_history_baseline_used: 0,
    pricing_refetched_getitems: 0,
    kept: 0,
    db_sync_rows_after_upsert: null as number | null,
    db_feedkey_integrity_warning: null as string | null,
    stopped_early_reason: null as string | null,
    request_elapsed_ms: null as number | null,
    revalidate_active: null as any,
    bootstrap_from_existing: null as any,
  };

  const supabase = getSupabaseAdmin();

  const existingDealsByAsin = new Map<string, ExistingDealSnapshot>();

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

    keywordLoop: for (const kw of config.keywords) {
      const pagesForThisKeyword = Math.min(Math.max(maxPages, 1), MAX_ITEMPAGE);

      for (let page = 1; page <= pagesForThisKeyword; page++) {
        if (budgetExceeded()) {
          stoppedEarlyReason = "request_budget_exceeded_during_search";
          break keywordLoop;
        }

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

        let historyBaselineByAsin = new Map<string, number>();
        if (mode === "discount") {
          historyBaselineByAsin = await loadRecentPriceBaselines({
            supabase,
            asins: (items ?? []).map((it) => String(it?.ASIN ?? "")).filter(Boolean),
          });
        }

        const candidateAsins: string[] = [];
        const searchItemByAsin = new Map<string, any>();
        const pricingByAsin = new Map<string, CurrentPricing>();
        const missingPricingAsins: string[] = [];

        for (const item of items) {
          const asin = item?.ASIN ? String(item.ASIN) : "";
          if (!asin || seen.has(asin) || searchItemByAsin.has(asin)) continue;

          if (!itemMatchesMediaType(config.media_type, item)) {
            stats.filtered_wrong_media += 1;
            continue;
          }

          candidateAsins.push(asin);
          searchItemByAsin.set(asin, item);

          const pricing = extractCurrentPricing(item);
          pricingByAsin.set(asin, pricing);
          if (pricing.priceCents == null) missingPricingAsins.push(asin);
        }

        let refetchedWithGetItems = 0;
        if (missingPricingAsins.length) {
          const pricingChunks: string[][] = [];
          for (let i = 0; i < missingPricingAsins.length; i += ITEM_COUNT) {
            pricingChunks.push(missingPricingAsins.slice(i, i + ITEM_COUNT));
          }

          for (const chunk of pricingChunks) {
            if (budgetExceeded()) {
              stoppedEarlyReason = "request_budget_exceeded_during_getitems_pricing";
              break;
            }

            let fullItems: any[] = [];
            try {
              fullItems = await withRetry(() => paapiGetItems(chunk));
            } catch (e: any) {
              errors.push({ asins: chunk, error: extractAxiosError(e) });
              continue;
            }

            const fullByAsin = new Map<string, any>();
            for (const full of fullItems ?? []) {
              if (full?.ASIN) fullByAsin.set(String(full.ASIN), full);
            }

            for (const asin of chunk) {
              const full = fullByAsin.get(asin);
              if (!full) continue;

              const fullPricing = extractCurrentPricing(full);
              if (fullPricing.priceCents != null) {
                pricingByAsin.set(asin, fullPricing);
                refetchedWithGetItems += 1;
              }

              const searchItem = searchItemByAsin.get(asin);
              if (searchItem) {
                searchItemByAsin.set(asin, {
                  ...searchItem,
                  ...full,
                  ItemInfo: { ...(searchItem?.ItemInfo ?? {}), ...(full?.ItemInfo ?? {}) },
                  Images: full?.Images ?? searchItem?.Images,
                  BrowseNodeInfo: searchItem?.BrowseNodeInfo ?? full?.BrowseNodeInfo,
                });
              } else {
                searchItemByAsin.set(asin, full);
              }
            }
          }
        }

        if (refetchedWithGetItems > 0) {
          stats.pricing_refetched_getitems = (stats.pricing_refetched_getitems ?? 0) + refetchedWithGetItems;
        }

        for (const asin of candidateAsins) {
          const item = searchItemByAsin.get(asin);
          if (!item) continue;

          const existing = existingDealsByAsin.get(asin);
          const pricing = pricingByAsin.get(asin) ?? extractCurrentPricing(item);
          const priceCents = pricing.priceCents;

          if (priceCents == null) continue;

          let listCents = pricing.listCents ?? existing?.list_price_cents ?? null;
          let discountPct = pricing.discountPct ?? computeDiscountPct(priceCents, listCents);

          const historyBaseline = historyBaselineByAsin.get(asin) ?? null;
          if (discountPct == null && historyBaseline != null && historyBaseline > priceCents) {
            const historyDiscount = computeDiscountPct(priceCents, historyBaseline);
            if (historyDiscount != null) {
              discountPct = historyDiscount;
              listCents = Math.max(listCents ?? 0, historyBaseline);
              stats.fallback_history_baseline_used += 1;
            }
          }

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
            amazon_url: "https://www.amazon.com/dp/" + asin + "?tag=" + process.env.AMAZON_PARTNER_TAG,
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

    if (mode === "discount" && keep.length === 0 && existingDealsByAsin.size > 0) {
      if (budgetExceeded()) {
        stats.bootstrap_from_existing = {
          skipped: true,
          reason: "request_budget_exceeded_before_bootstrap",
        };
      } else {
        const bootstrapLimit = Math.min(
          Math.max(Number(url.searchParams.get("bootstrapLimit") ?? "120"), 20),
          400
        );

        const bootstrap = await bootstrapFromExistingDeals({
          mediaType: config.media_type,
          feedKey,
          minDiscount,
          limit: bootstrapLimit,
          now,
          syncId,
          existingDealsByAsin,
          supabase,
        });

        if (bootstrap.rows.length) {
          for (const row of bootstrap.rows) {
            if (seen.has(row.asin)) continue;
            keep.push(row);
            seen.add(row.asin);
            stats.kept += 1;
          }
        }

        stats.bootstrap_from_existing = {
          attempted_asins: bootstrap.attempted_asins,
          kept: bootstrap.rows.length,
          fallback_existing_discount_used: bootstrap.fallback_existing_discount_used,
          fallback_history_baseline_used: bootstrap.fallback_history_baseline_used,
          errors: bootstrap.errors.length,
        };

        if (bootstrap.errors.length) {
          errors.push(...bootstrap.errors);
        }
      }
    }

    stats.stopped_early_reason = stoppedEarlyReason;
    stats.request_elapsed_ms = requestElapsedMs();

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
