import axios from "axios";
import aws4 from "aws4";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  category: "vinyl";
  updated_at: string;
};

function toCents(n?: number | null) {
  return Math.round((n ?? 0) * 100);
}


function safeNum(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function computeDiscountPct(
  priceCents: number | null,
  listCents: number | null
): number | null {
  if (!priceCents || !listCents) return null;
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
    SearchIndex: "Music",
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
    ],
  };

  const headers: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "content-encoding": "amz-1.0",
  host,
  "x-amz-target":
    "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
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

  const resp = await axios.post(url, signed.body, {
    headers: signed.headers as any,
    timeout: 20000,
  });

  return resp.data;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token || token !== process.env.REFRESH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const keywords = [
    "vinyl",
    "vinyl records",
    "LP",
    "180 gram vinyl",
    "limited edition vinyl",
    "audiophile vinyl",
    "vinyl box set",
    "deluxe vinyl edition",
    "rock vinyl",
    "jazz vinyl",
    "hip hop vinyl",
    "soundtrack vinyl",
  ];

  const nowIso = new Date().toISOString();
  const all: DealRow[] = [];
  const seen = new Set<string>();
const keywordDebug: any[] = [];

  for (const kw of keywords) {
    let data: any;
    try {
      data = await paapiSearch(kw);
    } catch (e: any) {
  const payload = e?.response?.data || e?.message;
  console.error("PA-API error for keyword:", kw, payload);

  // If Amazon says you're not eligible, stop early and surface it in the response.
  const code = payload?.Errors?.[0]?.Code;
  if (code === "AssociateNotEligible") {
    return Response.json(
      {
        ok: false,
        error: "AssociateNotEligible",
        message:
          "Amazon PA-API is currently disabled for this Associates account. Once you regain eligibility, this will start working automatically.",
      },
      { status: 403 }
    );
  }

  continue;
}


    // PA-API sometimes returns Errors even when HTTP is 200.
// Also, different SDK versions may nest results slightly differently.
const errors: any[] = data?.Errors || [];
const items: any[] =
  data?.SearchResult?.Items ||
  data?.SearchItemsResult?.SearchResult?.Items ||
  data?.SearchItemsResult?.Items ||
  [];
// DEBUG: record what each keyword returned
// (We’ll return this summary in the JSON response.)
(keywordDebug as any[]).push({
  kw,
  errors,
  itemsCount: items.length,
  hasSearchResult: !!data?.SearchResult,
  topLevelKeys: Object.keys(data || {}),
});


    for (const item of items) {
      const asin = item?.ASIN;
      if (!asin || typeof asin !== "string") continue;
      if (seen.has(asin)) continue;

      const title: string | null =
        item?.ItemInfo?.Title?.DisplayValue ?? null;
      const imageUrl: string | null =
        item?.Images?.Primary?.Large?.URL ?? null;

      const listing = item?.Offers?.Listings?.[0];
      const priceAmount = safeNum(listing?.Price?.Amount);
      const currency = listing?.Price?.Currency ?? null;

      const listAmount = safeNum(listing?.SavingBasis?.Amount);
      const priceCents = toCents(priceAmount);
      const listCents = toCents(listAmount);


     const discountPct = computeDiscountPct(priceCents, listCents);
const isUnder20 = priceCents !== null && priceCents <= 2000;

// TEMP: keep any item that has a price, so we can confirm the pipeline works.
// We’ll tighten this back to "real deals" once we see items flowing.
const qualifies = priceCents !== null;
if (!qualifies) continue;


      seen.add(asin);

      const amazonUrl = `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_PARTNER_TAG}`;

      all.push({
        asin,
        title: title ?? asin,
        image_url: imageUrl,
        amazon_url: amazonUrl,
        price_cents: priceCents,
        list_price_cents: listCents,
        currency,
        discount_pct: discountPct,
        is_under_20: isUnder20,
        category: "vinyl",
        updated_at: nowIso,
      });
    }
  }

  all.sort((a, b) => {
    const da = a.discount_pct ?? -1;
    const db = b.discount_pct ?? -1;
    if (db !== da) return db - da;
    const pa = a.price_cents ?? 999999999;
    const pb = b.price_cents ?? 999999999;
    return pa - pb;
  });

  const top50 = all.slice(0, 50);

  const { error } = await supabaseAdmin
    .from("deals")
    .upsert(top50, { onConflict: "asin" });

  if (error) {
    console.error("Supabase upsert error:", error);
    return new Response("Supabase error", { status: 500 });
  }

  return Response.json({
  ok: true,
  found: all.length,
  savedTop50: top50.length,
  keywordDebug,
});

}
