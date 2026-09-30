import { spotSearchJson } from "@/lib/data/spotSearchFeed";

/**
 * **「さがす」が読む撮影スポットの名前だけの索引**（`/app/data/spot-search.json`）。
 *
 * ビルド時に1回だけ組み立てて `out/app/data/spot-search.json` になる（`spots.json` の隣）。
 * 中身は `lib/data/spotSearchFeed.ts`。Web の画面だけが読む（アプリは読まない）。
 * `.json` は `public, max-age=3600` で配られ、デプロイのたびに CDN から消される。
 */
export const dynamic = "force-static";

export function GET(): Response {
    return new Response(spotSearchJson(), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
