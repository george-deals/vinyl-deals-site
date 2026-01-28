import axios from "axios";
import aws4 from "aws4";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ITEM_COUNT = 10; // PA-API GetItems max ItemIds is 10

function toCents(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? Math.round(x * 100) : null;
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = searchParams.get("token") ?? "";
  if (!process.env.REFRESH_TOKEN || token !== process.env.REFRESH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const batchSize = Math.min(Math.max(Number(searchParams.get("batchSize") ?? "80"), 1), 500);
  const delayMs = Math.min(Math.max(Number(searchParams.get("delayMs") ?? "300"), 0), 5000);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // Pull oldest-seen first so we rotate coverage
  const { data: rows, error } = await supabase
    .from("tracked_asins")
    .select("asin")
    .eq("media_type", "vinyl")
    .eq("is_active", true)
    .order("last_seen_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const asins = (rows ?? []).map((r: any) => r.asin).filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += ITEM_COUNT) chunks.push(asins.slice(i, i + ITEM_COUNT));

  const historyRows: any[] = [];
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

    itemsFetched += items.length;

    for (const item of items) {
      const asin = item?.ASIN;
      if (!asin) continue;

      const listing = pickBuyBoxListingOnly(item);

      const priceCents = listing ? toCents(listing?.Price?.Amount) : null;
      const listCents = listing ? toCents(listing?.SavingBasis?.Amount) : null;

      historyRows.push({
        asin,
        checked_at: now,
        price_cents: priceCents,
        list_price_cents: listCents,
        currency: listing?.Price?.Currency ?? null,
        is_available: priceCents != null,
        merchant_name: listing?.MerchantInfo?.Name ?? null,
        condition: "New",
      });
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  // Insert history (append-only)
  let inserted = 0;
  if (historyRows.length) {
    const CHUNK = 500;
    for (let i = 0; i < historyRows.length; i += CHUNK) {
      const chunk = historyRows.slice(i, i + CHUNK);
      const { error: insErr } = await supabase.from("asin_price_history").insert(chunk);
      if (insErr) {
        return new Response(
          JSON.stringify({ ok: false, error: insErr.message, inserted, attempted: historyRows.length }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
      inserted += chunk.length;
    }
  }

  // Update last_seen_at for the ASINs we attempted
  if (asins.length) {
    const { error: updErr } = await supabase
      .from("tracked_asins")
      .update({ last_seen_at: now })
      .eq("media_type", "vinyl")
      .in("asin", asins);

    if (updErr) {
      // Not fatal to history collection, but worth surfacing
      errorsOut.push({ kind: "update_last_seen_at_failed", error: updErr.message });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      kind: "track_vinyl_prices",
      now,
      batchSize,
      attempted_asins: asins.length,
      itemsFetched,
      inserted,
      errors: errorsOut,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
