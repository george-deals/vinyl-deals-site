import { MetadataRoute } from "next";
import { headers } from "next/headers";

export default function sitemap(): MetadataRoute.Sitemap {
  const h = headers();

  const host =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `https://${h.get("x-forwarded-host") || h.get("host")}`;

  const siteUrl = host.replace(/\/$/, "");

  const staticRoutes = [
    "",
    "/vinyl",
    "/cds",
    "/4k-uhd",
    "/blu-ray",
    "/dvd",
    "/disclosure",
  ];

  const vinylGenres = [
    "rock",
    "hip-hop",
    "jazz",
    "soundtracks",
    "pop",
    "metal",
    "country",
    "classical",
    "electronic",
    "rnb-soul",
  ];

  const routes: MetadataRoute.Sitemap = [];

  for (const path of staticRoutes) {
    routes.push({
      url: `${siteUrl}${path}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: path === "" ? 1.0 : 0.8,
    });
  }

  for (const genre of vinylGenres) {
    routes.push({
      url: `${siteUrl}/vinyl/${genre}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.7,
    });
  }

  return routes;
}
