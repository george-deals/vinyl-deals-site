import axios from "axios";
import aws4 from "aws4";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUILD_ID = "vinyl-reseed-2026-02-10";
const ITEM_COUNT = 10; // PA-API GetItems max ItemIds is 10

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

function extractAxiosError(e: any) {
  const status = e?.response?.status ?? null;
  const data = e?.response?.data ?? null;
  const message = data?.Errors?.[0]?.Message ?? data?.message ?? e?.message ?? "Unknown error";
  const code = data?.Errors?.[0]?.Code ?? null;
  return { status, code, message };
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

function pickBuyBoxListingOnly(item: any) {
  const listings: any[] = item?.Offers?.Listings ?? [];
  if (!listings.length) return null;

  const buyBox = listings.find((l) => l?.IsBuyBoxWinner);
  if (!buyBox) return null;

  const priceCents = toCents(buyBox?.Price?.Amount);
  if (!priceCents) return null;

  return buyBox;
}

async function paapiGetItems(asins: string[]) {
  const host = process.env.AMAZON_HOST!;
  const region = process.env.AMAZON_REGION!;
  const accessKey = process.env.AMAZON_ACCESS_KEY!;
  const secretKey = process.env.AMAZON_SECRET_KEY!;
  const partnerTag = process.env.AMAZON_PARTNER_TAG!;

  const body = {
    ItemIds: asins,
    ItemIdType: "ASIN",
    Condition: "New",
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Resources: [
      "ItemInfo.Title",
      "ItemInfo.ByLineInfo",
      "Images.Primary.Large",
      "Offers.Listings.Price",
      "Offers.Listings.SavingBasis",
      "Offers.Listings.ListPrice",
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

async function upsertChunked(rows: any[]) {
  if (!rows.length) return 0;
  const supabase = getSupabaseAdmin();
  const CHUNK = 500;
  let saved = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("deals").upsert(chunk, {
      onConflict: "media_type,feed_key,asin",
    });
    if (error) throw new Error(error.message);
    saved += chunk.length;
  }

  return saved;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = searchParams.get("token");
  if (!token || token !== process.env.REFRESH_TOKEN) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const batchSize = Math.min(Math.max(Number(searchParams.get("batchSize") ?? "200"), 1), 1000);
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0"));
  const delayMs = Math.min(Math.max(Number(searchParams.get("delayMs") ?? "0"), 0), 5000);
  const minDiscount = Math.min(Math.max(Number(searchParams.get("min_discount") ?? "15"), 0), 90);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const syncId = randomUUID();

  const { data: rows, error } = await supabase
    .from("tracked_asins")
    .select("asin")
    .eq("media_type", "vinyl")
    .eq("is_active", true)
    .order("last_seen_at", { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const asins = (rows ?? []).map((r: any) => r.asin).filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += ITEM_COUNT) chunks.push(asins.slice(i, i + ITEM_COUNT));

  const keep: any[] = [];
  const errorsOut: any[] = [];
  let itemsFetched = 0;

  for (const chunk of chunks) {
    let items: any[] = [];
    try {
      items = await withRetry(() => paapiGetItems(chunk));
    } catch (e: any) {
      errorsOut.push({ asins: chunk, error: extractAxiosError(e) });
      continue;
    }

    if (!items.length) {
      errorsOut.push({ asins: chunk, error: { message: "paapi_empty_response" } });
      continue;
    }

    itemsFetched += items.length;

    for (const item of items) {
      const asin = item?.ASIN;
      if (!asin) continue;

      const listing = pickBuyBoxListingOnly(item);
      if (!listing) continue;

      const priceCents = toCents(listing?.Price?.Amount);
      if (!priceCents) continue;

      const savingsPct = Number(listing?.Price?.Savings?.Percentage);
      const savingsAmt = toCents(listing?.Price?.Savings?.Amount);
      let listCents =
        toCents(listing?.SavingBasis?.Amount) ?? toCents(listing?.ListPrice?.Amount);
      if (!listCents && savingsAmt) listCents = priceCents + savingsAmt;

      let discountPct: number | null = null;
      if (Number.isFinite(savingsPct) && savingsPct > 0) {
        discountPct = Math.round(savingsPct * 10) / 10;
      } else if (savingsAmt && listCents) {
        discountPct = Math.round((savingsAmt / listCents) * 1000) / 10;
      } else {
        discountPct = computeDiscountPct(priceCents, listCents);
      }

      if (discountPct == null || discountPct < minDiscount) continue;

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
        media_type: "vinyl",
        feed_key: "discount-15",
        sales_rank: rank,
        genre: null,
        browse_node_id: browseNodeId,
        updated_at: now,
        last_seen_at: now,
        sync_id: syncId,
      });
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  const saved = await upsertChunked(keep);

  return Response.json({
    ok: true,
    build_id: BUILD_ID,
    sync_id: syncId,
    attempted_asins: asins.length,
    itemsFetched,
    saved,
    min_discount: minDiscount,
    errors: errorsOut,
  });
}
