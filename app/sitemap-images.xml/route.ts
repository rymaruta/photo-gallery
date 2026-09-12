// 画像サイトマップ（タイトル/キャプション付き）。
// Next の MetadataRoute.Sitemap は画像の URL しか載せられないため、
// image:title / image:caption を含む XML を自前で生成する。
// ※ Google は 2022 年以降 image:loc 以外の拡張を無視するが、Bing 等は解釈する。
//    Google 向けの主目的は「全画像 URL の網羅提示」で、既存 sitemap.xml と併用する。

import { loadAllPhotos } from "@/lib/server/photos";
import { siteConfig, publicImageUrl } from "@/lib/utils/seo";
import { getLocalized, getLocalizedParagraphs } from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";
import { truncate } from "@/lib/utils/text";
import { metaText } from "@/lib/utils/metaText";

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
        // XML 1.0 が許さない文字は落とす。1文字混ざるだけで**この XML が
        // 丸ごと** parse error になる（その1件ではなく全件が読めなくなる）。
        // 規定は `#x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | …` で、
        // **C0 制御文字だけでは足りない**——`U+FFFE` / `U+FFFF` も入って
        // いない（実測: expat が両方で parse error）。逆に C1（U+0085 など）と
        // 非文字（U+FDD0）は XML 1.0 では合法なので落とさない。
        // タブ・改行・復帰は残す。**ここは XML として壊さないための除去**で、
    // 合法な空白まで落とす仕事ではない。caption を1行に均すのは
    // `metaText` の側（`captionOf`）——2つを混ぜると、除去を広げた
    // 変異が「見せ方が同じだから」で素通りする。
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

// 出すURLはサイトのドメインに揃える（`publicImageUrl`。同じ配信の別名で
// 2つに割れていた——実測 30件中 11件が CloudFront の既定ドメイン）
const toAbsolute = (src: string): string => publicImageUrl(src);

/**
 * **このサイトの言語（日本語）で書く。**
 *
 * 以前は `ja + " / " + en` と併記していた（「両言語のクエリで拾える
 * ように」）。実ビルドで測ると `<image:title>` と `<image:caption>` の
 * **54か所**が「白鳥と湖 / Swans on the Lake」の形になっていた。
 *
 * **併記をやめる理由は3つ**:
 *
 *   1. **ページの本文は日本語。** `locale` は `ja` 固定で切替はもう無く
 *      （`6d72bfb`）、`<html lang="ja">`・`<meta description>` も日本語
 *      だけを出している。
 *      **ただし「英語はどこにも無い」わけではない**——写真ページは
 *      `sr-only` の英語ブロックを静的HTMLに焼いており（実ビルドで
 *      28/30ページ・`PhotoPageClient.tsx:600`）、そこには同じ
 *      「日英どちらのクエリでも拾えるように」という意図が書いてある。
 *      **その1か所をどうするかは別の判断**（残すならここを消した理由と
 *      食い違う／消すと英語の説明はサイトから無くなる）
 *   2. 台帳が同じ判断を一度している——`og:locale:alternate` は
 *      「英語版があると主張してしまう」ので撤去した（I18N-2）。
 *      英語の題を配るのは、無い英語ページへ英語の検索から人を呼ぶこと
 *   3. `<image:caption>` は500字で切るので、**半分を英語に使うと
 *      日本語の説明が入り切らない**（実測で英語が途中で切れていた）
 *
 * **日本語が無い写真は英語に落ちる**（出せるものが無いよりはよい）。
 * その落とし方は `getLocalized` が持っている（`v[locale] || v.ja || v.en`）
 * ので、ここで `|| getLocalized(p.title, "en")` と書き足すのは死にコード
 * ——変異で生き残って気づいた。
 */
export function titleOf(p: Photo): string {
    return getLocalized(p.title, "ja");
}

export const CAPTION_MAX = 500;

export function captionOf(p: Photo): string {
    // 英語への落とし方は `getLocalizedParagraphs` が持っている
    // （`v[locale] ?? v.ja ?? v.en`）ので、ここでは足さない
    // 1行に均す（`metaText` の説明を参照）。XML としては改行も通るが、
    // 読み手に出るのは1行の説明文なので、出口で揃える
    const text = metaText(getLocalizedParagraphs(p.description, "ja").join(" "));
    const loc = p.location ? `（${p.location}）` : "";
    // **撮影地は説明のあとに足すので、そのままだと真っ先に切れる。**
    // 撮影地はこの写真の固有名詞＝説明の末尾より情報が濃いので、
    // 先に席を取ってから説明を詰める。
    //
    // **最後にもう一度切るのは上限の保証を落とさないため。** 席を引くだけ
    // だと、撮影地が上限より長い回に `CAPTION_MAX` を超える（実測
    // 600字の撮影地で 602字）。サーバーが撮影地を200字に切る
    // （`api-user/src/photoUpdate.ts` ほか3か所）ので**今は踏めない**が、
    // 上限を持つ関数が上限を守らない形は残さない
    return truncate(`${truncate(text, Math.max(0, CAPTION_MAX - loc.length))}${loc}`, CAPTION_MAX);
}

/**
 * 画像サイトマップの XML を組み立てる。
 *
 * **`GET` から切り出してある**のは、中身をテストから直に見るため
 * （`feed.xml/route.ts` の `buildFeed` と同じ形。あちらは「制御文字1つで
 * フィード全体が壊れない」をここで固定している）。
 */
export function buildImageSitemap(photos: readonly Photo[]): string {
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

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        ...entries,
        "</urlset>",
    ].join("\n");
}

export async function GET() {
    const photos = (await loadAllPhotos()).filter((p) => p.published !== false && p.src);
    return new Response(buildImageSitemap(photos), {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
}
