import type { Photo } from "../data/photos";

/**
 * Color Journey — 写真の**色**でさがす。
 *
 * ## どの値を見るか（実データで数えてから決めた）
 *
 * 写真には既に `dominantColor`（`#rrggbb`）が入っている。**本番の公開写真
 * 39枚すべてが持っている**（2026-09-21 に公開APIで実測）。新しい画像解析を
 * 作る前にこれで足りるかを数えた。
 *
 * ⚠️ **コミット済みの `app/data/photos.json` は `dominantColor` を持たない**
 * （30枚中0枚。`thumbSrc` `width` `blurDataURL` と同じく派生の欄が落ちた
 * 断面）。`scripts/verify-local.sh` が「本番のデータの形」として足すのも
 * `thumbSrc` と AVIF だけで、色は足さない。つまり**手元とテストでは
 * この機能は何も出ない**。それを異常と扱わないこと——色を持たない写真は
 * 静かに数えないのが正しい（`colorBucketOf` が `null` を返す）。
 *
 * ## チップの分け方（4通り数えて選んだ）
 *
 * 本番39枚を owner の10色に割ると:
 *
 *     明度優先 (l<.15黒 / l>.90白 / s<.15モノクロ)
 *       青10 橙2 黄1 白2 黒18 モノクロ6    空4つ・最大の偏り 18/39=46%
 *     彩度優先 (s<.10 でだけ無彩色に落とす)   ← これを採る
 *       青14 赤1 橙3 黄4 白1 黒13 モノクロ3  空3つ・最大の偏り 14/39=36%
 *
 * **彩度を先に見る**と「暗いが青い」写真（`#081828` など）が黒に吸われずに
 * 青へ行く。このサイトは夜・北欧・室内が多く明度の中央値が 0.19 しかない
 * ので、明度で先に切ると**半分近くが黒に落ちて色でさがせなくなる**。
 *
 * ## 分かっている限界（直すなら次の一手）
 *
 * **緑が1枚も立たない。** `dominantColor` は sharp の `stats().dominant`
 * ＝**いちばん多い1ビン**で、写真ではたいてい影の色になる（実際、保存値は
 * 全39枚が16段階に量子化されていて、各チャンネルが `0x?8` に揃っている）。
 * だから葉や草が主役でも、影の暗色が代表値になって黒や青へ行く。
 *
 * 代わりに `blurDataURL`（20px の公開ぼかし）を復号して**色の分布**を取ると
 * 緑が7枚立つところまで確かめた。ただし閾値の取り方で答えが変わり
 * （同じ写真が「紅白 → 赤 / 緑」と入れ替わった）、面積で重み付けすると
 * **題が名乗る色ではなく背景の色**が勝つ（紫陽花は葉が面積を取る）。
 * 正解を確かめる術が無いので**採らなかった**。毎回39枚を復号する費用も
 * 掛かる（このサイトは表示速度が最優先）。owner が数枚見て決められる
 * ようになったら、そのときに差し替える。
 */

/** チップ1つ */
export type ColorBucket = {
    /** 安定な識別子。URL とテストが掴む */
    id: string;
    /** 画面に出す名前 */
    label: string;
    /** チップに置く丸の色。**写真の色ではなく目印**なので固定値 */
    swatch: string;
};

/**
 * owner が挙げた10色。**この順で並べる。**
 *
 * 枚数の多い順に並べ替えない——写真が1枚増えるたびにチップが入れ替わると、
 * 「さっき左端にあった色が真ん中にある」としか見えない。
 * **中身の無い色は描かない**（`visibleColorBuckets`）ので、並びは
 * 飛び飛びになるが順序そのものは動かない。
 */
