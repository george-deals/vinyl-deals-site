import axios from "axios";
import aws4 from "aws4";
import { randomUUID } from "crypto";
import { readArtistFile } from "@/lib/readArtistFile";
import { rotateSlice } from "@/lib/rotateSlice";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUILD_ID = "vinyl-getitems-2026-02-10";
const PAAPI_ITEM_COUNT = 10; // PA-API GetItems max ItemIds is 10

const CORE_KEYWORDS = [
  "vinyl",
  "vinyl record",
  "vinyl records",
  "lp",
  "lp vinyl",
  "record",
  "records",
  "reissue vinyl",
  "remastered vinyl",
  "vinyl reissue",
  "standard edition vinyl",
  "vinyl 1lp",
  "colored vinyl",
  "limited edition vinyl",
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
    ItemCount: PAAPI_ITEM_COUNT,
    ItemPage: itemPage,
    Condition: "New",
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Resources: [
      "ItemInfo.Title",
      "ItemInfo.ByLineInfo",
      "Images.Primary.Large",
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
      .eq("media_type", "vinyl")
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
    .eq("media_type", "vinyl")
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
      let listCents =
        listing ? (toCents(listing?.SavingBasis?.Amount) ?? toCents(listing?.ListPrice?.Amount)) : null;
      const savingsAmt = listing ? toCents(listing?.Price?.Savings?.Amount) : null;

      if (priceCents == null) priceCents = existing.price_cents;
      if (listCents == null) listCents = existing.list_price_cents;
      if (!listCents && savingsAmt && priceCents) listCents = priceCents + savingsAmt;

      let discountPct: number | null = null;
      if (listing && priceCents != null) {
        const savingsPct = Number(listing?.Price?.Savings?.Percentage);
        if (Number.isFinite(savingsPct) && savingsPct > 0) {
          discountPct = Math.round(savingsPct * 10) / 10;
        } else if (savingsAmt && listCents) {
          discountPct = Math.round((savingsAmt / listCents) * 1000) / 10;
        } else {
          discountPct = computeDiscountPct(priceCents, listCents);
        }
      }

      if (discountPct != null && discountPct >= opts.minDiscount) {
        discountedRows.push({
          asin,
          media_type: "vinyl",
          feed_key: opts.feedKey,
          price_cents: priceCents,
          list_price_cents: listCents,
          discount_pct: discountPct,
          updated_at: now,
          last_seen_at: now,
        });
      } else if (discountPct == null) {
        discountedRows.push({
          asin,
          media_type: "vinyl",
          feed_key: opts.feedKey,
          price_cents: priceCents,
          list_price_cents: listCents,
          updated_at: now,
        });
      } else {
        invalidRows.push({
          asin,
          media_type: "vinyl",
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
        media_type: "vinyl",
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

async function refreshVinylViaGetItems(req: Request, keywords: string[]) {
  const url = new URL(req.url);
  const maxPages = Math.min(Math.max(Number(url.searchParams.get("maxPages") ?? "1"), 1), 10);
  const delayMs = Math.min(Math.max(Number(url.searchParams.get("delayMs") ?? "0"), 0), 5000);
  const minDiscount = Math.min(Math.max(Number(url.searchParams.get("min_discount") ?? "15"), 0), 90);

  const now = new Date().toISOString();
  const syncId = randomUUID();

  const stats: any = {
    build_id: BUILD_ID,
    sync_id: syncId,
    media_type: "vinyl",
    feed_key: "discount-15",
    min_discount: minDiscount,
    maxPages,
    delayMs,
    keywords: keywords.length,
    items_returned: 0,
    items_with_discount_data: 0,
    filtered_under_min_discount: 0,
    kept: 0,
  };

  const supabase = getSupabaseAdmin();
  let runId: number | null = null;
  try {
    const { data: run } = await supabase
      .from("refresh_runs")
      .insert({
        media_type: "vinyl",
        feed_key: "discount-15",
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

  const seen = new Set<string>();
  const keep: any[] = [];
  const errors: any[] = [];

  try {
    for (const kw of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        let items: any[] = [];
        try {
          items = await withRetry(() =>
            paapiSearch({ keyword: kw, itemPage: page, searchIndex: "Music" })
          );
        } catch (e: any) {
          errors.push({ keyword: kw, page, error: extractAxiosError(e) });
          break;
        }

        if (!items.length) break;
        stats.items_returned += items.length;

        const asins: string[] = [];
        const itemMeta = new Map<string, any>();
        for (const item of items) {
          const asin = item?.ASIN;
          if (!asin || seen.has(asin)) continue;
          asins.push(asin);
          itemMeta.set(asin, item);
        }

        const chunks: string[][] = [];
        for (let i = 0; i < asins.length; i += PAAPI_ITEM_COUNT) {
          chunks.push(asins.slice(i, i + PAAPI_ITEM_COUNT));
        }

        for (const chunk of chunks) {
          let got: any[] = [];
          try {
            got = await withRetry(() => paapiGetItems(chunk));
          } catch (e: any) {
            errors.push({ asins: chunk, error: extractAxiosError(e) });
            continue;
          }

          if (!got.length) continue;

          for (const item of got) {
            const asin = item?.ASIN;
            if (!asin || seen.has(asin)) continue;

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

            if (discountPct !== null) stats.items_with_discount_data += 1;
            if (discountPct === null || discountPct < minDiscount) {
              stats.filtered_under_min_discount += 1;
              continue;
            }

            const meta = itemMeta.get(asin);
            const rank = Number(meta?.BrowseNodeInfo?.WebsiteSalesRank?.SalesRank) || null;
            const browseNodeId = getPrimaryBrowseNodeId(meta);
            const artist = extractArtist(meta);

            keep.push({
              asin,
              title: meta?.ItemInfo?.Title?.DisplayValue ?? asin,
              artist,
              image_url: meta?.Images?.Primary?.Large?.URL ?? null,
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

            seen.add(asin);
            stats.kept += 1;
          }
        }

        if (delayMs > 0) await sleep(delayMs);
      }
    }

    keep.sort((a, b) => (a.sales_rank ?? 1e12) - (b.sales_rank ?? 1e12));
    const saved = await upsertChunked(keep);

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
      media_type: "vinyl",
      feed_key: "discount-15",
      min_discount: minDiscount,
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = searchParams.get("token");
  if (!token || token !== process.env.REFRESH_TOKEN) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const hotPerRun = Number(searchParams.get("hotPerRun") ?? "50");
  const catalogPerRun = Number(searchParams.get("catalogPerRun") ?? "100");
  const catalogOffsetRaw = searchParams.get("catalogOffset");

  const hotArtistsAll = await readArtistFile("data/hot-artists.txt");
  const catalogArtistsAll = await readArtistFile("data/catalog-artists.txt");

  const hotArtists = hotArtistsAll.slice(0, Math.max(0, hotPerRun));

  let catalogBatch: string[] = [];
  if (catalogOffsetRaw != null) {
    const catalogOffset = Number(catalogOffsetRaw ?? "0");
    const start = Math.max(0, catalogOffset);
    const size = Math.max(0, catalogPerRun);
    catalogBatch = catalogArtistsAll.slice(start, start + size);
  } else {
    const hourSeed = Math.floor(Date.now() / 3600000);
    catalogBatch = rotateSlice(catalogArtistsAll, Math.max(0, catalogPerRun), hourSeed);
  }

  const artistKeywords = [...hotArtists, ...catalogBatch].map((a) => `"${a}" vinyl`);
  const keywords = uniqClean([...CORE_KEYWORDS, ...artistKeywords]);

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

  const refreshResponse = await refreshVinylViaGetItems(req, keywords);
  const refreshBody = await refreshResponse.json();
  return Response.json({ ...refreshBody, revalidate_active: revalidateStats }, { status: refreshResponse.status });
}
