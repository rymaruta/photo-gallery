import { loadAllPhotos } from "@/lib/server/photos";
import { spotPhotoLinksJson } from "@/lib/server/spotAutoLinks";

/**
 * **写真を撮影スポットに自動で結んだ表**（`/app/data/spot-photo-links.json`・2026-10-31・journey.photo-ios#425）。
 *
 * `spot-feed/` の隣。iOS が読み、撮影スポットの行・県の段・写真の詳細で `spotId` と同じに扱う
 * （決まりは `lib/utils/spotAutoLink.ts` の1か所。Swift に写しを作らない）。形は
 * `{"v":1,"links":{"<写真 id>":"<撮影スポット id>"}}` で固定（`spotPhotoLinks.test.ts`）:
 *   - 入るのは**自動の結びだけ**。本人が選んだ `spotId` を持つ写真・外した写真（`spotAuto: "off"`）・
 *     非公開の写真は入らない
 *   - 読む側は「写真の `spotId` → 無ければこの表」の順で引く。写真の `spotAuto` が `"off"` なら
 *     表にあっても結ばない（作り直しまでの数分の間に外された写真）
 * `.json` は `public, max-age=3600` で配られ、デプロイのたびに CDN から消される。
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
    return new Response(spotPhotoLinksJson(await loadAllPhotos()), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
