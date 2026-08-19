// app/robots.ts
export const dynamic = "force-static";
// robots.txt生成

import { MetadataRoute } from "next";
import { siteConfig } from "../lib/utils/seo";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: "/",
            // 個人用・認証系・管理ページはクロール対象外（薄いコンテンツを検索から除外）
            disallow: ["/api/", "/admin", "/user/", "/login", "/signup", "/favorites", "/history"],
        },
        sitemap: [
            `${siteConfig.url}/sitemap.xml`,
            `${siteConfig.url}/sitemap-images.xml`,
        ],
    };
}
