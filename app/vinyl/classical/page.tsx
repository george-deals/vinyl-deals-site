import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const revalidate = 3600;

type Deal = {
  asin: string;
  title: string;
  image_url: string | null;
  amazon_url: string;
  price_cents: number | null;
  list_price_cents: number | null;
  currency: string | null;
  discount_pct: number | null;
  genre: string | null;
  updated_at: string;
};

function money(cents: number | null, currency: string | null) {
  if (cents == null) return null;
  const val = (cents / 100).toFixed(2);
  const cur = currency || "USD";
  return cur === "USD" ? `$${val}` : `${val} ${cur}`;
}

const GENRE_SLUG = "classical";
const GENRE_LABEL = "Classical";

export const metadata: Metadata = {
  title: `${GENRE_LABEL} Vinyl Deals (Amazon US) | Vinyl Deals`,
  description: `Top new ${GENRE_LABEL.toLowerCase()} vinyl record deals from Amazon US. Updated daily.`,
};

export default async function GenreDealsPage() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("deals")
    .select(
      "asin,title,image_url,amazon_url,price_cents,list_price_cents,currency,discount_pct,genre,updated_at"
    )
    .eq("category", "vinyl")
    .eq("genre", GENRE_SLUG)
    .order("discount_pct", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(50);

  const deals: Deal[] = data || [];

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{GENRE_LABEL} Vinyl Deals</h1>
            <p className="mt-2 text-slate-600">
              New-only deals from Amazon US. Data appears after the refresh job runs.
            </p>
          </div>

          <div className="flex gap-3">
            <Link href="/vinyl" className="underline text-slate-700">
              Top Deals
            </Link>
            <Link href="/vinyl/genres" className="underline text-slate-700">
              All genres
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            Error loading deals: {error.message}
          </div>
        ) : deals.length === 0 ? (
          <div className="mt-6 rounded-lg border bg-white p-6">
            <p className="text-slate-700">
              No {GENRE_LABEL.toLowerCase()} deals yet. Once the refresh job runs for this genre, the top 50 will show here.
            </p>
            <p className="mt-2 text-slate-600">
              (For local dev: hit{" "}
              <code>/api/refresh-vinyl?token=...&genre={GENRE_SLUG}</code>.)
            </p>
          </div>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {deals.map((d) => {
              const price = money(d.price_cents, d.currency);
              const list = money(d.list_price_cents, d.currency);
              return (
                <li key={d.asin} className="rounded-xl border bg-white p-4">
                  <a href={d.amazon_url} target="_blank" rel="nofollow noopener noreferrer">
                    <div className="flex gap-4">
                      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                        {d.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={d.image_url}
                            alt={d.title}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <p className="line-clamp-2 font-semibold">{d.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          {price ? <span className="font-medium">{price}</span> : null}
                          {list ? <span className="text-slate-500 line-through">{list}</span> : null}
                          {typeof d.discount_pct === "number" ? (
                            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">
                              {d.discount_pct}% off
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs text-slate-500">ASIN: {d.asin}</p>
                      </div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
