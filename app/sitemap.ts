import { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `https://${h.get("x-forwarded-host") || h.get("host") || "www.mediadealshub.com"}`;

  const cleanSiteUrl = siteUrl.replace(/\/$/, "");

  const routes = [
    { path: "", priority: 1.0 },
    { path: "/blu-ray", priority: 0.95 },
    { path: "/4k-uhd", priority: 0.9 },
    { path: "/dvd", priority: 0.9 },
    { path: "/vinyl", priority: 0.85 },
    { path: "/cd", priority: 0.8 },
  ];

  return routes.map((route) => ({
    url: `${cleanSiteUrl}${route.path}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: route.priority,
  }));
}
