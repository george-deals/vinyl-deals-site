import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token") ?? "";
  if (!process.env.REFRESH_TOKEN || token !== process.env.REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : null;

  const { count: totalDeals, error: totalErr } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true });

  if (totalErr) return NextResponse.json({ ok: false, error: totalErr.message }, { status: 500 });

  const { count: recentDeals, error: recentErr } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .gt("last_seen_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());

  if (recentErr) return NextResponse.json({ ok: false, error: recentErr.message }, { status: 500 });

  const mediaTypes = ["vinyl", "4k-uhd", "blu-ray", "dvd", "cd"] as const;
  const perMedia: Record<string, any> = {};

  for (const media of mediaTypes) {
    const { count, error } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("media_type", media)
      .eq("feed_key", "discount-15")
      .gte("discount_pct", 15);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const { data: latestRow } = await supabase
      .from("deals")
      .select("last_seen_at")
      .eq("media_type", media)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    perMedia[media] = {
      eligible: count ?? 0,
      newest_last_seen_at: latestRow?.last_seen_at ?? null,
    };
  }

  return NextResponse.json({
    ok: true,
    supabase_host: supabaseHost,
    total_deals: totalDeals ?? 0,
    recent_deals: recentDeals ?? 0,
    per_media: perMedia,
  });
}
