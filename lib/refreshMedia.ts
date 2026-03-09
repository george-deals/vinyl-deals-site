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

type TrackedAsinSnapshot = {
  asin: string;
  title: string | null;
  artist: string | null;
  image_url: string | null;
  amazon_url: string | null;
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

function parseDiscountBucketEstimate(v: any): number | null {
  if (typeof v !== "string") return null;

  const nums = (v.match(/\d+(?:\.\d+)?/g) ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 95);

  if (!nums.length) return null;

  if (nums.length >= 2) {
    const low = Math.min(nums[0], nums[1]);
    const high = Math.max(nums[0], nums[1]);
    return Math.round(((low + high) / 2) * 10) / 10;
  }

  const single = nums[0];
  return Math.round(single * 10) / 10;
}

function normalizeDiscountPct(v: any): number | null {
  const raw = Number(v);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  let normalized = raw;
  if (normalized > 0 && normalized < 1) normalized = normalized * 100;
  if (normalized > 100 && normalized <= 1000) normalized = normalized / 10;
  if (normalized <= 0 || normalized > 100) return null;

  return Math.round(normalized * 10) / 10;
}

function toDiscountBand(discountPct: number): "15_20" | "20_30" | "30_40" | "40_50" | "50_plus" {
  if (discountPct >= 50) return "50_plus";
  if (discountPct >= 40) return "40_50";
  if (discountPct >= 30) return "30_40";
  if (discountPct >= 20) return "20_30";
  return "15_20";
}

function createDiscountBandCounts() {
  return { "15_20": 0, "20_30": 0, "30_40": 0, "40_50": 0, "50_plus": 0 };
}

function addDiscountBandCount(
  bucket: ReturnType<typeof createDiscountBandCounts>,
  discountPct: number | null
) {
  if (discountPct == null || !Number.isFinite(discountPct)) return;
  bucket[toDiscountBand(discountPct)] += 1;
}

function isAssociateNotEligibleError(err: any): boolean {
  const code = String(err?.code ?? err?.Code ?? err?.error?.code ?? "").toLowerCase();
  const message = String(err?.message ?? err?.Message ?? err?.error?.message ?? "").toLowerCase();
  return (
    code === "associatenoteligible" ||
    message.includes("does not currently meet the eligibility requirements to access the product advertising api")
  );
}

function containsAssociateNotEligible(value: any): boolean {
  if (value == null) return false;
  if (isAssociateNotEligibleError(value)) return true;
  if (Array.isArray(value)) return value.some((v) => containsAssociateNotEligible(v));
  if (typeof value === "object") return Object.values(value).some((v) => containsAssociateNotEligible(v));
  return false;
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

function extractPaapiBodyErrors(data: any, status: number | null) {
  const raw = Array.isArray(data?.Errors) ? data.Errors : [];
  return raw
    .map((err: any) => ({
      status,
      code: err?.Code ?? null,
      message: err?.Message ?? "Unknown error",
    }))
    .filter((err: any) => Boolean(err.message));
}

function buildPaapiBodyError(errors: Array<{ status: number | null; code: string | null; message: string }>) {
  const first = errors[0] ?? { status: null, code: null, message: "Unknown PA-API error" };
  const e: any = new Error(first.message);
  e.response = {
    status: first.status,
    data: {
      Errors: errors.map((err) => ({ Code: err.code, Message: err.message })),
    },
  };
  return e;
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

function buildAmazonUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_PARTNER_TAG}`;
}

function buildTrackedSnapshot(item: any): TrackedAsinSnapshot | null {
  const asin = item?.ASIN ? String(item.ASIN) : "";
  if (!asin) return null;

  return {
    asin,
    title: item?.ItemInfo?.Title?.DisplayValue ?? null,
    artist: extractArtist(item),
    image_url: item?.Images?.Primary?.Large?.URL ?? null,
    amazon_url: buildAmazonUrl(asin),
  };
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

function getOfferListings(item: any): any[] {
  const offers = item?.Offers ?? item?.OffersV2 ?? item?.Offer ?? null;
  if (!offers) return [];

  const raw = offers?.Listings ?? offers?.ListingsV2 ?? offers?.Listing ?? null;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function getOfferSummaries(item: any): any[] {
  const offers = item?.Offers ?? item?.OffersV2 ?? item?.Offer ?? null;
  if (!offers) return [];

  const raw = offers?.Summaries ?? offers?.SummariesV2 ?? offers?.Summary ?? null;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function firstDefinedPriceCents(...candidates: any[]): number | null {
  for (const c of candidates) {
    const cents = toCentsFromPriceObj(c);
    if (cents != null) return cents;
  }
  return null;
}

function pickBuyBoxListingOnly(item: any) {
  const listings = getOfferListings(item);
  if (!listings.length) return null;

  const buyBox = listings.find((l: any) => l?.IsBuyBoxWinner === true || l?.IsBuyBoxWinner === "true");
  const candidate =
    buyBox ??
    listings.find((l: any) =>
      firstDefinedPriceCents(l?.Price, l?.OfferPrice, l?.BuyingPrice, l?.PriceInfo?.Price, l?.PriceInfo)
    );

  if (!candidate) return null;

  const priceCents = firstDefinedPriceCents(
    candidate?.Price,
    candidate?.OfferPrice,
    candidate?.BuyingPrice,
    candidate?.PriceInfo?.Price,
    candidate?.PriceInfo
  );
  if (!priceCents) return null;

  return candidate;
}

function pickOfferSummary(item: any) {
  const summaries = getOfferSummaries(item);
  if (!summaries.length) return null;

  const summaryForNew =
    summaries.find(
      (s: any) => String(s?.Condition?.Value ?? s?.Condition?.DisplayValue ?? "").toLowerCase() === "new"
    ) ?? summaries[0];

  return summaryForNew ?? null;
}

function extractCurrentPricing(item: any): CurrentPricing {
  const listing = pickBuyBoxListingOnly(item);
  const summary = pickOfferSummary(item);

  const summaryLow = firstDefinedPriceCents(summary?.LowestPrice, summary?.Price, summary?.MinPrice);
  const summaryHigh = firstDefinedPriceCents(summary?.HighestPrice, summary?.ListPrice, summary?.MaxPrice);
  const summaryCurrency =
    summary?.LowestPrice?.Currency ??
    summary?.HighestPrice?.Currency ??
    summary?.Price?.Currency ??
    summary?.ListPrice?.Currency ??
    null;
  const listFromProductInfo = firstDefinedPriceCents(
    item?.ItemInfo?.ProductInfo?.ListPrice,
    item?.ItemInfo?.ProductInfo?.UnitPrice
  );

  if (!listing && summaryLow == null) {
    return {
      priceCents: null,
      listCents: null,
      currency: null,
      discountPct: null,
      hadDiscountSignal: false,
    };
  }

  const priceCents =
    firstDefinedPriceCents(
      listing?.Price,
      listing?.OfferPrice,
      listing?.BuyingPrice,
      listing?.PriceInfo?.Price,
      listing?.PriceInfo
    ) ?? summaryLow;

  if (priceCents == null) {
    return {
      priceCents: null,
      listCents: null,
      currency: null,
      discountPct: null,
      hadDiscountSignal: false,
    };
  }

  const listFromBasis = firstDefinedPriceCents(
    listing?.SavingBasis,
    listing?.ListPrice,
    listing?.Price?.SavingBasis,
    listing?.Price?.ListPrice,
    listing?.PriceInfo?.SavingBasis,
    listing?.PriceInfo?.ListPrice,
    listFromProductInfo
  );

  const savingsPct = Number(
    listing?.Price?.Savings?.Percentage ?? listing?.Savings?.Percentage ?? listing?.PriceInfo?.Savings?.Percentage
  );
  const savingsAmt = firstDefinedPriceCents(
    listing?.Price?.Savings,
    listing?.Savings,
    listing?.PriceInfo?.Savings
  );

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
    currency:
      listing?.Price?.Currency ??
      listing?.OfferPrice?.Currency ??
      listing?.BuyingPrice?.Currency ??
      listing?.PriceInfo?.Price?.Currency ??
      summaryCurrency,
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

  const data = resp.data ?? {};
  const items = data?.SearchResult?.Items || [];
  const bodyErrors = extractPaapiBodyErrors(data, resp.status ?? null);
  if (bodyErrors.length && (!Array.isArray(items) || items.length === 0)) {
    throw buildPaapiBodyError(bodyErrors);
  }

  return items;
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

  const data = resp.data ?? {};
  const items = data?.ItemsResult?.Items || [];
  const bodyErrors = extractPaapiBodyErrors(data, resp.status ?? null);
  if (bodyErrors.length && (!Array.isArray(items) || items.length === 0)) {
    throw buildPaapiBodyError(bodyErrors);
  }

  return items;
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

async function upsertTrackedAsinsChunked(opts: {
  mediaType: MediaConfig["media_type"];
  rows: TrackedAsinSnapshot[];
  nowIso: string;
}) {
  if (!opts.rows.length) return { upserted: 0 };

  const supabase = getSupabaseAdmin();
  const deduped = new Map<string, TrackedAsinSnapshot>();
  for (const row of opts.rows) {
    if (!row?.asin) continue;
    deduped.set(row.asin, row);
  }

  const rows = Array.from(deduped.values()).map((row) => ({
    asin: row.asin,
    media_type: opts.mediaType,
    title: row.title,
    artist: row.artist,
    image_url: row.image_url,
    amazon_url: row.amazon_url ?? buildAmazonUrl(row.asin),
    last_seen_at: opts.nowIso,
    is_active: true,
  }));

  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("tracked_asins").upsert(chunk, {
      onConflict: "asin",
    });
    if (error) throw new Error(error.message);
    upserted += chunk.length;
  }

  return { upserted };
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
  includeAllTimeFallback?: boolean;
}) {
  const uniqAsins = Array.from(new Set((opts.asins ?? []).filter(Boolean)));
  if (!uniqAsins.length) return new Map<string, number>();

  const lookbackDays = Math.max(1, Math.min(opts.lookbackDays ?? 120, 365));
  const sinceIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const includeAllTimeFallback = opts.includeAllTimeFallback ?? true;

  const out = new Map<string, number>();
  const CHUNK = 150;

  const ingest = (rows: any[] | null | undefined) => {
    for (const row of rows ?? []) {
      const asin = row?.asin ? String(row.asin) : "";
      if (!asin) continue;

      const price = Number(row?.price_cents);
      const list = Number(row?.list_price_cents);
      const baseline = Math.max(Number.isFinite(price) ? price : 0, Number.isFinite(list) ? list : 0);
      if (!Number.isFinite(baseline) || baseline <= 0) continue;

      const prev = out.get(asin) ?? 0;
      if (baseline > prev) out.set(asin, Math.round(baseline));
    }
  };

  for (let i = 0; i < uniqAsins.length; i += CHUNK) {
    const chunk = uniqAsins.slice(i, i + CHUNK);

    const { data, error } = await opts.supabase
      .from("asin_price_history")
      .select("asin,price_cents,list_price_cents")
      .in("asin", chunk)
      .gte("checked_at", sinceIso);

    if (!error) ingest(data);

    if (!includeAllTimeFallback) continue;

    const unresolved = chunk.filter((asin) => !out.has(asin));
    if (!unresolved.length) continue;

    const { data: fallbackData, error: fallbackError } = await opts.supabase
      .from("asin_price_history")
      .select("asin,price_cents,list_price_cents")
      .in("asin", unresolved);

    if (!fallbackError) ingest(fallbackData);
  }

  return out;
}

async function loadBucketedSnapshots(opts: {
  supabase: any;
  asins: string[];
  mediaType: MediaConfig["media_type"];
}) {
  const uniqAsins = Array.from(new Set((opts.asins ?? []).filter(Boolean)));
  if (!uniqAsins.length) {
    return new Map<
      string,
      {
        price_cents: number | null;
        list_price_cents: number | null;
        currency: string | null;
        discount_pct: number | null;
        title: string | null;
        image_url: string | null;
      }
    >();
  }

  const out = new Map<
    string,
    {
      price_cents: number | null;
      list_price_cents: number | null;
      currency: string | null;
      discount_pct: number | null;
      title: string | null;
      image_url: string | null;
    }
  >();

  const CHUNK = 150;
  for (let i = 0; i < uniqAsins.length; i += CHUNK) {
    const chunk = uniqAsins.slice(i, i + CHUNK);
    const { data, error } = await opts.supabase
      .from("deals_bucketed")
      .select("asin,title,image_url,price_cents,list_price_cents,currency,discount_pct,updated_at")
      .eq("media_type", opts.mediaType)
      .in("asin", chunk)
      .order("updated_at", { ascending: false });

    if (error) continue;

    for (const row of data ?? []) {
      const asin = row?.asin ? String(row.asin) : "";
      if (!asin || out.has(asin)) continue;

      const price = Number(row?.price_cents);
      const list = Number(row?.list_price_cents);
      const discount = Number(row?.discount_pct);

      out.set(asin, {
        price_cents: Number.isFinite(price) && price > 0 ? Math.round(price) : null,
        list_price_cents: Number.isFinite(list) && list > 0 ? Math.round(list) : null,
        currency: row?.currency ? String(row.currency) : null,
        discount_pct: Number.isFinite(discount) ? discount : null,
        title: row?.title ? String(row.title) : null,
        image_url: row?.image_url ? String(row.image_url) : null,
      });
    }
  }

  return out;
}

async function loadLatestPriceSnapshots(opts: {
  supabase: any;
  asins: string[];
  lookbackHours?: number;
  includeAllTimeFallback?: boolean;
}) {
  const uniqAsins = Array.from(new Set((opts.asins ?? []).filter(Boolean)));
  if (!uniqAsins.length) {
    return new Map<
      string,
      { price_cents: number; list_price_cents: number | null; currency: string | null; checked_at: string | null }
    >();
  }

  const lookbackHours = Math.max(1, Math.min(opts.lookbackHours ?? 72, 24 * 30));
  const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const includeAllTimeFallback = opts.includeAllTimeFallback ?? true;

  const out = new Map<
    string,
    { price_cents: number; list_price_cents: number | null; currency: string | null; checked_at: string | null }
  >();
  const CHUNK = 150;

  const ingestLatest = (rows: any[] | null | undefined) => {
    for (const row of rows ?? []) {
      const asin = row?.asin ? String(row.asin) : "";
      if (!asin || out.has(asin)) continue;

      const price = Number(row?.price_cents);
      if (!Number.isFinite(price) || price <= 0) continue;

      const list = Number(row?.list_price_cents);
      out.set(asin, {
        price_cents: Math.round(price),
        list_price_cents: Number.isFinite(list) && list > 0 ? Math.round(list) : null,
        currency: row?.currency ? String(row.currency) : null,
        checked_at: row?.checked_at ? String(row.checked_at) : null,
      });
    }
  };

  for (let i = 0; i < uniqAsins.length; i += CHUNK) {
    const chunk = uniqAsins.slice(i, i + CHUNK);

    const { data, error } = await opts.supabase
      .from("asin_price_history")
      .select("asin,checked_at,price_cents,list_price_cents,currency")
      .in("asin", chunk)
      .gte("checked_at", sinceIso)
      .order("checked_at", { ascending: false });

    if (!error) ingestLatest(data);

    if (!includeAllTimeFallback) continue;

    const unresolved = chunk.filter((asin) => !out.has(asin));
    if (!unresolved.length) continue;

    const { data: fallbackData, error: fallbackError } = await opts.supabase
      .from("asin_price_history")
      .select("asin,checked_at,price_cents,list_price_cents,currency")
      .in("asin", unresolved)
      .order("checked_at", { ascending: false });

    if (!fallbackError) ingestLatest(fallbackData);
  }

  return out;
}

async function revalidateActiveDeals(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
  includeAll?: boolean;
}) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  let dealsQuery = supabase
    .from("deals")
    .select("asin,title,price_cents,list_price_cents,currency,discount_pct")
    .eq("media_type", opts.mediaType)
    .eq("feed_key", opts.feedKey);

  if (!opts.includeAll) {
    dealsQuery = dealsQuery.gte("discount_pct", opts.minDiscount);
  }

  const { data: rows, error } = await dealsQuery
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
      discount_pct: normalizeDiscountPct(row.discount_pct),
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
  let fallbackHistoryPriceUsed = 0;

  for (const chunk of chunks) {
    let items: any[] = [];
    try {
      items = await withRetry(() => paapiGetItems(chunk));
    } catch (e: any) {
      errorsOut.push({ asins: chunk, error: extractAxiosError(e) });
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

    const historyLatestByAsin = await loadLatestPriceSnapshots({
      supabase,
      asins: chunk,
      lookbackHours: 72,
      includeAllTimeFallback: true,
    });
    const historyBaselineByAsin = await loadRecentPriceBaselines({
      supabase,
      asins: chunk,
      lookbackDays: 120,
      includeAllTimeFallback: true,
    });

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
        } else {
          errorsOut.push({ asin, error: { message: "paapi_item_missing" } });
        }

        const historyLatest = historyLatestByAsin.get(asin);
        if (!historyLatest) continue;

        const priceCents = historyLatest.price_cents;
        let listCents = existing.list_price_cents ?? historyLatest.list_price_cents ?? null;
        const historyBaseline = historyBaselineByAsin.get(asin) ?? null;
        if ((!listCents || listCents <= priceCents) && historyBaseline != null && historyBaseline > priceCents) {
          listCents = historyBaseline;
        }

        let discountPct = computeDiscountPct(priceCents, listCents);
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
            currency: historyLatest.currency ?? existing.currency,
            discount_pct: discountPct,
            updated_at: now,
            last_seen_at: now,
          });
          fallbackHistoryPriceUsed += 1;
        } else {
          invalidRows.push({
            asin,
            price_cents: priceCents,
            list_price_cents: listCents,
            currency: historyLatest.currency ?? existing.currency,
            discount_pct: 0,
            updated_at: now,
          });
          fallbackHistoryPriceUsed += 1;
        }
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
      let priceCents = pricing.priceCents;
      let listCents = pricing.listCents ?? existing.list_price_cents;
      let currency = pricing.currency ?? existing.currency;

      if (priceCents == null) {
        const historyLatest = historyLatestByAsin.get(asin);
        if (historyLatest) {
          priceCents = historyLatest.price_cents;
          listCents = listCents ?? historyLatest.list_price_cents;
          currency = currency ?? historyLatest.currency;
          fallbackHistoryPriceUsed += 1;
        }
      }

      if (priceCents == null) {
        errorsOut.push({ asin, error: { message: "no_price_data" } });
        continue;
      }

      let discountPct = pricing.discountPct ?? computeDiscountPct(priceCents, listCents);

      const historyBaseline = historyBaselineByAsin.get(asin) ?? null;
      if (discountPct == null && historyBaseline != null && historyBaseline > priceCents) {
        const historyDiscount = computeDiscountPct(priceCents, historyBaseline);
        if (historyDiscount != null) {
          discountPct = historyDiscount;
          listCents = Math.max(listCents ?? 0, historyBaseline);
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
    fallback_history_price_used: fallbackHistoryPriceUsed,
    errors: [...errorsOut, ...discountedErrors, ...invalidErrors],
  };
}

async function bootstrapFromExistingDeals(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
  now: string;
  syncId: string;
  historyLookbackDays: number;
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

  if (!ordered.length) {
    return {
      attempted_asins: 0,
      rows: [] as DealRow[],
      fallback_existing_discount_used: 0,
      fallback_history_baseline_used: 0,
      errors: [] as any[],
    };
  }

  const bootstrapLimit = Math.max(1, Math.min(opts.limit, ordered.length));
  const bootstrapOffset = ((Math.max(0, opts.offset) % ordered.length) + ordered.length) % ordered.length;
  const rotated = ordered.slice(bootstrapOffset).concat(ordered.slice(0, bootstrapOffset));

  const asins = rotated.slice(0, bootstrapLimit).map(([asin]) => asin);
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += ITEM_COUNT) {
    chunks.push(asins.slice(i, i + ITEM_COUNT));
  }

  const rows: DealRow[] = [];
  const errorsOut: any[] = [];
  let fallbackExistingDiscountUsed = 0;
  let fallbackExistingPriceUsed = 0;
  let fallbackHistoryBaselineUsed = 0;
  let fallbackWithoutLiveItem = 0;

  for (const chunk of chunks) {
    let items: any[] = [];
    try {
      items = await withRetry(() => paapiGetItems(chunk));
    } catch (e: any) {
      errorsOut.push({ asins: chunk, error: extractAxiosError(e) });
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
      lookbackDays: opts.historyLookbackDays,
      includeAllTimeFallback: true,
    });
    const historyLatestByAsin = await loadLatestPriceSnapshots({
      supabase: opts.supabase,
      asins: chunk,
      lookbackHours: 72,
      includeAllTimeFallback: true,
    });

    for (const asin of chunk) {
      const existing = opts.existingDealsByAsin.get(asin);
      if (!existing) continue;

      const item = itemByAsin.get(asin);
      if (item && !itemMatchesMediaType(opts.mediaType, item, existing.title)) continue;
      if (!item) fallbackWithoutLiveItem += 1;

      const pricing = item
        ? extractCurrentPricing(item)
        : {
            priceCents: null,
            listCents: null,
            currency: null,
            discountPct: null,
            hadDiscountSignal: false,
          };
      let priceCents = pricing.priceCents;
      let listCents = pricing.listCents ?? existing.list_price_cents;
      let currency = pricing.currency ?? existing.currency ?? null;

      if (priceCents == null) {
        const historyLatest = historyLatestByAsin.get(asin);
        if (historyLatest) {
          priceCents = historyLatest.price_cents;
          listCents = listCents ?? historyLatest.list_price_cents;
          currency = currency ?? historyLatest.currency;
        }
      }

      if (priceCents == null && existing.price_cents != null) {
        priceCents = existing.price_cents;
        fallbackExistingPriceUsed += 1;
      }

      if (priceCents == null) continue;

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

      const existingBaseline = Math.max(
        Number(existing.list_price_cents ?? 0),
        Number(existing.price_cents ?? 0)
      );
      if (discountPct == null && Number.isFinite(existingBaseline) && existingBaseline > priceCents) {
        const existingDiscount = computeDiscountPct(priceCents, existingBaseline);
        if (existingDiscount != null) {
          discountPct = existingDiscount;
          listCents = Math.max(listCents ?? 0, existingBaseline);
          fallbackExistingDiscountUsed += 1;
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
        image_url: item?.Images?.Primary?.Large?.URL ?? existing.image_url ?? null,
        amazon_url: buildAmazonUrl(asin),
        price_cents: priceCents,
        list_price_cents: listCents,
        currency,
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
    fallback_existing_price_used: fallbackExistingPriceUsed,
    fallback_history_baseline_used: fallbackHistoryBaselineUsed,
    fallback_without_live_item: fallbackWithoutLiveItem,
    errors: errorsOut,
  };
}

async function loadTrackedAsinsForBootstrap(opts: {
  supabase: any;
  mediaType: MediaConfig["media_type"];
  limit: number;
  offset: number;
}) {
  const { data, error } = await opts.supabase
    .from("tracked_asins")
    .select("asin,title,artist,image_url,amazon_url")
    .eq("media_type", opts.mediaType)
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (error) throw new Error(error.message);

  const out: TrackedAsinSnapshot[] = [];
  for (const row of data ?? []) {
    const asin = row?.asin ? String(row.asin) : "";
    if (!asin) continue;
    out.push({
      asin,
      title: row?.title ?? null,
      artist: row?.artist ?? null,
      image_url: row?.image_url ?? null,
      amazon_url: row?.amazon_url ?? null,
    });
  }

  return out;
}

async function bootstrapFromTrackedAsins(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
  now: string;
  syncId: string;
  historyLookbackDays: number;
  existingDealsByAsin: Map<string, ExistingDealSnapshot>;
  supabase: any;
}) {
  const trackedRows = await loadTrackedAsinsForBootstrap({
    supabase: opts.supabase,
    mediaType: opts.mediaType,
    limit: opts.limit,
    offset: opts.offset,
  });

  const trackedByAsin = new Map<string, TrackedAsinSnapshot>();
  for (const row of trackedRows) trackedByAsin.set(row.asin, row);

  const asins = Array.from(trackedByAsin.keys());
  if (!asins.length) {
    return {
      attempted_asins: 0,
      rows: [] as DealRow[],
      fallback_existing_discount_used: 0,
      fallback_history_baseline_used: 0,
      errors: [] as any[],
    };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += ITEM_COUNT) {
    chunks.push(asins.slice(i, i + ITEM_COUNT));
  }

  const rows: DealRow[] = [];
  const errorsOut: any[] = [];
  let fallbackExistingDiscountUsed = 0;
  let fallbackExistingPriceUsed = 0;
  let fallbackHistoryBaselineUsed = 0;
  let fallbackWithoutLiveItem = 0;

  for (const chunk of chunks) {
    let items: any[] = [];
    try {
      items = await withRetry(() => paapiGetItems(chunk));
    } catch (e: any) {
      errorsOut.push({ asins: chunk, error: extractAxiosError(e) });
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
      lookbackDays: opts.historyLookbackDays,
      includeAllTimeFallback: true,
    });
    const historyLatestByAsin = await loadLatestPriceSnapshots({
      supabase: opts.supabase,
      asins: chunk,
      lookbackHours: 72,
      includeAllTimeFallback: true,
    });

    for (const asin of chunk) {
      const tracked = trackedByAsin.get(asin);
      if (!tracked) continue;

      const item = itemByAsin.get(asin);

      const existing = opts.existingDealsByAsin.get(asin);
      if (item && !itemMatchesMediaType(opts.mediaType, item, tracked.title ?? existing?.title ?? null)) continue;
      if (!item) fallbackWithoutLiveItem += 1;

      const pricing = item
        ? extractCurrentPricing(item)
        : {
            priceCents: null,
            listCents: null,
            currency: null,
            discountPct: null,
            hadDiscountSignal: false,
          };
      let priceCents = pricing.priceCents;
      let listCents = pricing.listCents ?? existing?.list_price_cents ?? null;
      let currency = pricing.currency ?? existing?.currency ?? null;

      if (priceCents == null) {
        const historyLatest = historyLatestByAsin.get(asin);
        if (historyLatest) {
          priceCents = historyLatest.price_cents;
          listCents = listCents ?? historyLatest.list_price_cents;
          currency = currency ?? historyLatest.currency;
        }
      }

      if (priceCents == null && existing?.price_cents != null) {
        priceCents = existing.price_cents;
        fallbackExistingPriceUsed += 1;
      }

      if (priceCents == null) continue;

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

      const existingBaseline = Math.max(
        Number(existing?.list_price_cents ?? 0),
        Number(existing?.price_cents ?? 0)
      );
      if (discountPct == null && Number.isFinite(existingBaseline) && existingBaseline > priceCents) {
        const existingDiscount = computeDiscountPct(priceCents, existingBaseline);
        if (existingDiscount != null) {
          discountPct = existingDiscount;
          listCents = Math.max(listCents ?? 0, existingBaseline);
          fallbackExistingDiscountUsed += 1;
        }
      }

      if (discountPct == null || discountPct < opts.minDiscount) continue;

      rows.push({
        asin,
        title: item?.ItemInfo?.Title?.DisplayValue ?? tracked.title ?? existing?.title ?? asin,
        artist: extractArtist(item) ?? tracked.artist ?? existing?.artist ?? null,
        image_url: item?.Images?.Primary?.Large?.URL ?? tracked.image_url ?? existing?.image_url ?? null,
        amazon_url: tracked.amazon_url ?? buildAmazonUrl(asin),
        price_cents: priceCents,
        list_price_cents: listCents,
        currency,
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
    fallback_existing_price_used: fallbackExistingPriceUsed,
    fallback_history_baseline_used: fallbackHistoryBaselineUsed,
    fallback_without_live_item: fallbackWithoutLiveItem,
    errors: errorsOut,
  };
}

async function bootstrapFromExistingHistoryOnly(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
  now: string;
  syncId: string;
  historyLookbackDays: number;
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

  if (!ordered.length) {
    return {
      attempted_asins: 0,
      rows: [] as DealRow[],
      fallback_history_rows_used: 0,
    };
  }

  const bootstrapLimit = Math.max(1, Math.min(opts.limit, ordered.length));
  const bootstrapOffset = ((Math.max(0, opts.offset) % ordered.length) + ordered.length) % ordered.length;
  const rotated = ordered.slice(bootstrapOffset).concat(ordered.slice(0, bootstrapOffset));
  const asins = rotated.slice(0, bootstrapLimit).map(([asin]) => asin);

  const historyLatestByAsin = await loadLatestPriceSnapshots({
    supabase: opts.supabase,
    asins,
    lookbackHours: 24 * 7,
    includeAllTimeFallback: true,
  });

  const historyBaselineByAsin = await loadRecentPriceBaselines({
    supabase: opts.supabase,
    asins,
    lookbackDays: opts.historyLookbackDays,
    includeAllTimeFallback: true,
  });

  const bucketedByAsin =
    opts.mediaType === "4k-uhd"
      ? await loadBucketedSnapshots({
          supabase: opts.supabase,
          asins,
          mediaType: opts.mediaType,
        })
      : new Map<string, {
          price_cents: number | null;
          list_price_cents: number | null;
          currency: string | null;
          discount_pct: number | null;
          title: string | null;
          image_url: string | null;
        }>();

  const rows: DealRow[] = [];
  let fallbackHistoryRowsUsed = 0;
  let fallbackBucketedRowsUsed = 0;

  for (const asin of asins) {
    const existing = opts.existingDealsByAsin.get(asin);
    if (!existing) continue;

    const historyLatest = historyLatestByAsin.get(asin);
    const bucketed = bucketedByAsin.get(asin);

    const rawPriceCents =
      historyLatest?.price_cents ??
      (existing.price_cents != null ? Number(existing.price_cents) : null) ??
      (bucketed?.price_cents ?? null);
    if (rawPriceCents == null) continue;
    if (!Number.isFinite(rawPriceCents) || rawPriceCents <= 0) continue;
    const priceCents = Math.round(Number(rawPriceCents));

    const baselineCandidates = [
      Number(existing.list_price_cents ?? 0),
      Number(existing.price_cents ?? 0),
      Number(historyLatest?.list_price_cents ?? 0),
      Number(historyBaselineByAsin.get(asin) ?? 0),
      Number(bucketed?.list_price_cents ?? 0),
      Number(bucketed?.price_cents ?? 0),
    ];

    const rawListCents = Math.max(...baselineCandidates.filter((v) => Number.isFinite(v) && v > 0));
    if (!Number.isFinite(rawListCents) || rawListCents <= priceCents) continue;
    const listCents = Math.round(rawListCents);

    let discountPct = computeDiscountPct(priceCents, listCents);
    if (
      discountPct == null &&
      existing.discount_pct != null &&
      existing.discount_pct >= opts.minDiscount &&
      existing.price_cents != null &&
      priceCents <= existing.price_cents
    ) {
      discountPct = existing.discount_pct;
    }

    if (
      discountPct == null &&
      bucketed?.discount_pct != null &&
      bucketed.discount_pct >= opts.minDiscount &&
      bucketed.price_cents != null &&
      priceCents <= bucketed.price_cents
    ) {
      discountPct = bucketed.discount_pct;
      fallbackBucketedRowsUsed += 1;
    }

    if (discountPct == null || discountPct < opts.minDiscount) continue;

    rows.push({
      asin,
      title: existing.title ?? bucketed?.title ?? asin,
      artist: existing.artist ?? null,
      image_url: existing.image_url ?? bucketed?.image_url ?? null,
      amazon_url: buildAmazonUrl(asin),
      price_cents: priceCents,
      list_price_cents: listCents,
      currency: historyLatest?.currency ?? existing.currency ?? bucketed?.currency ?? null,
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

    fallbackHistoryRowsUsed += 1;
  }

  return {
    attempted_asins: asins.length,
    rows,
    fallback_history_rows_used: fallbackHistoryRowsUsed,
    fallback_bucketed_rows_used: fallbackBucketedRowsUsed,
  };
}

async function bootstrapFromTrackedHistoryPool(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
  now: string;
  syncId: string;
  historyLookbackDays: number;
  existingDealsByAsin: Map<string, ExistingDealSnapshot>;
  supabase: any;
}) {
  const scanWindow = 1200;

  const { data, error } = await opts.supabase
    .from("tracked_asins")
    .select("asin,title,artist,image_url,amazon_url,last_seen_at")
    .eq("media_type", opts.mediaType)
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .range(0, scanWindow - 1);

  if (error) throw new Error(error.message);

  const trackedByAsin = new Map<string, any>();
  for (const row of data ?? []) {
    const asin = row?.asin ? String(row.asin) : "";
    if (!asin || trackedByAsin.has(asin)) continue;
    trackedByAsin.set(asin, row);
  }

  const asins = Array.from(trackedByAsin.keys());
  const candidateDiscountBands = createDiscountBandCounts();
  const keptDiscountBands = createDiscountBandCounts();
  if (!asins.length) {
    return {
      attempted_rows: 0,
      candidate_rows: 0,
      candidate_discount_bands: candidateDiscountBands,
      kept_discount_bands: keptDiscountBands,
      rows: [] as DealRow[],
    };
  }

  const historyLatestByAsin = await loadLatestPriceSnapshots({
    supabase: opts.supabase,
    asins,
    lookbackHours: 24 * 30,
    includeAllTimeFallback: true,
  });

  const historyBaselineByAsin = await loadRecentPriceBaselines({
    supabase: opts.supabase,
    asins,
    lookbackDays: opts.historyLookbackDays,
    includeAllTimeFallback: true,
  });

  const bucketedByAsin =
    opts.mediaType === "4k-uhd"
      ? await loadBucketedSnapshots({
          supabase: opts.supabase,
          asins,
          mediaType: opts.mediaType,
        })
      : new Map<string, {
          price_cents: number | null;
          list_price_cents: number | null;
          currency: string | null;
          discount_pct: number | null;
          title: string | null;
          image_url: string | null;
        }>();

  const candidates: Array<{
    asin: string;
    title: string;
    artist: string | null;
    image_url: string | null;
    amazon_url: string;
    price_cents: number;
    list_price_cents: number;
    currency: string | null;
    discount_pct: number;
    updated_at_ms: number;
  }> = [];

  for (const asin of asins) {
    const tracked = trackedByAsin.get(asin);
    const existing = opts.existingDealsByAsin.get(asin);
    const bucketed = bucketedByAsin.get(asin);
    const latest = historyLatestByAsin.get(asin);

    if (!latest?.price_cents || latest.price_cents <= 0) continue;
    const priceCents = Math.round(latest.price_cents);

    const listCandidates = [
      Number(latest.list_price_cents ?? 0),
      Number(historyBaselineByAsin.get(asin) ?? 0),
      Number(bucketed?.list_price_cents ?? 0),
      Number(bucketed?.price_cents ?? 0),
      Number(existing?.list_price_cents ?? 0),
      Number(existing?.price_cents ?? 0),
    ].filter((v) => Number.isFinite(v) && v > priceCents) as number[];

    if (!listCandidates.length) continue;
    const listCents = Math.round(Math.max(...listCandidates));

    const discountPct = computeDiscountPct(priceCents, listCents);
    if (discountPct == null || discountPct < opts.minDiscount) continue;

    const updatedAtMs = Number.isFinite(Date.parse(String(tracked?.last_seen_at ?? "")))
      ? Date.parse(String(tracked?.last_seen_at))
      : 0;

    candidates.push({
      asin,
      title: tracked?.title ?? existing?.title ?? bucketed?.title ?? asin,
      artist: tracked?.artist ?? existing?.artist ?? null,
      image_url: tracked?.image_url ?? existing?.image_url ?? bucketed?.image_url ?? null,
      amazon_url: tracked?.amazon_url ?? buildAmazonUrl(asin),
      price_cents: priceCents,
      list_price_cents: listCents,
      currency: latest?.currency ?? bucketed?.currency ?? existing?.currency ?? null,
      discount_pct: discountPct,
      updated_at_ms: updatedAtMs,
    });

    addDiscountBandCount(candidateDiscountBands, discountPct);
  }

  if (!candidates.length) {
    return {
      attempted_rows: asins.length,
      candidate_rows: 0,
      candidate_discount_bands: candidateDiscountBands,
      kept_discount_bands: keptDiscountBands,
      rows: [] as DealRow[],
    };
  }

  candidates.sort((a, b) => {
    if (b.discount_pct !== a.discount_pct) return b.discount_pct - a.discount_pct;
    if (b.updated_at_ms !== a.updated_at_ms) return b.updated_at_ms - a.updated_at_ms;
    return a.asin.localeCompare(b.asin);
  });

  const startIndex = opts.offset % candidates.length;
  const ordered = candidates.slice(startIndex).concat(candidates.slice(0, startIndex));

  const rows: DealRow[] = [];
  for (const c of ordered) {
    rows.push({
      asin: c.asin,
      title: c.title,
      artist: c.artist,
      image_url: c.image_url,
      amazon_url: c.amazon_url,
      price_cents: c.price_cents,
      list_price_cents: c.list_price_cents,
      currency: c.currency,
      discount_pct: Math.round(c.discount_pct * 10) / 10,
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

    addDiscountBandCount(keptDiscountBands, c.discount_pct);
    if (rows.length >= opts.limit) break;
  }

  return {
    attempted_rows: asins.length,
    candidate_rows: candidates.length,
    candidate_discount_bands: candidateDiscountBands,
    kept_discount_bands: keptDiscountBands,
    rows,
  };
}

async function bootstrapFromBucketedDeals(opts: {
  mediaType: MediaConfig["media_type"];
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
  now: string;
  syncId: string;
  existingDealsByAsin: Map<string, ExistingDealSnapshot>;
  supabase: any;
  preferDiscountDiversity?: boolean;
}) {
  const baseScanWindow = 5000;
  const highDiscountScanWindow = 5000;

  const selectCols =
    "asin,title,image_url,price_cents,list_price_cents,currency,discount_pct,discount_bucket,sales_rank,updated_at,media_type";

  const recentQuery = opts.supabase
    .from("deals_bucketed")
    .select(selectCols)
    .eq("media_type", opts.mediaType)
    .gte("discount_pct", opts.minDiscount)
    .order("updated_at", { ascending: false })
    .range(0, baseScanWindow - 1);

  const { data: recentRows, error: recentError } = await recentQuery;
  if (recentError) throw new Error(recentError.message);

  let allRows = recentRows ?? [];

  if (opts.preferDiscountDiversity) {
    const { data: highRows, error: highError } = await opts.supabase
      .from("deals_bucketed")
      .select(selectCols)
      .eq("media_type", opts.mediaType)
      .gte("discount_pct", Math.max(opts.minDiscount, 20))
      .order("discount_pct", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(0, highDiscountScanWindow - 1);

    if (highError) throw new Error(highError.message);
    if ((highRows ?? []).length) {
      allRows = [...(highRows ?? []), ...allRows];
    }
  }
  const candidatePool: Array<{
    asin: string;
    title: string;
    image_url: string | null;
    price_cents: number;
    list_price_cents: number | null;
    currency: string | null;
    discount_pct: number;
    sales_rank: number | null;
    updated_at_ms: number;
    existing: ExistingDealSnapshot | undefined;
  }> = [];
  const candidateDiscountBands = createDiscountBandCounts();
  const selectedDiscountBands = createDiscountBandCounts();

  const seenCandidates = new Set<string>();

  for (const row of allRows) {
    const asin = row?.asin ? String(row.asin) : "";
    if (!asin || seenCandidates.has(asin)) continue;
    seenCandidates.add(asin);

    const existing = opts.existingDealsByAsin.get(asin);

    const rowPrice = Number(row?.price_cents);
    if (!Number.isFinite(rowPrice) || rowPrice <= 0) continue;
    const priceCents = Math.round(rowPrice);

    const rowList = Number(row?.list_price_cents);
    let listCents = Number.isFinite(rowList) && rowList > 0 ? Math.round(rowList) : null;

    let discountPct: number | null = normalizeDiscountPct(row?.discount_pct);

    if (discountPct == null) discountPct = parseDiscountBucketEstimate(row?.discount_bucket);
    if (discountPct == null) discountPct = computeDiscountPct(priceCents, listCents);

    if (discountPct == null || !Number.isFinite(discountPct) || discountPct < opts.minDiscount) continue;

    if ((listCents == null || listCents <= priceCents) && discountPct > 0 && discountPct < 100) {
      const inferredList = Math.round(priceCents / (1 - discountPct / 100));
      if (Number.isFinite(inferredList) && inferredList > priceCents) listCents = inferredList;
    }

    if (listCents != null && listCents <= priceCents) {
      listCents = null;
    }

    const rankRaw = Number(row?.sales_rank);
    const updatedAtMs = Number.isFinite(Date.parse(String(row?.updated_at ?? "")))
      ? Date.parse(String(row?.updated_at))
      : 0;

    candidatePool.push({
      asin,
      title: row?.title ?? existing?.title ?? asin,
      image_url: row?.image_url ?? existing?.image_url ?? null,
      price_cents: priceCents,
      list_price_cents: listCents,
      currency: row?.currency ?? existing?.currency ?? null,
      discount_pct: Math.round(discountPct * 10) / 10,
      sales_rank: Number.isFinite(rankRaw) ? Math.round(rankRaw) : null,
      updated_at_ms: updatedAtMs,
      existing,
    });
    addDiscountBandCount(candidateDiscountBands, discountPct);
  }

  if (!candidatePool.length) {
    return {
      attempted_rows: allRows.length,
      candidate_rows: 0,
      candidate_discount_bands: candidateDiscountBands,
      kept_discount_bands: selectedDiscountBands,
      rows: [] as DealRow[],
    };
  }

  candidatePool.sort((a, b) => {
    if (b.discount_pct !== a.discount_pct) return b.discount_pct - a.discount_pct;
    if (b.updated_at_ms !== a.updated_at_ms) return b.updated_at_ms - a.updated_at_ms;
    return a.asin.localeCompare(b.asin);
  });

  const startIndex = opts.offset % candidatePool.length;
  const ordered = candidatePool.slice(startIndex).concat(candidatePool.slice(0, startIndex));

  const rows: DealRow[] = [];
  for (const c of ordered) {
    rows.push({
      asin: c.asin,
      title: c.title,
      artist: c.existing?.artist ?? null,
      image_url: c.image_url,
      amazon_url: buildAmazonUrl(c.asin),
      price_cents: c.price_cents,
      list_price_cents: c.list_price_cents,
      currency: c.currency,
      discount_pct: c.discount_pct,
      category: "media",
      media_type: opts.mediaType,
      feed_key: opts.feedKey,
      sales_rank: c.sales_rank,
      genre: null,
      browse_node_id: null,
      updated_at: opts.now,
      last_seen_at: opts.now,
      sync_id: opts.syncId,
    });
    addDiscountBandCount(selectedDiscountBands, c.discount_pct);

    if (rows.length >= opts.limit) break;
  }

  return {
    attempted_rows: allRows.length,
    candidate_rows: candidatePool.length,
    candidate_discount_bands: candidateDiscountBands,
    kept_discount_bands: selectedDiscountBands,
    rows,
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
  const bootstrapReserveMs = Math.min(
    Math.max(Number(url.searchParams.get("bootstrapReserveMs") ?? "25000"), 5000),
    Math.floor(requestBudgetMs * 0.6)
  );
  const historyLookbackDays = Math.max(
    7,
    Math.min(Number(url.searchParams.get("historyLookbackDays") ?? "120"), 365)
  );

  const bootstrapLimit = Math.min(
    Math.max(Number(url.searchParams.get("bootstrapLimit") ?? "120"), 20),
    400
  );
  const sourceOffset = Math.max(
    0,
    Number(url.searchParams.get("moviesOffset") ?? url.searchParams.get("catalogOffset") ?? "0")
  );
  const sourcePerRun = Math.max(
    1,
    Number(url.searchParams.get("moviesPerRun") ?? url.searchParams.get("catalogPerRun") ?? "10")
  );
  const sourceChunkIndex = Math.floor(sourceOffset / sourcePerRun);
  const bootstrapOffsetParam = Number(url.searchParams.get("bootstrapOffset") ?? "NaN");
  const bootstrapOffset = Number.isFinite(bootstrapOffsetParam)
    ? Math.max(0, bootstrapOffsetParam)
    : sourceChunkIndex * bootstrapLimit;

  const revalidateActive = ["1", "true", "yes"].includes(
    String(url.searchParams.get("revalidateActive") ?? "").toLowerCase()
  );
  const activeLimit = Math.min(Math.max(Number(url.searchParams.get("activeLimit") ?? "300"), 1), 1000);
  const activeOffset = Math.max(0, Number(url.searchParams.get("activeOffset") ?? "0"));
  const revalidateOnlyParam = String(url.searchParams.get("revalidateOnly") ?? "").toLowerCase();
  const revalidateOnly = revalidateActive && ["1", "true", "yes"].includes(revalidateOnlyParam);
  const activeIncludeAll = ["1", "true", "yes"].includes(
    String(url.searchParams.get("activeIncludeAll") ?? "").toLowerCase()
  );
  const degradedAsWarningParam = String(
    url.searchParams.get("degradedAsWarning") ?? ""
  )
    .toLowerCase()
    .trim();

  const degradedAsWarning = degradedAsWarningParam
    ? ["1", "true", "yes"].includes(degradedAsWarningParam)
    : config.media_type === "4k-uhd" && mode === "discount";

  const now = new Date().toISOString();
  const syncId = randomUUID();
  const requestStartedAtMs = Date.now();
  const requestElapsedMs = () => Date.now() - requestStartedAtMs;
  const budgetExceeded = () => requestElapsedMs() >= requestBudgetMs;
  const searchBudgetExceeded =
    mode === "discount"
      ? () => requestElapsedMs() >= requestBudgetMs - bootstrapReserveMs
      : budgetExceeded;
  let stoppedEarlyReason: string | null = null;

  const seen = new Set<string>();
  const attemptedAsins = new Set<string>();
  const keep: DealRow[] = [];
  const errors: any[] = [];
  const trackedSnapshots = new Map<string, TrackedAsinSnapshot>();

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
    bootstrap_reserve_ms: bootstrapReserveMs,
    history_lookback_days: historyLookbackDays,
    bootstrap_limit: bootstrapLimit,
    bootstrap_offset: bootstrapOffset,
    keywords: config.keywords.length,
    items_returned: 0,
    candidate_items_considered: 0,
    candidate_items_with_price: 0,
    getitems_chunks_requested: 0,
    getitems_items_returned: 0,
    getitems_items_with_price: 0,
    getitems_items_with_offer_payload: 0,
    getitems_items_without_offer_payload: 0,
    getitems_offer_shape_sample: null as any,
    skipped_already_attempted_asin: 0,
    items_with_discount_data: 0,
    filtered_under_min_discount: 0,
    filtered_over_max_price: 0,
    filtered_wrong_media: 0,
    fallback_existing_list_used: 0,
    fallback_existing_price_used: 0,
    fallback_existing_discount_used: 0,
    fallback_bucketed_price_used: 0,
    fallback_bucketed_discount_used: 0,
    fallback_history_baseline_used: 0,
    fallback_history_price_used: 0,
    pricing_refetched_getitems: 0,
    tracked_asins_upserted: 0,
    kept: 0,
    db_sync_rows_after_upsert: null as number | null,
    db_feedkey_integrity_warning: null as string | null,
    stopped_early_reason: null as string | null,
    request_elapsed_ms: null as number | null,
    revalidate_active: null as any,
    active_include_all: activeIncludeAll,
    bootstrap_from_existing: null as any,
    bootstrap_from_tracked: null as any,
    bootstrap_from_history_pool: null as any,
    bootstrap_from_bucketed: null as any,
    paapi_associate_not_eligible: false,
    paapi_associate_not_eligible_hits: 0,
    degraded_no_live_pricing: false,
    degraded_reason: null as string | null,
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
        discount_pct: normalizeDiscountPct(row.discount_pct),
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
          includeAll: activeIncludeAll,
        });
      } catch (e: any) {
        stats.revalidate_active = { ok: false, error: e?.message ?? String(e) };
      }

      if (containsAssociateNotEligible(stats.revalidate_active)) {
        stats.paapi_associate_not_eligible = true;
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
        if (searchBudgetExceeded()) {
          stoppedEarlyReason = "request_budget_exceeded_during_search";
          break keywordLoop;
        }

        let items: any[] = [];

        try {
          items = await withRetry(() =>
            paapiSearch({ keyword: kw, itemPage: page, searchIndex: config.searchIndex })
          );
        } catch (e: any) {
          const paapiErr = extractAxiosError(e);
          errors.push({ keyword: kw, page, error: paapiErr });
          if (isAssociateNotEligibleError(paapiErr)) {
            stats.paapi_associate_not_eligible = true;
            stats.paapi_associate_not_eligible_hits += 1;
            stoppedEarlyReason = "paapi_associate_not_eligible";
            break keywordLoop;
          }
          break;
        }

        stats.items_returned += items.length;
        if (!items.length) break;

        let historyBaselineByAsin = new Map<string, number>();
        if (mode === "discount") {
          historyBaselineByAsin = await loadRecentPriceBaselines({
            supabase,
            asins: (items ?? []).map((it) => String(it?.ASIN ?? "")).filter(Boolean),
            lookbackDays: historyLookbackDays,
            includeAllTimeFallback: true,
          });
        }

        const candidateAsins: string[] = [];
        const searchItemByAsin = new Map<string, any>();
        const pricingByAsin = new Map<string, CurrentPricing>();
        const asinsForGetItems: string[] = [];

        for (const item of items) {
          const asin = item?.ASIN ? String(item.ASIN) : "";

          if (!asin) continue;
          if (attemptedAsins.has(asin)) {
            stats.skipped_already_attempted_asin += 1;
            continue;
          }
          if (seen.has(asin) || searchItemByAsin.has(asin)) continue;

          if (!itemMatchesMediaType(config.media_type, item)) {
            stats.filtered_wrong_media += 1;
            continue;
          }

          const trackedSnapshot = buildTrackedSnapshot(item);
          if (trackedSnapshot) trackedSnapshots.set(trackedSnapshot.asin, trackedSnapshot);

          attemptedAsins.add(asin);
          candidateAsins.push(asin);
          stats.candidate_items_considered += 1;
          searchItemByAsin.set(asin, item);

          const pricing = extractCurrentPricing(item);
          pricingByAsin.set(asin, pricing);
          if (pricing.priceCents != null) stats.candidate_items_with_price += 1;
          if (mode === "discount" || pricing.priceCents == null) asinsForGetItems.push(asin);
        }

        let refetchedWithGetItems = 0;
        if (asinsForGetItems.length) {
          const pricingChunks: string[][] = [];
          for (let i = 0; i < asinsForGetItems.length; i += ITEM_COUNT) {
            pricingChunks.push(asinsForGetItems.slice(i, i + ITEM_COUNT));
          }
          stats.getitems_chunks_requested += pricingChunks.length;

          for (const chunk of pricingChunks) {
            if (searchBudgetExceeded()) {
              stoppedEarlyReason = "request_budget_exceeded_during_getitems_pricing";
              break;
            }

            let fullItems: any[] = [];
            try {
              fullItems = await withRetry(() => paapiGetItems(chunk));
            } catch (e: any) {
              const paapiErr = extractAxiosError(e);
              errors.push({ asins: chunk, error: paapiErr });
              if (isAssociateNotEligibleError(paapiErr)) {
                stats.paapi_associate_not_eligible = true;
                stats.paapi_associate_not_eligible_hits += 1;
              }
              continue;
            }

            stats.getitems_items_returned += fullItems.length;

            const fullByAsin = new Map<string, any>();
            for (const full of fullItems ?? []) {
              if (full?.ASIN) fullByAsin.set(String(full.ASIN), full);
            }

            for (const asin of chunk) {
              const full = fullByAsin.get(asin);
              if (!full) continue;

              const fullListings = getOfferListings(full);
              const fullSummaries = getOfferSummaries(full);
              if (fullListings.length || fullSummaries.length) {
                stats.getitems_items_with_offer_payload += 1;
              } else {
                stats.getitems_items_without_offer_payload += 1;
              }

              if (!stats.getitems_offer_shape_sample) {
                const offersRoot = full?.Offers ?? full?.OffersV2 ?? null;
                stats.getitems_offer_shape_sample = {
                  asin,
                  has_offers: Boolean(offersRoot),
                  has_offers_v2: Boolean(full?.OffersV2),
                  top_level_keys: Object.keys(full ?? {}).slice(0, 20),
                  offers_root_keys:
                    offersRoot && typeof offersRoot === "object" ? Object.keys(offersRoot).slice(0, 20) : [],
                  listing_count: fullListings.length,
                  summary_count: fullSummaries.length,
                  listing_sample_keys: fullListings.length ? Object.keys(fullListings[0] ?? {}).slice(0, 20) : [],
                  summary_sample_keys: fullSummaries.length ? Object.keys(fullSummaries[0] ?? {}).slice(0, 20) : [],
                };
              }

              const fullPricing = extractCurrentPricing(full);
              if (fullPricing.priceCents != null) {
                pricingByAsin.set(asin, fullPricing);
                refetchedWithGetItems += 1;
                stats.getitems_items_with_price += 1;
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

              const fullSnapshot = buildTrackedSnapshot(full);
              if (fullSnapshot) trackedSnapshots.set(fullSnapshot.asin, fullSnapshot);
            }
          }
        }

        stats.pricing_refetched_getitems =
          (stats.pricing_refetched_getitems ?? 0) + refetchedWithGetItems;

        const historyLatestByAsin = await loadLatestPriceSnapshots({
          supabase,
          asins: candidateAsins,
          lookbackHours: 72,
          includeAllTimeFallback: true,
        });

        const bucketedByAsin =
          config.media_type === "4k-uhd"
            ? await loadBucketedSnapshots({
                supabase,
                asins: candidateAsins,
                mediaType: config.media_type,
              })
            : new Map<string, {
                price_cents: number | null;
                list_price_cents: number | null;
                currency: string | null;
                discount_pct: number | null;
                title: string | null;
                image_url: string | null;
              }>();

        for (const asin of candidateAsins) {
          const item = searchItemByAsin.get(asin);
          if (!item) continue;

          const existing = existingDealsByAsin.get(asin);
          const bucketed = bucketedByAsin.get(asin);
          const pricing = pricingByAsin.get(asin) ?? extractCurrentPricing(item);
          let priceCents = pricing.priceCents;

          const historyLatest = historyLatestByAsin.get(asin);
          if (priceCents == null && historyLatest) {
            priceCents = historyLatest.price_cents;
            stats.fallback_history_price_used += 1;
          }

          if (priceCents == null && existing?.price_cents != null) {
            priceCents = existing.price_cents;
            stats.fallback_existing_price_used += 1;
          }

          if (priceCents == null && bucketed?.price_cents != null) {
            priceCents = bucketed.price_cents;
            stats.fallback_bucketed_price_used += 1;
          }

          if (priceCents == null) continue;

          let listCents = pricing.listCents ?? existing?.list_price_cents ?? null;
          if (listCents == null && historyLatest) {
            listCents = historyLatest.list_price_cents ?? null;
          }
          if (listCents == null && bucketed?.list_price_cents != null) {
            listCents = bucketed.list_price_cents;
          }
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

          const existingBaseline = Math.max(
            Number(existing?.list_price_cents ?? 0),
            Number(existing?.price_cents ?? 0)
          );
          if (discountPct == null && Number.isFinite(existingBaseline) && existingBaseline > priceCents) {
            const existingDiscount = computeDiscountPct(priceCents, existingBaseline);
            if (existingDiscount != null) {
              discountPct = existingDiscount;
              listCents = Math.max(listCents ?? 0, existingBaseline);
              stats.fallback_existing_discount_used += 1;
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
            const bucketedDiscountPct = normalizeDiscountPct(bucketed?.discount_pct);

            if (
              (discountPct == null || discountPct < minDiscount) &&
              bucketedDiscountPct != null &&
              bucketedDiscountPct >= minDiscount &&
              bucketed?.price_cents != null &&
              priceCents <= bucketed.price_cents
            ) {
              discountPct = bucketedDiscountPct;
              stats.fallback_bucketed_discount_used += 1;
              if ((bucketed.list_price_cents ?? 0) > (listCents ?? 0)) {
                listCents = bucketed.list_price_cents;
              }
            }

            if (
              (discountPct == null || discountPct < minDiscount) &&
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
            amazon_url: buildAmazonUrl(asin),
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

    if (trackedSnapshots.size) {
      try {
        const trackedUpsert = await upsertTrackedAsinsChunked({
          mediaType: config.media_type,
          rows: Array.from(trackedSnapshots.values()),
          nowIso: now,
        });
        stats.tracked_asins_upserted = trackedUpsert.upserted;
      } catch (e: any) {
        errors.push({
          kind: "tracked_asins_upsert_failed",
          error: e?.message ?? String(e),
        });
      }
    }

    if (!stats.paapi_associate_not_eligible && containsAssociateNotEligible(errors)) {
      stats.paapi_associate_not_eligible = true;
    }

    const degradedNoLivePricing =
      config.media_type === "4k-uhd" &&
      mode === "discount" &&
      Number(stats.items_returned ?? 0) > 0 &&
      Number(stats.getitems_items_with_price ?? 0) === 0;

    if (degradedNoLivePricing) {
      stats.degraded_no_live_pricing = true;
      const getitemsChunksRequested = Number(stats.getitems_chunks_requested ?? 0);
      const getitemsItemsReturned = Number(stats.getitems_items_returned ?? 0);
      const getitemsWithoutOffer = Number(stats.getitems_items_without_offer_payload ?? 0);

      stats.degraded_reason =
        getitemsChunksRequested > 0 && getitemsItemsReturned === 0
          ? "items_returned_but_getitems_returned_zero_items"
          : getitemsWithoutOffer > 0
            ? "items_returned_without_offer_payload"
            : "items_returned_without_live_getitems_pricing";

      if (!stoppedEarlyReason) {
        stoppedEarlyReason = "degraded_no_live_pricing";
      }
    }

    const preferBucketedRecoveryFor4k =
      config.media_type === "4k-uhd" &&
      Number(stats.candidate_items_with_price ?? 0) === 0 &&
      Number(stats.getitems_items_with_price ?? 0) === 0;

    if (preferBucketedRecoveryFor4k && keep.length > 0) {
      stats.discarded_keep_without_live_pricing = keep.length;
      keep.length = 0;
      seen.clear();
      stats.kept = 0;
    }

    if (mode === "discount" && keep.length === 0) {
      if (preferBucketedRecoveryFor4k) {
        stats.bootstrap_from_existing = {
          skipped: true,
          reason: "prefer_bucketed_recovery_4k_no_live_pricing",
        };
        stats.bootstrap_from_tracked = {
          skipped: true,
          reason: "prefer_bucketed_recovery_4k_no_live_pricing",
        };
      } else if (budgetExceeded()) {
        const historyBootstrap = await bootstrapFromExistingHistoryOnly({
          mediaType: config.media_type,
          feedKey,
          minDiscount,
          limit: bootstrapLimit,
          offset: bootstrapOffset,
          now,
          syncId,
          historyLookbackDays,
          existingDealsByAsin,
          supabase,
        });

        let keptFromHistory = 0;
        if (historyBootstrap.rows.length) {
          for (const row of historyBootstrap.rows) {
            if (seen.has(row.asin)) continue;
            keep.push(row);
            seen.add(row.asin);
            stats.kept += 1;
            stats.fallback_history_price_used += 1;
            keptFromHistory += 1;
          }
        }

        stats.bootstrap_from_existing = {
          attempted_asins: historyBootstrap.attempted_asins,
          kept: keptFromHistory,
          rows_returned: historyBootstrap.rows.length,
          fallback_history_rows_used: historyBootstrap.fallback_history_rows_used,
          reason: "history_only_after_budget_exceeded",
          fallback_bucketed_rows_used: historyBootstrap.fallback_bucketed_rows_used,
        };

        stats.bootstrap_from_tracked = {
          skipped: true,
          reason: keep.length > 0 ? "history_bootstrap_returned_rows" : "history_bootstrap_returned_no_rows",
        };
      } else {
        const bootstrap = await bootstrapFromExistingDeals({
          mediaType: config.media_type,
          feedKey,
          minDiscount,
          limit: bootstrapLimit,
          offset: bootstrapOffset,
          now,
          syncId,
          historyLookbackDays,
          existingDealsByAsin,
          supabase,
        });

        let keptFromExisting = 0;
        if (bootstrap.rows.length) {
          for (const row of bootstrap.rows) {
            if (seen.has(row.asin)) continue;
            keep.push(row);
            seen.add(row.asin);
            stats.kept += 1;
            keptFromExisting += 1;
          }
        }

        stats.bootstrap_from_existing = {
          attempted_asins: bootstrap.attempted_asins,
          kept: keptFromExisting,
          rows_returned: bootstrap.rows.length,
          fallback_existing_discount_used: bootstrap.fallback_existing_discount_used,
          fallback_existing_price_used: bootstrap.fallback_existing_price_used,
          fallback_history_baseline_used: bootstrap.fallback_history_baseline_used,
          fallback_without_live_item: bootstrap.fallback_without_live_item,
          errors: bootstrap.errors.length,
        };

        if (bootstrap.errors.length) {
          errors.push(...bootstrap.errors);
        }

        if (keep.length === 0) {
          if (budgetExceeded()) {
            stats.bootstrap_from_tracked = {
              skipped: true,
              reason: "request_budget_exceeded_before_tracked_bootstrap",
            };
          } else {
            try {
              const trackedBootstrap = await bootstrapFromTrackedAsins({
                mediaType: config.media_type,
                feedKey,
                minDiscount,
                limit: bootstrapLimit,
                offset: bootstrapOffset,
                now,
                syncId,
                historyLookbackDays,
                existingDealsByAsin,
                supabase,
              });

              let keptFromTracked = 0;
              if (trackedBootstrap.rows.length) {
                for (const row of trackedBootstrap.rows) {
                  if (seen.has(row.asin)) continue;
                  keep.push(row);
                  seen.add(row.asin);
                  stats.kept += 1;
                  keptFromTracked += 1;
                }
              }

              stats.bootstrap_from_tracked = {
                attempted_asins: trackedBootstrap.attempted_asins,
                kept: keptFromTracked,
                rows_returned: trackedBootstrap.rows.length,
                fallback_existing_discount_used: trackedBootstrap.fallback_existing_discount_used,
                fallback_existing_price_used: trackedBootstrap.fallback_existing_price_used,
                fallback_history_baseline_used: trackedBootstrap.fallback_history_baseline_used,
                fallback_without_live_item: trackedBootstrap.fallback_without_live_item,
                errors: trackedBootstrap.errors.length,
              };

              if (trackedBootstrap.errors.length) {
                errors.push(...trackedBootstrap.errors);
              }
            } catch (e: any) {
              stats.bootstrap_from_tracked = {
                ok: false,
                error: e?.message ?? String(e),
              };
            }
          }
        } else {
          stats.bootstrap_from_tracked = {
            skipped: true,
            reason: "existing_bootstrap_returned_rows",
          };
        }
      }
    }

    if (
      mode === "discount" &&
      keep.length === 0 &&
      config.media_type === "4k-uhd" &&
      stats.paapi_associate_not_eligible
    ) {
      try {
        const historyPoolBootstrap = await bootstrapFromTrackedHistoryPool({
          mediaType: config.media_type,
          feedKey,
          minDiscount,
          limit: bootstrapLimit,
          offset: bootstrapOffset,
          now,
          syncId,
          historyLookbackDays,
          existingDealsByAsin,
          supabase,
        });

        let keptFromHistoryPool = 0;
        if (historyPoolBootstrap.rows.length) {
          for (const row of historyPoolBootstrap.rows) {
            if (seen.has(row.asin)) continue;
            keep.push(row);
            seen.add(row.asin);
            stats.kept += 1;
            stats.fallback_history_price_used += 1;
            keptFromHistoryPool += 1;
          }
        }

        stats.bootstrap_from_history_pool = {
          attempted_rows: historyPoolBootstrap.attempted_rows,
          candidate_rows: historyPoolBootstrap.candidate_rows,
          candidate_discount_bands: historyPoolBootstrap.candidate_discount_bands,
          kept_discount_bands: historyPoolBootstrap.kept_discount_bands,
          rows_returned: historyPoolBootstrap.rows.length,
          kept: keptFromHistoryPool,
          offset: bootstrapOffset,
          limit: bootstrapLimit,
          reason: "history_pool_recovery_after_paapi_ineligible",
        };
      } catch (e: any) {
        stats.bootstrap_from_history_pool = {
          ok: false,
          error: e?.message ?? String(e),
        };
      }
    }

    if (mode === "discount" && keep.length === 0 && config.media_type === "4k-uhd") {
      if (degradedNoLivePricing && !degradedAsWarning) {
        stats.bootstrap_from_bucketed = {
          skipped: true,
          reason: "disabled_due_to_degraded_no_live_pricing",
        };
      } else {
        try {
          const bucketedBootstrap = await bootstrapFromBucketedDeals({
            mediaType: config.media_type,
            feedKey,
            minDiscount,
            limit: bootstrapLimit,
            offset: bootstrapOffset,
            now,
            syncId,
            existingDealsByAsin,
            supabase,
            preferDiscountDiversity: Boolean(stats.paapi_associate_not_eligible),
          });

          let keptFromBucketed = 0;
          if (bucketedBootstrap.rows.length) {
            for (const row of bucketedBootstrap.rows) {
              if (seen.has(row.asin)) continue;
              keep.push(row);
              seen.add(row.asin);
              stats.kept += 1;
              stats.fallback_bucketed_price_used += 1;
              if (row.discount_pct != null) stats.fallback_bucketed_discount_used += 1;
              keptFromBucketed += 1;
            }
          }

          stats.bootstrap_from_bucketed = {
            attempted_rows: bucketedBootstrap.attempted_rows,
            candidate_rows: bucketedBootstrap.candidate_rows,
            candidate_discount_bands: bucketedBootstrap.candidate_discount_bands,
            kept_discount_bands: bucketedBootstrap.kept_discount_bands,
            rows_returned: bucketedBootstrap.rows.length,
            kept: keptFromBucketed,
            offset: bootstrapOffset,
            limit: bootstrapLimit,
            reason: degradedNoLivePricing
              ? "bucketed_recovery_during_degraded_no_live_pricing"
              : "bucketed_recovery_after_empty_discovery",
          };
        } catch (e: any) {
          stats.bootstrap_from_bucketed = {
            ok: false,
            error: e?.message ?? String(e),
          };
        }
      }
    }

    stats.stopped_early_reason = stoppedEarlyReason;
    stats.request_elapsed_ms = requestElapsedMs();

    if (degradedNoLivePricing) {
      const allowDegradedWarning = degradedAsWarning && keep.length > 0;

      if (!allowDegradedWarning && keep.length > 0) {
        stats.discarded_keep_without_live_pricing =
          Number(stats.discarded_keep_without_live_pricing ?? 0) + keep.length;
        keep.length = 0;
        seen.clear();
        stats.kept = 0;
      }

      const degradedError =
        `degraded_no_live_pricing: ${String(stats.degraded_reason ?? "items_returned_without_live_getitems_pricing")}`;

      if (allowDegradedWarning) {
        keep.sort((a, b) => (a.sales_rank ?? 1e12) - (b.sales_rank ?? 1e12));

        let saved = 0;
        if (keep.length) {
          await upsertChunked(keep);
          saved = keep.length;
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
                error: degradedError,
                stats,
                errors,
              })
              .eq("id", runId);
          } catch {}
        }

        return Response.json({
          ok: true,
          warning: degradedError,
          degraded_no_live_pricing: true,
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
      }

      if (runId) {
        try {
          await supabase
            .from("refresh_runs")
            .update({
              ok: false,
              finished_at: new Date().toISOString(),
              found: 0,
              saved: 0,
              error: degradedError,
              stats,
              errors,
            })
            .eq("id", runId);
        } catch {}
      }

      return Response.json(
        {
          ok: false,
          error: degradedError,
          media_type: config.media_type,
          feed_key: feedKey,
          mode,
          min_discount: minDiscount,
          max_price_cents: maxPriceCents,
          maxPages,
          delayMs,
          found: 0,
          saved: 0,
          build_id: BUILD_ID,
          sync_id: syncId,
          stats,
          errors,
        },
        { status: 503 }
      );
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
