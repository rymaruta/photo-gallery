/**
 * audit-photo-colors.ts — **色タグが「写真の色」と合っているかの材料を出す**（読み取り専用）。
 *
 * owner の報告（2026-09-23）:「色タグが仕事してない気がする。写真の色と
 * 違うタグが選ばれてることもある」。
 *
 * ## この道具は判定しない
 *
 * `lib/color/buckets.ts` は原因を既に書いている——`dominantColor` は sharp の
 * `stats().dominant` ＝**いちばん多い1ビン**で、写真ではたいてい影の色になる。
 * 代わりに `blurDataURL` の分布を取る案は一度試して、
 * 「**閾値の取り方で答えが変わり、面積で重み付けすると題が名乗る色ではなく
 * 背景の色が勝つ**」「正解を確かめる術が無い」として**採らなかった**。
 *
 * 足りないのは実装ではなく**正解**なので、この道具は**2つの見方を数字で
 * 並べるだけ**にする。決めるのは owner:
 *
 *     面積     ぼかしの画素をそのまま数える（背景が強い）
 *     彩度優先 無彩色の画素を除いて数える（主題の色が出やすい）
 *
 * ## 読み取りのみ
 *
 * DynamoDB は Scan するだけで、1バイトも書かない。画像も取りに行かない
 * （`blurDataURL` は行の中に入っている20pxの data URI）。
 */

import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createRequire } from "node:module";
import { colorBucketOf } from "../lib/color/buckets";
import { tallyBuckets, bucketLabel, decodeDataUri } from "../lib/color/audit";

const require_ = createRequire(import.meta.url);
// `sharp` は CommonJS。**ビルドには入らない**（この道具だけが読む）
const sharp = require_("sharp") as (input: Buffer) => {
    removeAlpha(): ReturnType<typeof sharp>;
    resize(w: number, h: number, o: { fit: "fill" }): ReturnType<typeof sharp>;
    raw(): ReturnType<typeof sharp>;
    toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer }>;
};

const { requireEnv } = require_("./lib/env") as { requireEnv: (k: string) => string };

const REGION = "ap-northeast-1";
const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");

type Row = Record<string, unknown>;

/** ぼかしを読める形に落とす。読めなければ理由を返す */
async function pixelsOf(blur: unknown): Promise<{ px: Uint8Array | null; note: string }> {
    if (typeof blur !== "string" || blur.length === 0) return { px: null, note: "ぼかしが無い" };
    const buf = decodeDataUri(blur);
    if (!buf) return { px: null, note: "data URI の形が違う" };
    try {
        // **透明度は落とす**（RGB の3値ずつで数える）。小さく揃えて、
        // 元のぼかしの大きさの違いが割合に響かないようにする
        const { data } = await sharp(buf).removeAlpha().resize(20, 20, { fit: "fill" })
            .raw().toBuffer({ resolveWithObject: true });
        return { px: new Uint8Array(data), note: "" };
    } catch (e) {
        return { px: null, note: `ぼかしを読めない: ${(e as Error).message.slice(0, 40)}` };
    }
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const fmt = (list: { id: string; ratio: number }[]) =>
    list.length === 0 ? "—" : list.map((x) => `${bucketLabel(x.id) || x.id} ${pct(x.ratio)}`).join(" / ");

(async () => {
    const ddb = new DynamoDBClient({ region: REGION });
    const items: Row[] = [];
    let key: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: PHOTOS_TABLE, ExclusiveStartKey: key as never }));
        items.push(...(res.Items ?? []).map((i) => unmarshall(i)));
        key = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (key);

    // 写真の行だけ・公開だけ（`src` を持つものが写真。`published` は未指定が公開）
    const photos = items.filter((p) => typeof p.src === "string" && p.published !== false);

    console.log(`公開写真: ${photos.length}枚\n`);
    console.log("【いま画面に出ている色タグ】は `dominantColor`（いちばん多い1ビン＝たいてい影）から決まる。");
    console.log("【面積】と【彩度優先】は、ぼかし画像を数え直したときの候補。**どれが正しいかは owner が見て決める**。\n");

    let noBlur = 0;
    let differs = 0;
    for (const p of photos) {
        const title = typeof p.title === "string" ? p.title
            : (p.title as { ja?: string } | undefined)?.ja ?? "";
        const dominant = typeof p.dominantColor === "string" ? p.dominantColor : "";
        const current = dominant ? colorBucketOf(dominant) : null;
        const { px, note } = await pixelsOf(p.blurDataURL);
        if (!px) noBlur++;
        const byArea = px ? tallyBuckets(px, false) : [];
        const byChroma = px ? tallyBuckets(px, true) : [];
        // **「違う」と数えるのは、彩度優先の1位が今のタグと違うときだけ。**
        // 面積は背景が勝つので、そちらのずれは「違う」の根拠にしない
        const top = byChroma[0]?.id;
        if (top && current && top !== current) differs++;
        console.log(`${String(p.id).slice(0, 8)}  ${title}`);
        console.log(`    いまのタグ  ${bucketLabel(current) || "（色なし）"}${dominant ? `  ${dominant}` : ""}`);
        console.log(`    面積        ${fmt(byArea)}`);
        console.log(`    彩度優先    ${fmt(byChroma)}${note ? `  （${note}）` : ""}`);
    }

    console.log(`\nまとめ`);
    console.log(`  ぼかしを読めなかった: ${noBlur}枚`);
    console.log(`  彩度優先の1位が、いまのタグと違う: ${differs}枚`);
    console.log(`\n次にやること: 上の一覧を写真と見比べて、「この写真はこの色」を owner が数枚決める。`);
    console.log(`それが決まるまでは直さない——閾値は動かせば必ず別の答えが出るので、正解を先に決める。`);
})().catch((e) => {
    console.error("色の監査に失敗:", e);
    process.exitCode = 1;
});
