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
    .eq("category", "media")
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {deals.map((d) => (
          <a key={d.asin} href={d.amazon_url} target="_blank" rel="noreferrer" className="block border rounded p-2 hover:shadow">
            <div className="relative w-full aspect-square rounded-2xl bg-slate-50 ring-1 ring-slate-100">
              {d.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.image_url}
                  alt={d.title}
                  className="absolute inset-0 h-full w-full object-contain p-0.5"
                />
              ) : null}
            </div>
            <div className="mt-2">
              <div className="font-semibold text-sm line-clamp-2">{d.title}</div>
              <div className="text-xs opacity-80 line-clamp-1">{d.artist ?? ""}</div>
              <div className="text-sm mt-1">
                {money(d.price_cents, d.currency)}{" "}
                {d.discount_pct != null ? <span className="opacity-80">({d.discount_pct}% off)</span> : null}
              </div>
            </div>
          </a>
        ))}
      </div>

      {deals.length === 0 ? (
        <p className="mt-6 opacity-80">No deals found in the last {STALE_DAYS} days.</p>
      ) : null}
    </main>
  );
}
