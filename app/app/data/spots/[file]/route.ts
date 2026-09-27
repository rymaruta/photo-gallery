import { spotBodies, spotBodyJson } from "@/lib/data/spotBody";

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
    return spotBodies().map((b) => ({ file: `${b.slug}.json` }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
    const { file } = await params;
    const json = spotBodyJson(file);
    if (json === undefined) return new Response("Not Found", { status: 404 });
    return new Response(json, {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
