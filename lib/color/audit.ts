import { colorBucketOf, COLOR_BUCKETS } from "./buckets";

/**
 * **色タグが「写真の色」と合っているかを、owner が見て判断するための材料。**
 *
 * owner の報告（2026-09-23）:「色タグが仕事してない気がする。写真の色と
 * 違うタグが選ばれてることもある」。
 *
 * ## 原因は分かっている。足りないのは「正解」
 *
 * `buckets.ts` の冒頭が書いているとおり、`dominantColor` は sharp の
 * `stats().dominant` ＝**いちばん多い1ビン**で、写真ではたいてい影の色になる。
 * だから葉や草が主役でも、影の暗色が代表値になって黒や青へ行く。
 *
 * 代わりに `blurDataURL`（20px の公開ぼかし）の**分布**を取る案は一度試して
 * あるが、「**閾値の取り方で答えが変わり、面積で重み付けすると題が名乗る色
 * ではなく背景の色が勝つ**（紫陽花は葉が面積を取る）」「正解を確かめる術が
 * 無い」として**採らなかった**。
 *
 * ## だからこの道具は「決めない」
 *
 * **2つの見方を数字で並べるだけ**にする。決めるのは owner:
 *
 *   面積     ぼかしの画素をそのまま数える（背景が強い）
 *   彩度優先 **無彩色の画素を除いて**数える（主題の色が出やすい）
 *
 * どちらが正しいかは写真による。並べて見て初めて「この写真はこっち」が
 * 言える——それが `buckets.ts` に無かったもの。
 */

/** 1枚ぶんの監査結果 */
export type ColorAuditRow = {
    id: string;
    title: string;
    /** 保存されている代表色（`#rrggbb`）。無ければ空 */
    dominant: string;
    /** いま画面に出ているタグ（`dominantColor` から。無ければ空） */
    current: string;
    /** 面積で数えた上位（バケツ id と割合） */
    byArea: { id: string; ratio: number }[];
    /** 無彩色を除いて数えた上位 */
    byChroma: { id: string; ratio: number }[];
    /** ぼかしを読めなかった理由（読めたときは空） */
    note: string;
};

/** 無彩色と見なす線。**`buckets.ts` の `ACHROMATIC_MAX_SATURATION` とは別物** */
const CHROMA_MIN = 24;

/** 上位いくつまで出すか */
const TOP = 3;

/**
 * 画素の並び（RGB の3値ずつ）から、バケツごとの割合を数える。
 *
 * `skipAchromatic` が真なら、**彩度の低い画素を数えない**——背景の暗色や
 * 白い空が面積を取って主題を覆うのを外して見るため。
 */
export function tallyBuckets(
    pixels: Uint8Array | Uint8ClampedArray | number[],
    skipAchromatic: boolean,
): { id: string; ratio: number }[] {
    const count = new Map<string, number>();
    let total = 0;
    for (let i = 0; i + 2 < pixels.length; i += 3) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (skipAchromatic && Math.max(r, g, b) - Math.min(r, g, b) < CHROMA_MIN) continue;
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        const id = colorBucketOf(hex);
        if (id === null) continue;
        count.set(id, (count.get(id) ?? 0) + 1);
        total++;
    }
    if (total === 0) return [];
    return [...count.entries()]
        .map(([id, n]) => ({ id, ratio: n / total }))
        // **同数のときは `COLOR_BUCKETS` の順**。並びが実行のたびに変わらない
        .sort((a, b) => b.ratio - a.ratio
            || COLOR_BUCKETS.findIndex((x) => x.id === a.id) - COLOR_BUCKETS.findIndex((x) => x.id === b.id))
        .slice(0, TOP);
}

/** `#rrggbb` のバケツを画面に出す名前で返す（無ければ空） */
export function bucketLabel(id: string | null): string {
    return COLOR_BUCKETS.find((b) => b.id === id)?.label ?? "";
}

/**
 * `data:image/...;base64,...` の中身を取り出す。
 * **形が違えば `null`**（推測で復号しない）。
 */
export function decodeDataUri(uri: string): Buffer | null {
    const m = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec((uri ?? "").trim());
    if (!m) return null;
    try {
        const buf = Buffer.from(m[1], "base64");
        return buf.length > 0 ? buf : null;
    } catch {
        return null;
    }
}
