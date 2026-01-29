
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getLastUpdated } from "@/lib/timeBudget";

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {data?.map((item) => (
          <div key={item.asin} className="border rounded p-3">
            <p className="font-semibold text-sm">{item.title}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
