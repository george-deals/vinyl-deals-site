import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const media_type = searchParams.get("media_type") || "dvd";

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("refresh_runs")
    .select("media_type, ok, sync_id, started_at, finished_at, found, saved")
    .eq("media_type", media_type)
    .eq("ok", true)
    .not("sync_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // env fingerprint (no secrets)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const projectRef = url.includes("supabase.co")
    ? url.split("https://")[1]?.split(".")[0] || null
    : null;

  return NextResponse.json({ ok: true, projectRef, latest: data ?? null });
}
