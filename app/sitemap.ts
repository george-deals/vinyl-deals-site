import { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `https://${h.get("x-forwarded-host") || h.get("host")}`;

  const cleanSiteUrl = siteUrl.replace(/\/$/, "");

  const routes = [
    "",
    "/vinyl",
    "/vinyl/30-percent-off",
    "/vinyl/under-20",
    "/4k-uhd",
    "/4k-uhd/30-percent-off",
    "/4k-uhd/under-15",
    "/blu-ray",
    "/cd",
    "/dvd",
    "/disclosure",
    "/privacy",
    "/terms",
  ];

  return routes.map((path) => ({
    url: `${cleanSiteUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: path === "" ? 1.0 : 0.8,
  }));
}
