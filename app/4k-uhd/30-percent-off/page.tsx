import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const metadata: Metadata = {
  title: "4K UHD 30%+ Off (Amazon US) | MediaDealsHub",
  description: "4K UHD titles discounted 30%+ on Amazon US. Updated regularly. Best sellers first.",
  alternates: { canonical: "/4k-uhd/30-percent-off" },
  robots: { index: true, follow: true },
};

export const revalidate = 60;

const FEED_KEY = "discount-15";
const STALE_DAYS = 3;

type Deal = {
  asin: string;
  title: string;
  artist: string | null;
  image_url: string | null;
  amazon_url: string;
  price_cents: number | null;
  list_price_cents: number | null;
  currency: string | null;
  discount_pct: number | null;
  sales_rank: number | null;
  updated_at: string;
};

async function getLastUpdatedIso(mediaType: string, feedKey: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("refresh_runs")
    .select("started_at, finished_at")
    .eq("media_type", mediaType)
    .eq("feed_key", feedKey)
    .eq("ok", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return (data.finished_at || data.started_at) as string | null;
}

function money(cents: number | null, currency: string | null) {
  if (cents == null) return null;
  const val = (cents / 100).toFixed(2);
  const cur = currency || "USD";
  return cur === "USD" ? `$${val}` : `${val} ${cur}`;
}

export default async function Uhd30PlusPage() {
  const lastUpdatedIso = await getLastUpdatedIso("4k-uhd", FEED_KEY);

  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("deals")
    .select(
      "asin,title,artist,image_url,amazon_url,price_cents,list_price_cents,currency,discount_pct,sales_rank,updated_at"
    )
.eq("media_type", "4k-uhd")
    .eq("feed_key", FEED_KEY)
    .gt("last_seen_at", cutoff)
    .gte("discount_pct", 30)
    .order("sales_rank", { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    return (
      <main className="max-w-6xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-2">4K UHD 30%+ Off</h1>
        <p className="text-red-600">Error loading deals: {error.message}</p>
      </main>
    );
  }

  const deals = (data || []) as Deal[];

  return (
    <main className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-bold">4K UHD 30%+ Off</h1>
          <p className="text-sm opacity-80">
            Updated: {lastUpdatedIso ? new Date(lastUpdatedIso).toLocaleString() : "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="underline" href="/4k-uhd">All 4K UHD</Link>
          <Link className="underline" href="/4k-uhd/under-15">Under $15</Link>
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
        {deals.map((d) => {
          const price = money(d.price_cents, d.currency);
          const list = money(d.list_price_cents, d.currency);
          const hasDiscount = typeof d.discount_pct === "number";

          return (
            <li key={d.asin} className="h-full">
              <a
                href={d.amazon_url}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="p-4">
                  <div className="flex items-center gap-4 lg:flex-col lg:items-stretch lg:gap-3">
                    <div className="relative h-32 w-32 shrink-0 rounded-2xl bg-slate-50 ring-1 ring-slate-100 lg:h-auto lg:w-full lg:aspect-square">
                      {d.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={d.image_url}
                          alt={d.title}
                          className="absolute inset-0 h-full w-full object-contain p-0.5 lg:p-1"
                          loading="lazy"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1 text-right lg:text-center">
                      {hasDiscount ? (
                        <div className="mb-3 flex justify-end lg:mb-2 lg:justify-center">
                          <span className="rounded-full bg-orange-50 px-3 py-1 text-[12px] font-extrabold tracking-wide text-orange-700 ring-1 ring-orange-200 lg:px-2.5 lg:py-0.5 lg:text-[11px]">
                            {d.discount_pct}% OFF
                          </span>
                        </div>
                      ) : null}

                      {d.artist ? (
                        <div className="text-[12px] font-bold uppercase tracking-wide text-slate-700 lg:text-[11px] lg:text-center">
                          {d.artist}
                        </div>
                      ) : null}

                      <p className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900 lg:text-[14px] lg:text-center">
                        {d.title}
                      </p>

                      <div className="mt-3 flex items-end justify-end gap-3 lg:justify-center lg:gap-2">
                        {list ? (
                          <span className="text-[13px] text-slate-400 line-through lg:text-[12px]">
                            {list}
                          </span>
                        ) : null}

                        {price ? (
                          <span className="text-[22px] font-extrabold leading-none text-slate-900 lg:text-[20px]">
                            {price}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-auto border-t border-slate-100 px-4 py-3 text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                    View on Amazon <span aria-hidden>›</span>
                  </span>
                </div>
              </a>
            </li>
          );
        })}
      </ul>

      {deals.length === 0 ? (
        <p className="mt-6 opacity-80">No deals found in the last {STALE_DAYS} days.</p>
      ) : null}
    </main>
  );
}
