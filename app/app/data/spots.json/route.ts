import { spotIndexFeedJson } from "@/lib/data/spotFeed";

/**
 * **アプリが読む撮影スポットの索引**（`/app/data/spots.json`）。
 *
 * `dynamic = "force-static"` なのでビルド時に1回だけ組み立てて
 * `out/app/data/spots.json` になる（`app/feed.xml/route.ts` と同じ形）。
 * 写真の `app/data/photos.json` の隣に置く——iOS の `AppConfig.publicSpotsURL`
 * が前からこの場所を指していた（Web 側が配っていなかっただけ）。
 *
 * 中身は `lib/data/spotFeed.ts` が決める（いまは公開済みだけ。下書きを建てる設定なら `stage` で区別して載る）。
 * `scripts/deploy-static-site.js` は `.json` を `public, max-age=3600` で配る
 * （`NO_CACHE_KEYS` には入れない。台帳は人が PR で書く＝日に何度も変わらない）。
 */
export const dynamic = "force-static";

export function GET(): Response {
    return new Response(spotIndexFeedJson(), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            // 静的配信なので実際は CDN の設定が効く。意図の記録
            "Cache-Control": "public, max-age=3600",
        },
    });
}
