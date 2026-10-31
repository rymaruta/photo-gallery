import { spotMatchIndex } from "@/lib/server/spotAutoLinks";

/**
 * **投稿画面が撮影スポットの候補を選ぶための索引**（`/app/data/spot-match.json`・2026-10-31・journey.photo-ios#425）。
 *
 * 公開済みの撮影スポットの、突き合わせに使う名前・別名（地名だけのものは外してある）・位置・県だけ。
 * 中身と決まりは `lib/utils/spotAutoLink.ts`——静的な生成の自動の結びと同じ索引なので、
 * 投稿で選ばれる候補と、あとで自動で結ばれる先が割れない。
 * 投稿画面が撮影地・題・説明を入れたあとに1回だけ読む（約 270KB・圧縮して配られる）。
 */
export const dynamic = "force-static";

export function GET(): Response {
    return new Response(JSON.stringify(spotMatchIndex()), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
