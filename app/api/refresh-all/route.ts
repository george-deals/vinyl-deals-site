import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TASKS = ["vinyl", "cd", "4k-uhd", "blu-ray", "dvd"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token || token !== process.env.REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const maxPages = url.searchParams.get("maxPages") ?? "3";
  const delayMs = url.searchParams.get("delayMs") ?? "200";

  const origin = new URL(req.url).origin;
  const results: any[] = [];

  for (const type of TASKS) {
    const res = await fetch(
      `${origin}/api/refresh-${type}?token=${token}&maxPages=${maxPages}&delayMs=${delayMs}`,
      { cache: "no-store" }
    );

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    results.push({
      task: type,
      status: res.status,
      ok: res.ok,
      body,
    });
  }

  return NextResponse.json(
    {
      ok: results.every((r) => r.ok),
      ran_at: new Date().toISOString(),
      maxPages,
      delayMs,
      results,
    },
    { status: 207 }
  );
}
