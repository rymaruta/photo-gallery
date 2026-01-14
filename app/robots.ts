// app/robots.ts
// robots.txt生成

import { MetadataRoute } from "next";
import { siteConfig } from "../lib/utils/seo";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: "/",
            disallow: ["/api/"],
        },
        sitemap: `${siteConfig.url}/sitemap.xml`,
    };
}
