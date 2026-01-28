import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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

export default async function LastUpdated({
  mediaType,
}: {
  mediaType: "vinyl" | "4k-uhd" | "blu-ray" | "cd" | "dvd";
}) {
  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from("refresh_runs")
    .select("finished_at")
    .eq("media_type", mediaType)
    .eq("ok", true)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mt-2 text-sm text-slate-600">
      <span className="font-medium text-slate-900">Last Updated:</span>{" "}
      {data?.finished_at ? formatPT(data.finished_at) : "—"}
    </div>
  );
}