export const COLOR_BUCKETS: readonly ColorBucket[] = [
    { id: "blue", label: "青", swatch: "#3b82f6" },
    { id: "green", label: "緑", swatch: "#22c55e" },
    { id: "red", label: "赤", swatch: "#ef4444" },
    { id: "orange", label: "橙", swatch: "#f97316" },
    { id: "yellow", label: "黄", swatch: "#eab308" },
    { id: "pink", label: "桃", swatch: "#ec4899" },
    { id: "purple", label: "紫", swatch: "#a855f7" },
    { id: "white", label: "白", swatch: "#f5f5f5" },
    { id: "black", label: "黒", swatch: "#18181b" },
    { id: "mono", label: "モノクロ", swatch: "#9ca3af" },
];

/** `#rrggbb` だけを受ける（3桁の短縮形も名前付きの色も受けない） */
const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * 無彩色と見なす彩度の線。**ここを動かすと分布が変わる**ので、
 * 上のコメントの実測とセットで読むこと。
 */
const ACHROMATIC_MAX_SATURATION = 0.10;
/** 無彩色のうち、黒と白に振り分ける明度の線 */
const BLACK_MAX_LIGHTNESS = 0.20;
const WHITE_MIN_LIGHTNESS = 0.85;
/**
 * **これより暗ければ、色味があっても黒。**
 *
 * HSL の彩度は明度が 0 に近いほど分母が小さくなり、**ほぼ真っ黒の枠に
 * わずかな色味があるだけで彩度が跳ね上がる**——`#180808`（r=24,g=8,b=8）は
 * 明度 0.063 なのに彩度 0.50 で、彩度だけ見ると「赤」になる。レビューで
 * 指摘され、本番39枚で測ると `#081818` `#180808` `#181808`（3枚・全部
 * 明度 0.063）が青・赤・黄に散っていた。目で見れば黒い枠なので黒へ寄せる。
 *
 * 0.08 は「暗いが青い」`#081828`（明度 0.094）を**青に残す**線。
 * 0.10 にすると青に落ちて、彩度優先にした意味が1枚ぶん減る。
 * この線で本番は 37枚 → **38/39枚** が拾われる（赤1枚が黒に入る）。
 */
const BLACK_LIGHTNESS_FLOOR = 0.08;

/**
 * 色相の境目（度）。`from` 以上 次の `from` 未満。
 * 赤だけは0度をまたぐので `RED_WRAP_FROM` 以上も赤。
 */
const RED_WRAP_FROM = 345;
const HUE_RANGES: readonly { from: number; id: string }[] = [
    { from: 0, id: "red" },
    { from: 15, id: "orange" },
    { from: 45, id: "yellow" },
    { from: 70, id: "green" },
    { from: 170, id: "blue" },
    { from: 260, id: "purple" },
    { from: 290, id: "pink" },
];

/** `#rrggbb` を 0〜255 の3値にする。形が違えば `null` */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
    const m = HEX.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** 0〜255 の3値を HSL（色相0〜360・彩度0〜1・明度0〜1）にする */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
    const d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return { h: 0, s: 0, l };
    let h: number;
    if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    // **明度が 0 か 1 に貼り付くと分母が 0 になる。** 真っ黒・真っ白は
    // d === 0 で上に抜けるので、ここに来る値の分母は 0 にならない。
    //
    // **1 を超える分は畳む。** 純色に近い値で `1 - |2l-1|` が `d` より
    // ほんの少し小さく出て、彩度が `1.0000000000000002` になる
    // （総当たりで数えると 2,137 通り。例: `rgb(0,0,17)`）。
    // いまの使い道（0.10 との比較）では結果は変わらないが、
    // **0〜1 を名乗る関数が 1 を超えて返る**のを残さない——次に誰かが
    // これを割合として使ったときに、静かに 100% を超える。
    return { h: h * 60, s: Math.min(1, d / (1 - Math.abs(2 * l - 1))), l };
}

