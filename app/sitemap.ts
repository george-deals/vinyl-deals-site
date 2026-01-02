import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://example.com";

  const routes = [
    "",
    "/vinyl",
    "/vinyl/rock",
    "/vinyl/hip-hop",
    "/vinyl/jazz",
    "/vinyl/soundtracks",
    "/vinyl/pop",
    "/vinyl/metal",
    "/vinyl/country",
    "/vinyl/classical",
    "/vinyl/electronic",
    "/vinyl/rnb-soul",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/disclosure",
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
  }));
}
