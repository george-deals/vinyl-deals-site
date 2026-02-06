import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const revalidate = 0;

const FEED_KEY = "discount-15";
const MIN_DISCOUNT = 15;
const STALE_DAYS = 30;

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

async function getLastUpdated(mediaType: string, feedKey: string) {
  const supabase = getSupabaseAdmin();

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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const f = parseFilter(sp.discount);

  const baseTitle = "Top Vinyl Deals (Amazon US)";
  const title =
    f === "all" ? `${baseTitle} | Vinyl Deals` : `${filterLabel(f)} — ${baseTitle} | Vinyl Deals`;

  const description =
    f === "all"
      ? "Top vinyl record deals from Amazon US. Updated regularly. Browse top-selling titles (15%+) in one place."
      : `Browse ${filterLabel(f)} on Amazon US vinyl. Updated regularly. Top-selling titles first.`;

  const canonical = f === "all" ? "/vinyl" : `/vinyl?discount=${f}`;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

export default async function VinylTopDealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp.discount);

  const lastUpdatedIso = await getLastUpdated("vinyl", FEED_KEY);

  const supabase = getSupabaseAdmin();

  let q = supabase
    .from("deals")
    .select(
      "asin,title,artist,image_url,amazon_url,price_cents,list_price_cents,currency,discount_pct,media_type,sales_rank,updated_at"
    )
.eq("media_type", "vinyl")
    .eq("feed_key", FEED_KEY)
    .gte("discount_pct", MIN_DISCOUNT);

  if (filter === "15-20") q = q.gte("discount_pct", 15).lt("discount_pct", 20);
  if (filter === "20-30") q = q.gte("discount_pct", 20).lt("discount_pct", 30);
  if (filter === "30-40") q = q.gte("discount_pct", 30).lt("discount_pct", 40);
  if (filter === "40-50") q = q.gte("discount_pct", 40).lt("discount_pct", 50);
  if (filter === "50plus") q = q.gte("discount_pct", 50);

  const { data, error } = await q
    .order("sales_rank", { ascending: true, nullsFirst: false })
    .order("discount_pct", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1000);

  const deals: Deal[] = (data as any) || [];
  const errorMsg = error ? error.message : null;

  const chip = (label: string, href: string, active: boolean) => (
    <Link
      href={href}
      className={[
        "inline-flex items-center rounded-full border px-3 py-1 text-sm",
        active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </Link>
  );

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="space-y-2">
  <h1 className="text-3xl font-bold">Vinyl Deals</h1>
  <p className="mt-2 text-slate-600">
    Filter top-selling vinyl deals by discount.
  </p>
  <div className="mt-2 text-sm text-slate-600">
    Last Updated: <strong>{lastUpdatedIso ? formatPT(lastUpdatedIso) : "—"}</strong>
  </div>
</div>


        <div className="mt-6 flex flex-wrap gap-2">
          {chip("15%+ OFF", "/vinyl", filter === "all")}
          {chip("15%–20% OFF", "/vinyl?discount=15-20", filter === "15-20")}
          {chip("20%–30% OFF", "/vinyl?discount=20-30", filter === "20-30")}
          {chip("30%–40% OFF", "/vinyl?discount=30-40", filter === "30-40")}
          {chip("40%–50% OFF", "/vinyl?discount=40-50", filter === "40-50")}
          {chip("50%+ OFF", "/vinyl?discount=50plus", filter === "50plus")}
        </div>

        {errorMsg ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            Error loading deals: {errorMsg}
          </div>
        ) : deals.length === 0 ? (
          <div className="mt-6 rounded-lg border bg-white p-6">
            <p className="text-slate-700">
              No results for <strong>{filterLabel(filter)}</strong>. Try another filter.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 text-sm text-slate-600">
              Showing <strong>{deals.length}</strong> results for <strong>{filterLabel(filter)}</strong>
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
          </>
        )}
      </div>
    </main>
  );
}

function formatPT(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
