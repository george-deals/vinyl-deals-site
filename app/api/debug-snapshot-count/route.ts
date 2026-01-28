import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const media_type = searchParams.get("media_type") || "dvd";
  const min_discount = Number(searchParams.get("min_discount") || "15");

  const supabase = getSupabaseAdmin();

  // 1) latest successful run
  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .select("sync_id, finished_at, started_at")
    .eq("media_type", media_type)
    .eq("ok", true)
    .not("sync_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runErr) return NextResponse.json({ ok: false, error: runErr.message }, { status: 500 });
  if (!run?.sync_id) return NextResponse.json({ ok: true, media_type, latest: null, count: 0 });

  // 2) count deals in that snapshot using the same constraints your pages claim to use
  const { count, error: dealsErr } = await supabase
    .from("deals")
    .select("asin", { count: "exact", head: true })
    .eq("media_type", media_type)
    .eq("sync_id", run.sync_id)
    .gte("discount_pct", min_discount);

  if (dealsErr) return NextResponse.json({ ok: false, error: dealsErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    media_type,
    min_discount,
    sync_id: run.sync_id,
    finished_at: run.finished_at,
    count: count ?? 0,
  });
}
