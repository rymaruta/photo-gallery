import { spotFeedFiles, spotFeedFileJson } from "@/lib/data/spotFeedShards";

/**
 * **数を増やした撮影スポットの置き場**（`/app/data/spot-feed/index.json` と `/app/data/spot-feed/<区分>.json`・2026-10-07）。
 *
 * 軽い索引（全件）と、区分ごとの詳細（行は `spots.json` と同じ中身）をビルド時に1回だけ書き出す。
 * 中身は `lib/data/spotFeedShards.ts`、設計は `docs/spot-feed-sharding.md`。
 * 古いアプリの `spots.json`（固定した行だけ）はそのまま隣に残る。
 * `.json` は `public, max-age=3600` で配られ、デプロイのたびに CDN から消される。
 * ビルドに無くなった区分は猶予なしで消す（`deletesImmediately`）
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): { file: string }[] {
    // 索引は0件でも必ず1つある（`output: export` が0件で落ちることは無い）
    return spotFeedFiles().map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
    const { file } = await params;
    const json = spotFeedFileJson(file);
    if (json === undefined) return new Response("Not Found", { status: 404 });
    return new Response(json, {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
