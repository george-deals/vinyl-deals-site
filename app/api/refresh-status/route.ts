import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const media_type = url.searchParams.get("media_type");

  if (!media_type) {
    return Response.json({ ok: false, error: "Missing media_type" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Latest successful run
  const lastOk = await supabase
    .from("refresh_runs")
    .select("media_type, build_id, started_at, finished_at, ok, found, saved, max_pages, delay_ms")
    .eq("media_type", media_type)
    .eq("ok", true)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Latest run (success or fail)
  const lastAny = await supabase
    .from("refresh_runs")
    .select("media_type, build_id, started_at, finished_at, ok, found, saved, error")
    .eq("media_type", media_type)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastOk.error) {
    return Response.json({ ok: false, error: lastOk.error.message }, { status: 500 });
  }
  if (lastAny.error) {
    return Response.json({ ok: false, error: lastAny.error.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    media_type,
    last_ok: lastOk.data ?? null,
    last_run: lastAny.data ?? null,
  });
}
