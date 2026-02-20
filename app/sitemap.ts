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
    { path: "/movie-deals", priority: 0.95 },
    { path: "/blu-ray", priority: 0.95 },
    { path: "/blue-ray-movies-on-sale", priority: 0.9 },
    { path: "/4k-uhd", priority: 0.9 },
    { path: "/dvd", priority: 0.9 },
    { path: "/vinyl", priority: 0.8 },
    { path: "/cd", priority: 0.8 },
    { path: "/vinyl/30-percent-off", priority: 0.75 },
    { path: "/vinyl/under-20", priority: 0.75 },
    { path: "/4k-uhd/30-percent-off", priority: 0.75 },
    { path: "/4k-uhd/under-15", priority: 0.75 },
    { path: "/disclosure", priority: 0.2 },
    { path: "/privacy", priority: 0.2 },
    { path: "/terms", priority: 0.2 },
  ];

  return routes.map((route) => ({
    url: `${cleanSiteUrl}${route.path}`,
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: route.priority,
  }));
}
