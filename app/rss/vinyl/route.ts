import { NextResponse } from "next/server";

export async function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Media Deals Hub — Vinyl Deals</title>
    <link>https://mediadealshub.com</link>
    <description>Latest vinyl deals (15%+ off)</description>
    <language>en-us</language>

    <item>
      <title>🔥 Test Vinyl Deal</title>
      <link>https://www.amazon.com</link>
      <guid isPermaLink="false">test-vinyl-1</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description>Vinyl • 25% OFF • $19.99</description>
    </item>

  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
