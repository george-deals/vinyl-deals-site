import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const revalidate = 60;

const FEED_KEY = "discount-15";
const MIN_DISCOUNT = 15;
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
  media_type: string | null;
  sales_rank: number | null;
  updated_at: string;
};

type DiscountFilter = "all" | "15-20" | "20-30" | "30-40" | "40-50" | "50plus";

function money(cents: number | null, currency: string | null) {
  if (cents == null) return null;
  const val = (cents / 100).toFixed(2);
  const cur = currency || "USD";
  return cur === "USD" ? `$${val}` : `${val} ${cur}`;
}

function parseFilter(v: unknown): DiscountFilter {
  if (v === "15-20") return "15-20";
  if (v === "20-30") return "20-30";
  if (v === "30-40") return "30-40";
  if (v === "40-50") return "40-50";
  if (v === "50plus") return "50plus";
  return "all";
}

function filterLabel(f: DiscountFilter) {
  switch (f) {
    case "15-20":
      return "15%–20% OFF";
    case "20-30":
      return "20%–30% OFF";
    case "30-40":
      return "30%–40% OFF";
    case "40-50":
      return "40%–50% OFF";
    case "50plus":
      return "50%+ OFF";
    default:
      return "All (15%+)";
  }
}

async function getLastUpdated(mediaType: string, feedKey: string) {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("refresh_runs")
    .select("started_at, finished_at")
    .eq("media_type", mediaType)
    .eq("feed_key", feedKey)
    .eq("ok", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return (data.finished_at || data.started_at) as string | null;
}

// SEO: generate title/description per filter URL
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const filter = parseFilter(sp.discount);

  const base = "4K UHD Deals";
  const title =
    filter === "all" ? `${base} (15%+ Off)` : `${base} – ${filterLabel(filter)}`;
  const description =
    filter === "all"
      ? "Browse 4K UHD deals with 15%+ discounts, sorted by sales rank."
      : `Browse 4K UHD deals filtered to ${filterLabel(filter)}, sorted by sales rank.`;

  const canonical =
    filter === "all"
      ? "https://www.mediadealshub.com/4k-uhd"
      : `https://www.mediadealshub.com/4k-uhd?discount=${encodeURIComponent(
          String(sp.discount ?? "")
        )}`;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

function formatPT(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function chip(label: string, href: string, active: boolean) {
  return (
    <Link
      href={href}
      prefetch
      className={[
        "rounded-full border px-3 py-1 text-sm transition",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export default async function FourKUhdDealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp.discount);

  const lastUpdatedIso = await getLastUpdated("4k-uhd", FEED_KEY);

  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let q = supabase
    .from("deals")
    .select(
      "asin,title,artist,image_url,amazon_url,price_cents,list_price_cents,currency,discount_pct,media_type,sales_rank,updated_at"
    )
    .eq("category", "media")
    .eq("media_type", "4k-uhd")
    .eq("feed_key", FEED_KEY)
    .gt("last_seen_at", cutoff)
    .gte("discount_pct", MIN_DISCOUNT);

  if (filter === "15-20") q = q.gte("discount_pct", 15).lt("discount_pct", 20);
  if (filter === "20-30") q = q.gte("discount_pct", 20).lt("discount_pct", 30);
  if (filter === "30-40") q = q.gte("discount_pct", 30).lt("discount_pct", 40);
  if (filter === "40-50") q = q.gte("discount_pct", 40).lt("discount_pct", 50);
  if (filter === "50plus") q = q.gte("discount_pct", 50);

  const { data, error } = await q
    .order("sales_rank", { ascending: true, nullsFirst: false })
    .limit(500);

  const deals: Deal[] = (data ?? []) as Deal[];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">4K UHD Deals</h1>
        <p className="text-slate-700">
          15%+ off (sorted by sales rank). Filter by discount range.
        </p>
        <p className="text-sm text-slate-600">
          Last Updated:{" "}
          <strong>{lastUpdatedIso ? formatPT(lastUpdatedIso) : "—"}</strong>
        </p>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap gap-2">
          {chip("15%+ OFF", "/4k-uhd", filter === "all")}
          {chip("15%–20% OFF", "/4k-uhd?discount=15-20", filter === "15-20")}
          {chip("20%–30% OFF", "/4k-uhd?discount=20-30", filter === "20-30")}
          {chip("30%–40% OFF", "/4k-uhd?discount=30-40", filter === "30-40")}
          {chip("40%–50% OFF", "/4k-uhd?discount=40-50", filter === "40-50")}
          {chip("50%+ OFF", "/4k-uhd?discount=50plus", filter === "50plus")}
        </div>

        {!lastUpdatedIso ? (
          <div className="mt-6 rounded-lg border bg-white p-6">
            <p className="text-slate-700">
              No synced data yet. Once refresh runs successfully, deals will appear here.
            </p>
          </div>
        ) : error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            Error loading deals: {error.message}
          </div>
        ) : deals.length === 0 ? (
          <div className="mt-6 rounded-lg border bg-white p-6">
            <p className="text-slate-700">
              No results for <strong>{filterLabel(filter)}</strong>. Try another filter.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {deals.map((d) => {
              const price = money(d.price_cents, d.currency);
              const list = money(d.list_price_cents, d.currency);
              const off = d.discount_pct != null ? `${Math.round(d.discount_pct)}%` : null;

              return (
                <a
                  key={d.asin}
                  href={d.amazon_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md"
                >
                  <div className="flex gap-3">
                    <div className="relative h-32 w-32 shrink-0 rounded-2xl bg-slate-50 ring-1 ring-slate-100">
                      {d.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={d.image_url}
                          alt={d.title}
                          className="absolute inset-0 h-full w-full object-contain p-0.5"
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-sm font-semibold text-slate-900">
                        {d.title}
                      </div>
                      {d.artist ? (
                        <div className="mt-1 text-xs text-slate-600">{d.artist}</div>
                      ) : null}

                      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        {price ? (
                          <span className="text-base font-bold">{price}</span>
                        ) : (
                          <span className="text-sm text-slate-700">Price —</span>
                        )}
                        {list && price && list !== price ? (
                          <span className="text-xs text-slate-500 line-through">{list}</span>
                        ) : null}
                        {off ? (
                          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                            {off} OFF
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-xs text-slate-500">
                        Rank: {d.sales_rank ?? "—"} · Updated: {formatPT(d.updated_at)}
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
