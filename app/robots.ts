// app/robots.ts
export const dynamic = "force-static";
// robots.txt生成

import { MetadataRoute } from "next";
import { siteConfig } from "../lib/utils/seo";

export default function robots(): MetadataRoute.Robots {
    // 本番以外は全面的にクロールを拒否する。
    // staging は本番と同じ内容を別URLで配信するので、拾われると重複コンテンツになる。
    if (siteConfig.envName !== "prod") {
        return { rules: { userAgent: "*", disallow: "/" } };
    }
    return {
        rules: {
            userAgent: "*",
            allow: "/",
            // 個人用・認証系・管理ページはクロール対象外（薄いコンテンツを検索から除外）
            // `/j` は共同アルバムの招待。**私的なリンク**なので、
            // クロールさせない（ページ自体も noindex だが、そもそも
            // 取りに来させない方が確実）
            disallow: ["/api/", "/admin", "/user/", "/login", "/signup", "/favorites", "/search", "/history", "/j"],
        },
        sitemap: [
            `${siteConfig.url}/sitemap.xml`,
            `${siteConfig.url}/sitemap-images.xml`,
        ],
    };
}
