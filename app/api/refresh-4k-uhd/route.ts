import axios from "axios";
import aws4 from "aws4";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type DealRow = {
  asin: string;
  title: string;
  image_url: string | null;
  amazon_url: string;
  price_cents: number | null;
  list_price_cents: number | null;
  currency: string | null;
  discount_pct: number | null;
  is_under_20: boolean;
  category: string; // "media"
  media_type: string; // "4k-uhd"
  sales_rank: number | null;
  updated_at: string;
};

function toCents(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  if (x <= 0) return null;
  return Math.round(x * 100);
}

function safeNum(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function computeDiscountPct(priceCents: number | null, listCents: number | null): number | null {
  if (priceCents == null || listCents == null) return null;
  if (listCents <= 0 || priceCents <= 0) return null;
  if (priceCents >= listCents) return null;
  return Math.round(((listCents - priceCents) / listCents) * 1000) / 10;
}

async function paapiSearch(keyword: string) {
  const host = process.env.AMAZON_HOST!;
  const region = process.env.AMAZON_REGION!;
  const accessKey = process.env.AMAZON_ACCESS_KEY!;
  const secretKey = process.env.AMAZON_SECRET_KEY!;
  const partnerTag = process.env.AMAZON_PARTNER_TAG!;

  const url = `https://${host}/paapi5/searchitems`;

  const body = {
    Keywords: keyword,
    SearchIndex: "MoviesAndTV",
    ItemCount: 10,
    Condition: "New",
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Resources: [
      "ItemInfo.Title",
      "Images.Primary.Large",
      "Offers.Listings.Price",
      "Offers.Listings.SavingBasis",
      "Offers.Listings.Availability.Message",
      "BrowseNodeInfo.WebsiteSalesRank",
    ],
  };

  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "content-encoding": "amz-1.0",
    host,
    "x-amz-target": "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
  };

  const signed = aws4.sign(
    {
      host,
      method: "POST",
      path: "/paapi5/searchitems",
      service: "ProductAdvertisingAPI",
      region,
      headers,
      body: JSON.stringify(body),
    },
    { accessKeyId: accessKey, secretAccessKey: secretKey }
  );

  const axiosHeaders: Record<string, string> = {};
for (const [k, v] of Object.entries(signed.headers || {})) {
  if (typeof v === "string") axiosHeaders[k] = v;
}

const resp = await axios.post(url, signed.body, {
  headers: axiosHeaders,
  timeout: 15000,
  validateStatus: () => true,
});


  return { status: resp.status, data: resp.data };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const token = url.searchParams.get("token");
  if (!token || token !== process.env.REFRESH_TOKEN) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 4K UHD keywords
  const keywords = ["4K UHD", "Ultra HD Blu-ray", "4K Blu-ray", "4K UHD movie"];

  const nowIso = new Date().toISOString();
  const keywordDebug: any[] = [];

  const supabaseAdmin = getSupabaseAdmin();

  const all: DealRow[] = [];
  const seen = new Set<string>();

  for (const kw of keywords) {
    const { status, data } = await paapiSearch(kw);

    const type = data?.__type || data?.Output?.__type;
    if (type === "com.amazon.paapi5#AssociateEligibilityException") {
      return Response.json(
        {
          ok: false,
          error: "Amazon PA-API not eligible yet (need qualifying sales in last 30 days).",
          amazonType: type,
        },
        { status: 403 }
      );
    }

    if (status >= 400) {
      keywordDebug.push({ kw, status, error: data });
      continue;
    }

    const errors: any[] = data?.Errors || [];
    const items: any[] =
      data?.SearchResult?.Items ||
      data?.SearchItemsResult?.SearchResult?.Items ||
      data?.SearchItemsResult?.Items ||
      [];

    keywordDebug.push({ kw, errors, itemsCount: items.length });

    for (const item of items) {
      const asin = item?.ASIN;
      if (!asin || typeof asin !== "string") continue;
      if (seen.has(asin)) continue;

      const title: string | null =
        item?.ItemInfo?.Title?.DisplayValue || item?.ItemInfo?.Title?.Label || null;

      const imageUrl: string | null = item?.Images?.Primary?.Large?.URL || null;

      const listing = item?.Offers?.Listings?.[0];
      const priceAmount = safeNum(listing?.Price?.Amount);
      const listAmount = safeNum(listing?.SavingBasis?.Amount);

      const priceCents = toCents(priceAmount);
      const listCents = toCents(listAmount);

      const discountPct = computeDiscountPct(priceCents, listCents);
      const isUnder20 = priceCents !== null && priceCents <= 2000;

      const qualifies = discountPct !== null && discountPct >= 15;
      if (!qualifies) continue;

      const salesRankRaw = item?.BrowseNodeInfo?.WebsiteSalesRank?.SalesRank;
      const salesRank = Number.isFinite(Number(salesRankRaw)) ? Number(salesRankRaw) : null;

      const amazonUrl = `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_PARTNER_TAG}`;

      all.push({
        asin,
        title: title ?? asin,
        image_url: imageUrl,
        amazon_url: amazonUrl,
        price_cents: priceCents,
        list_price_cents: listCents,
        currency: listing?.Price?.Currency || null,
        discount_pct: discountPct,
        is_under_20: isUnder20,
        category: "media",
        media_type: "4k-uhd",
        sales_rank: salesRank,
        updated_at: nowIso,
      });

      seen.add(asin);
    }
  }

  all.sort((a, b) => {
    const ra = a.sales_rank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.sales_rank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;

    const da = a.discount_pct ?? -1;
    const db = b.discount_pct ?? -1;
    if (db !== da) return db - da;

    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });

  const top50 = all.slice(0, 50);

  const { error } = await supabaseAdmin.from("deals").upsert(top50, { onConflict: "asin" });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    media_type: "4k-uhd",
    found: all.length,
    savedTop50: top50.length,
    keywordDebug,
  });
}
