
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getLastUpdated } from "@/lib/timeBudget";

function money(cents: number | null, currency: string | null) {
  if (cents == null) return null;
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return "$" + value.toFixed(2);
  }
}

export default async function FourKUhdUnder15Page() {
  const lastUpdatedIso = await getLastUpdated("4k-uhd", "4k-uhd-under-15");

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("deals")
    .select("*")
    .eq("category", "4k-uhd")
    .lte("price", 15)
    .limit(200);

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">4K UHD Under $15</h1>

      {lastUpdatedIso && (
        <p className="text-sm text-gray-500 mb-4">
          Last updated: {new Date(lastUpdatedIso).toLocaleString()}
        </p>
      )}

      {!data?.length && <p>No deals yet.</p>}
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
        {data?.map((item) => {
          const price = money(item.price_cents, item.currency);
          const list = money(item.list_price_cents, item.currency);
          const hasDiscount = typeof item.discount_pct === "number";

          return (
            <li key={item.asin} className="h-full">
              <a
                href={item.amazon_url}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="p-4">
                  <div className="flex items-center gap-4 lg:flex-col lg:items-stretch lg:gap-3">
                    <div className="relative h-32 w-32 shrink-0 rounded-2xl bg-slate-50 ring-1 ring-slate-100 lg:h-auto lg:w-full lg:aspect-square">
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.image_url}
                          alt={item.title}
                          className="absolute inset-0 h-full w-full object-contain p-0.5 lg:p-1"
                          loading="lazy"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1 text-right lg:text-center">
                      {hasDiscount ? (
                        <div className="mb-3 flex justify-end lg:mb-2 lg:justify-center">
                          <span className="rounded-full bg-orange-50 px-3 py-1 text-[12px] font-extrabold tracking-wide text-orange-700 ring-1 ring-orange-200 lg:px-2.5 lg:py-0.5 lg:text-[11px]">
                            {item.discount_pct}% OFF
                          </span>
                        </div>
                      ) : null}

                      {item.artist ? (
                        <div className="text-[12px] font-bold uppercase tracking-wide text-slate-700 lg:text-[11px] lg:text-center">
                          {item.artist}
                        </div>
                      ) : null}

                      <p className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900 lg:text-[14px] lg:text-center">
                        {item.title}
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
    </main>
  );
}
