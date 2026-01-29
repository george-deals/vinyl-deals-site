
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const STALE_DAYS = 14;

export default async function BlurayTopDealsPage() {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Build the query first, then execute it (prevents undefined 'q' errors)
  const q = supabase
    .from("deals")
    .select("*")
    .eq("category", "blu-ray")
    .gte("last_seen_at", cutoff);

  const { data, error } = await q
    .order("sales_rank", { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    return (
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">Top Blu-ray Deals</h1>
        <p className="text-sm text-red-600">Error loading deals: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Top Blu-ray Deals</h1>

      {!data?.length && <p className="text-gray-500">No Blu-ray deals available yet.</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {data?.map((item: any) => (
          <div key={item.asin} className="border rounded p-3">
            <p className="font-semibold text-sm line-clamp-2">{item.title}</p>
            {typeof item.price === "number" && (
              <p className="text-xs text-gray-500">${item.price.toFixed(2)}</p>
            )}
            {typeof item.discount_pct === "number" && (
              <p className="text-xs text-gray-500">{item.discount_pct}% off</p>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