/** 色相（度）をチップの id にする */
function hueBucket(h: number): string {
    // 0〜360 に畳んでから見る（負や360超を渡されても壊れない）
    const deg = ((h % 360) + 360) % 360;
    if (deg >= RED_WRAP_FROM) return "red";
    let id = HUE_RANGES[0].id;
    for (const range of HUE_RANGES) {
        if (deg >= range.from) id = range.id;
        else break;
    }
    return id;
}

/**
 * `#rrggbb` をチップの id にする。形が違えば `null`。
 *
 * **彩度を先に見る**（理由はファイル冒頭）。無彩色のときだけ明度で
 * 黒・白・モノクロに分ける。
 */
export function colorBucketOf(hex: string): string | null {
    const rgb = parseHexColor(hex);
    if (!rgb) return null;
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (l < BLACK_LIGHTNESS_FLOOR) return "black";
    if (s < ACHROMATIC_MAX_SATURATION) {
        if (l < BLACK_MAX_LIGHTNESS) return "black";
        if (l > WHITE_MIN_LIGHTNESS) return "white";
        return "mono";
    }
    return hueBucket(h);
}

/**
 * その写真の色。`dominantColor` を持たない写真は `null`。
 *
 * **持たない写真を既定の色に入れない。** 手元の断面は30枚全部が色無しなので、
 * 既定を置くと**全部が同じチップに入って「色でさがす」が嘘になる**。
 */
export function photoColorBucket(photo: Pick<Photo, "dominantColor">): string | null {
    const hex = photo.dominantColor;
    return typeof hex === "string" ? colorBucketOf(hex) : null;
}

/**
 * チップを出す最小枚数。
 *
 * **1枚のチップは出さない。** 押した先に1枚しか無いチップは、押す前の
 * 見た目（他と同じ大きさの丸）が約束しているものと釣り合わない。
 * 撮影地の集約ページが同じ理由で2枚を線にしている（`MIN_INDEXABLE_LOCATION`）。
 *
 * 実データでの効き（本番39枚）: 2枚以上にすると**6色 → 5色**になり、
 * 38/39 枚が拾われる（落ちるのは白1枚）。
 */
export const MIN_PHOTOS_PER_COLOR = 2;

/**
 * 色ごとに写真を仕分ける。**渡された並び順を保つ**（呼ぶ側が並べた順で返る）。
 */
export function groupPhotosByColor<T extends Pick<Photo, "dominantColor">>(
    photos: readonly T[],
    bucketOf: (photo: T) => string | null = photoColorBucket,
): Map<string, T[]> {
    const out = new Map<string, T[]>();
    for (const photo of photos) {
        const id = bucketOf(photo);
        if (id === null) continue;
        const list = out.get(id);
        if (list) list.push(photo);
        else out.set(id, [photo]);
    }
    return out;
}

/**
 * 画面に出すチップだけを、`COLOR_BUCKETS` の順で返す。
 *
 * **中身の無い色は返さない。** 押しても何も出ないチップを10個並べるのは、
 * このリポジトリが決めている「発火しない機能を作らない」の逆。
 */
export function visibleColorBuckets<T extends Pick<Photo, "dominantColor">>(
    photos: readonly T[],
    /**
     * 色の決め方を差し替える口。**既定は `dominantColor`**。
     *
     * 画面は `useBlurColors` が決めたぶんだけ差し替えて渡す
     * ——`dominantColor` は「いちばん多い1ビン＝たいてい影」で、
     * 本番39枚のうち**21枚で中身と食い違っていた**（実測 2026-09-24）。
     */
    bucketOf: (photo: T) => string | null = photoColorBucket,
): { bucket: ColorBucket; photos: T[] }[] {
    const grouped = groupPhotosByColor(photos, bucketOf);
    const out: { bucket: ColorBucket; photos: T[] }[] = [];
    for (const bucket of COLOR_BUCKETS) {
        const list = grouped.get(bucket.id);
        if (list && list.length >= MIN_PHOTOS_PER_COLOR) out.push({ bucket, photos: list });
    }
    return out;
}
