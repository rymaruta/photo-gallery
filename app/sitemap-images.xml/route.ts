// 画像サイトマップ（タイトル/キャプション付き）。
// Next の MetadataRoute.Sitemap は画像の URL しか載せられないため、
// image:title / image:caption を含む XML を自前で生成する。
// ※ Google は 2022 年以降 image:loc 以外の拡張を無視するが、Bing 等は解釈する。
//    Google 向けの主目的は「全画像 URL の網羅提示」で、既存 sitemap.xml と併用する。

import { loadAllPhotos } from "@/lib/server/photos";
import { siteConfig } from "@/lib/utils/seo";
import { getLocalized, getLocalizedParagraphs } from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";
import { truncate } from "@/lib/utils/text";

export const dynamic = "force-static";

/**
 * XML に入れてよい形にする。
 *
 * **記号を実体参照にするだけでは足りない。** XML 1.0 は C0 制御文字
 * （タブ・改行・復帰を除く U+0000-001F）を**文字参照でも書けない**ので、
 * 1文字混ざると `sitemap-images.xml` が**丸ごと** parse error になる
 * （その1件だけでなく30枚ぶんの `<image:loc>` が全部読めなくなる）。
 * HTML と JSON-LD は `JSON.stringify` が `\u000b` に逃がすので無事——
 * つまり**画面のどこにも症状が出ない**。
 *
 * 入口（`api-user/src/sanitize.ts`）にも除去は無く、API を直接叩けば確実に
 * 入る。Word や表計算からの貼り付けはセル内改行が U+000B になるので、
 * 説明文の貼り付けでも入りうる。
 */
function esc(s: string): string {
    return s
        // 制御文字は落とす（タブ・改行・復帰は XML で合法なので残す）
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function toAbsolute(src: string): string {
    return src.startsWith("http") ? src : `${siteConfig.url}${src}`;
}

function titleOf(p: Photo): string {
    const ja = getLocalized(p.title, "ja");
    const en = getLocalized(p.title, "en");
    return [ja, en && en !== ja ? en : ""].filter(Boolean).join(" / ");
}

function captionOf(p: Photo): string {
    const ja = getLocalizedParagraphs(p.description, "ja").join(" ");
    const en = getLocalizedParagraphs(p.description, "en").join(" ");
    const text = [ja, en && en !== ja ? en : ""].filter(Boolean).join(" / ");
    const loc = p.location ? `（${p.location}）` : "";
    return truncate(`${text}${loc}`, 500);
}

export async function GET() {
    const photos = (await loadAllPhotos()).filter((p) => p.published !== false && p.src);

    const entries = photos.map((p) => {
        const title = titleOf(p);
        const caption = captionOf(p);
        return [
            "  <url>",
            `    <loc>${esc(`${siteConfig.url}/photo/${p.id}`)}</loc>`,
            "    <image:image>",
            `      <image:loc>${esc(toAbsolute(p.src))}</image:loc>`,
            title ? `      <image:title>${esc(title)}</image:title>` : "",
            caption ? `      <image:caption>${esc(caption)}</image:caption>` : "",
            "    </image:image>",
            "  </url>",
        ].filter(Boolean).join("\n");
    });

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        ...entries,
        "</urlset>",
    ].join("\n");

    return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
}
