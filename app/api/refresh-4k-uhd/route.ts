import axios from "axios";
import aws4 from "aws4";
import { refreshMedia } from "@/lib/refreshMedia";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const PAAPI_ITEM_COUNT = 10; // PA-API GetItems max ItemIds is 10

const CORE_KEYWORDS = [
  "4k uhd",
  "ultra hd blu ray",
  "4k steelbook",
  "4k collector edition",
  "4k box set",
  "4k limited edition",
  "4k remastered",
];

function uniqClean(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => (s || "").trim()).filter(Boolean)));
}

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
  const candidate = buyBox ?? listings.find((l) => toCents(l?.Price?.Amount));
  if (!candidate) return null;

  const priceCents = toCents(candidate?.Price?.Amount);
  if (!priceCents) return null;

  return candidate;
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

  // GetItems returns items in ItemsResult.Items
  return resp.data?.ItemsResult?.Items || [];
}

async function updateDealRows(rows: any[], feedKey: string) {
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
      .eq("media_type", "4k-uhd")
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
  feedKey: string;
  minDiscount: number;
  limit: number;
  offset: number;
}) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("deals")
    .select("asin,price_cents,list_price_cents")
    .eq("media_type", "4k-uhd")
    .eq("feed_key", opts.feedKey)
    .gte("discount_pct", opts.minDiscount)
    .order("last_seen_at", { ascending: true })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (error) throw new Error(error.message);

  const byAsin = new Map<string, { price_cents: number | null; list_price_cents: number | null }>();
  for (const row of rows ?? []) {
    if (!row?.asin) continue;
    byAsin.set(row.asin, {
      price_cents: row.price_cents ?? null,
      list_price_cents: row.list_price_cents ?? null,
    });
  }

  const asins = Array.from(byAsin.keys());
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += PAAPI_ITEM_COUNT) {
    chunks.push(asins.slice(i, i + PAAPI_ITEM_COUNT));
  }

  const discountedRows: any[] = [];
  const invalidRows: any[] = [];
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
    const returned = new Set<string>();
    const isComplete = items.length >= chunk.length;

    for (const item of items) {
      const asin = item?.ASIN;
      if (!asin) continue;
      returned.add(asin);

      const listing = pickBuyBoxListingOnly(item);
      if (!listing) continue;
      const existing = byAsin.get(asin) ?? { price_cents: null, list_price_cents: null };

      let priceCents = listing ? toCents(listing?.Price?.Amount) : null;
      let listCents = listing ? toCents(listing?.SavingBasis?.Amount) : null;

      if (priceCents == null) priceCents = existing.price_cents;
      if (listCents == null) listCents = existing.list_price_cents;

      let discountPct: number | null = null;
      if (listing && priceCents != null) {
        const savingsPct = Number(listing?.Price?.Savings?.Percentage);
        if (Number.isFinite(savingsPct) && savingsPct > 0) {
          discountPct = Math.round(savingsPct * 10) / 10;
        } else {
          discountPct = computeDiscountPct(priceCents, listCents);
        }
      }

      if (discountPct != null && discountPct >= opts.minDiscount) {
        discountedRows.push({
          asin,
          media_type: "4k-uhd",
          feed_key: opts.feedKey,
          price_cents: priceCents,
          list_price_cents: listCents,
          discount_pct: discountPct,
          updated_at: now,
          last_seen_at: now,
        });
      } else {
        invalidRows.push({
          asin,
          media_type: "4k-uhd",
          feed_key: opts.feedKey,
          price_cents: priceCents,
          list_price_cents: listCents,
          discount_pct: 0,
          updated_at: now,
        });
      }
    }

    if (!isComplete) {
      errorsOut.push({ asins: chunk, error: { message: "paapi_partial_response", returned: items.length } });
      continue;
    }

    for (const asin of chunk) {
      if (returned.has(asin)) continue;
      const existing = byAsin.get(asin) ?? { price_cents: null, list_price_cents: null };
      invalidRows.push({
        asin,
        media_type: "4k-uhd",
        feed_key: opts.feedKey,
        price_cents: existing.price_cents,
        list_price_cents: existing.list_price_cents,
        discount_pct: 0,
        updated_at: now,
      });
    }
  }

  const { updated: updatedDiscounted, errors: updateDiscountedErrors } = await updateDealRows(
    discountedRows,
    opts.feedKey
  );
  const { updated: updatedInvalid, errors: updateInvalidErrors } = await updateDealRows(
    invalidRows,
    opts.feedKey
  );

  return {
    ok: true,
    attempted_asins: asins.length,
    itemsFetched,
    updated_discounted: updatedDiscounted,
    updated_invalid: updatedInvalid,
    errors: [...errorsOut, ...updateDiscountedErrors, ...updateInvalidErrors],
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = searchParams.get("token");
  if (!token || token !== process.env.REFRESH_TOKEN) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ✅ safer defaults (old was 200)
  const moviesPerRunRaw = Number(searchParams.get("moviesPerRun") ?? "25");
  const moviesOffsetRaw = searchParams.get("moviesOffset");

  // ✅ hard cap so a bad param can't create a huge run
  const PER_RUN = Math.min(Math.max(moviesPerRunRaw || 0, 0), 75);

  const moviesAll = await readArtistFile("data/movies_master.txt");

  let movieBatch: string[] = [];
  if (moviesOffsetRaw != null) {
    const moviesOffset = Number(moviesOffsetRaw ?? "0");
    const start = Math.max(0, moviesOffset);
    movieBatch = moviesAll.slice(start, start + PER_RUN);
  } else {
    const hourSeed = Math.floor(Date.now() / 3600000);
    movieBatch = rotateSlice(moviesAll, PER_RUN, hourSeed);
  }

  const movieKeywords = movieBatch.map((t) => `"${String(t).replace(/"/g, "").trim()}" 4k uhd`);

  // ✅ cap total keyword count so refreshMedia doesn't run forever
  const MAX_KEYWORDS = 80;
  const keywords = uniqClean([...CORE_KEYWORDS, ...movieKeywords]).slice(0, MAX_KEYWORDS);

  const revalidateActive = ["1", "true", "yes"].includes(
    String(searchParams.get("revalidateActive") ?? "").toLowerCase()
  );
  const activeLimit = Math.min(Math.max(Number(searchParams.get("activeLimit") ?? "300"), 1), 1000);
  const activeOffset = Math.max(0, Number(searchParams.get("activeOffset") ?? "0"));

  let revalidateStats: any = null;
  if (revalidateActive) {
    try {
      revalidateStats = await revalidateActiveDeals({
        feedKey: "discount-15",
        minDiscount: 15,
        limit: activeLimit,
        offset: activeOffset,
      });
    } catch (e: any) {
      revalidateStats = { ok: false, error: e?.message ?? String(e) };
    }
  }

  const refreshResponse = await refreshMedia(req, {
    media_type: "4k-uhd",
    searchIndex: "MoviesAndTV",
    keywords,
    feed_key: "discount-15",
    mode: "discount",
    min_discount: 15,
  });

  const refreshBody = await refreshResponse.json();
  return Response.json(
    {
      ...refreshBody,
      revalidate_active: revalidateStats,
    },
    { status: refreshResponse.status }
  );
}
