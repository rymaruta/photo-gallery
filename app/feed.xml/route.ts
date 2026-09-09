import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { siteConfig } from "../../lib/utils/seo";
import RAW_PHOTOS, { getLocalized, getLocalizedParagraphs, type Photo } from "@/lib/data/photos";
import { compareNewest } from "../../lib/utils/photoOrder";

export const dynamic = "force-static";

/**
 * RSS 2.0 フィード（`/feed.xml`）。
 *
 * **なぜ要るか**: このサイトには「また来る」ための入口が1つも無かった。
 * 検索から1枚見て帰る人しかいない状態で、購読の手段が無い。
 * フィードは (a) 読み手が戻ってくる導線、(b) 収集サービス（Feedly 等）
 * 経由の露出、(c) クローラが更新を知る早い手がかり、の3つを兼ねる。
 *
 * **静的書き出しの中で作る。** `dynamic = "force-static"` なのでビルド時に
 * 1回だけ組み立てて `out/feed.xml` になる。sitemap と同じ形で、実行時の
 * コストは0。
 *
 * **中身は抜粋だけ。** 説明の全文を載せると、フィードだけで完結してしまい
 * 「サイトに来てもらう」目的から外れる。
 */

async function loadPhotos(): Promise<Photo[]> {
    const p = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(p)) return JSON.parse(await readFile(p, "utf-8")) as Photo[];
    return RAW_PHOTOS as Photo[];
}

/**
 * XML に入れてよい文字だけにして、記号を実体参照にする。
 *
 * **制御文字を落とすのは必須。** 利用者が入れた文字がそのまま入るので、
 * 1文字混ざると**フィード全体が parse error** になる
 * （`app/sitemap-images.xml` が同じ理由で同じことをしている。
 * あちらは制御文字1つでサイトマップが丸ごと壊れた）。
 */
function xmlText(value: string): string {
    return value
        // XML 1.0 の Char に無いもの（タブ・改行・復帰は残す）
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** 抜粋。長い説明を丸ごと載せない（サイトに来てもらうため） */
export function feedExcerpt(photo: Photo): string {
    const ja = getLocalizedParagraphs(photo.description, "ja");
    const text = (ja.length > 0 ? ja : getLocalizedParagraphs(photo.description, "en")).join(" ");
    const place = (photo.location ?? "").toString().trim();
    const base = text || (place ? `${place}で撮影した写真。` : "写真。");
    return base.length > 140 ? `${base.slice(0, 140)}…` : base;
}

/** 最新の写真だけ。フィードは「新しいもの」を伝えるもの */
export const FEED_MAX_ITEMS = 30;

/** フィードの本文を組み立てる（テストから直接呼べるように分けてある） */
export function buildFeed(photos: Photo[]): string {
    const picked = photos
        .filter((p) => p.published !== false)
        .sort(compareNewest)
        .slice(0, FEED_MAX_ITEMS);

    const updated = picked[0]?.updatedAt ?? picked[0]?.createdAt ?? new Date().toISOString();
    const items = picked.map((p) => {
        const title = getLocalized(p.title, "ja") || getLocalized(p.title, "en") || "無題";
        const url = `${siteConfig.url}/photo/${p.id}`;
        const date = new Date(p.createdAt ?? updated).toUTCString();
        return [
            "    <item>",
            `      <title>${xmlText(title)}</title>`,
            `      <link>${xmlText(url)}</link>`,
            // **guid は永続する URL**（ID が変わらない限り、収集側が
            // 「同じ記事」と分かる）
            `      <guid isPermaLink="true">${xmlText(url)}</guid>`,
            `      <pubDate>${xmlText(date)}</pubDate>`,
            `      <description>${xmlText(feedExcerpt(p))}</description>`,
            "    </item>",
        ].join("\n");
    });

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "  <channel>",
        `    <title>${xmlText(siteConfig.name)}</title>`,
        `    <link>${xmlText(siteConfig.url)}</link>`,
        `    <description>${xmlText(siteConfig.description)}</description>`,
        "    <language>ja</language>",
        `    <lastBuildDate>${xmlText(new Date(updated).toUTCString())}</lastBuildDate>`,
        // 自分の場所を名乗る（収集側が正規のフィードURLを知る）
        `    <atom:link href="${xmlText(`${siteConfig.url}/feed.xml`)}" rel="self" type="application/rss+xml" />`,
        ...items,
        "  </channel>",
        "</rss>",
    ].join("\n");
}

export async function GET(): Promise<Response> {
    return new Response(buildFeed(await loadPhotos()), {
        headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            // 静的配信なので実際は CDN の設定が効く。意図の記録
            "Cache-Control": "public, max-age=3600",
        },
    });
}
