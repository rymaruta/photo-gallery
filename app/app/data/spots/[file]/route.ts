import { spotBodies, spotBodyJson } from "@/lib/data/spotBody";
import { withPlaceholderParam, EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";

/**
 * **アプリが撮影スポットの画面で読む本文**（`/app/data/spots/<slug>.json`）。
 *
 * 公開済みの場所ごとに、ビルド時に1回だけ書き出す（`out/app/data/spots/<slug>.json`）。
 * 索引（`/app/data/spots.json`）の隣。中身は `lib/data/spotBody.ts` が決める。
 * 配り方は索引と同じ `public, max-age=3600`（`scripts/deploy-static-site.js`）で、
 * デプロイのたびに CDN から消される（`isInvalidatable`）。
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): { file: string }[] {
    // 0件だと `output: export` がビルドを落とすので、1件は返す（`/spots/[slug]` と同じ）
    return withPlaceholderParam(spotBodies().map((b) => ({ file: `${b.slug}.json` })), "file");
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
    const { file } = await params;
    // 仮の1件（公開済みが0件の回）は中身の無い JSON。アプリはこの名前を読みに行かない
    if (file === EMPTY_PARAM_PLACEHOLDER) {
        return new Response("null", { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    const json = spotBodyJson(file);
    if (json === undefined) return new Response("Not Found", { status: 404 });
    return new Response(json, {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
