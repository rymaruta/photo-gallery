"use client";

import { useEffect, useState } from "react";
import { tallyBuckets } from "./audit";

/**
 * **写真の色を、ぼかし画像から決め直す。**
 *
 * ## なぜ要るか（本番39枚で実測・2026-09-24）
 *
 * owner:「色タグが仕事してない気がする。写真の色と違うタグが選ばれてる
 * こともある」。`maintenance` の `photo-colors` で数えたら、そのとおりだった:
 *
 *     39枚中 21枚（54%）で、いまのタグと中身が食い違う
 *     「黒」と出ている16枚のうち、**無彩色しか無いのは1枚だけ**
 *     ヴェルサイユ宮殿  黒 #080808 → 実際は 橙 98%
 *     高千穂峡          黒 #181818 → 実際は 緑 95%
 *     北海道の桜        黒 #080808 → 実際は 橙 100%
 *
 * 原因は `buckets.ts` が自分で書いていたとおり——`dominantColor` は sharp の
 * `stats().dominant` ＝**いちばん多い1ビン**で、写真ではたいてい影の色になる。
 * 実データでも `#080808` `#181818` のような**ほぼ真っ黒**が12枚あった。
 *
 * ## なぜ画面側で計算するのか
 *
 * 直す道は2つあった:
 *
 *   A ビルド時に正しい色を **DynamoDB へ書く** … 本番データへの書き込み＝承認が要る
 *   B 画面側で `blurDataURL` から**その場で計算** … DB を触らない
 *
 * **`usePhotos` は API の応答で配列ごと差し替える**（`setPhotos(data)`）ので、
 * ビルド時のファイル（`app/data/photos.json`）にだけ書いても、API が届いた
 * 瞬間に消える。だから B。`blurDataURL` は API の応答に既に入っている。
 *
 * ## 重さ（実ブラウザで測ってから入れた・2026-09-24）
 *
 * 本番と同じ形のぼかし（20px・WebP・quality 40）39枚を、この経路そのままで
 * Chromium に通した:
 *
 *     そのまま        39枚 合計 **37ms** ／ 1枚 中央 1.00ms ・ 最大 2.20ms
 *     CPU 4倍遅い     39枚 合計 **184ms** ／ 1枚 中央 4.80ms ・ 最大 6.70ms
 *
 * **1枚ずつ `await` で回す**ので、いちばん長く主線を塞ぐのは1枚ぶん
 * ——遅い端末でも 6.7ms で、1フレーム（16ms）に収まる。合計が 184ms でも
 * 画面が固まらないのはそのため。**同じ data URI は二度復号しない**
 * （モジュール内の控え）ので、一覧が入れ替わっても効かない。
 * 復号が済むまでは `dominantColor` のまま出す（呼ぶ側の落とし先）。
 *
 * ## 決め方
 *
 *   1. **無彩色の画素を除いた**分布の1位（主題の色）
 *   2. 1つも残らなければ、除かない分布の1位（本当にモノクロ・黒の写真）
 *   3. ぼかしが無い／読めないときは `null`（呼ぶ側が `dominantColor` に落とす）
 */

/** 復号の控え。**data URI を鍵にする**——同じぼかしは二度読まない */
const cache = new Map<string, string | null>();

/** ぼかしを縮める先。`audit.ts` の道具と同じ大きさで数える */
const SIZE = 20;

/** 1枚ぶん。読めなければ `null` */
async function bucketFromBlur(dataUri: string): Promise<string | null> {
    const hit = cache.get(dataUri);
    if (hit !== undefined) return hit;
    let out: string | null = null;
    try {
        const res = await fetch(dataUri);
        const bmp = await createImageBitmap(await res.blob(), { resizeWidth: SIZE, resizeHeight: SIZE });
        const canvas = new OffscreenCanvas(SIZE, SIZE);
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
            const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
            // `tallyBuckets` は RGB の3値ずつを読む。ImageData は RGBA なので詰め直す
            const rgb = new Uint8Array((data.length / 4) * 3);
            for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
                rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
            }
            // **主題の色を先に見る**（無彩色を除く）。1つも残らなければ除かない方
            out = tallyBuckets(rgb, true)[0]?.id ?? tallyBuckets(rgb, false)[0]?.id ?? null;
        }
        bmp.close();
    } catch {
        out = null;
    }
    cache.set(dataUri, out);
    return out;
}

/** この環境で復号できるか（サーバー・古いブラウザでは静かに諦める） */
function canDecode(): boolean {
    return typeof window !== "undefined"
        && typeof createImageBitmap === "function"
        && typeof OffscreenCanvas === "function";
}

/**
 * 写真の id → 色のバケツ。**まだ決まっていない間は空の Map**
 * （呼ぶ側は `dominantColor` に落とす）。
 */
export function useBlurColors(
    photos: readonly { id: string; blurDataURL?: string }[],
): ReadonlyMap<string, string> {
    const [byId, setById] = useState<ReadonlyMap<string, string>>(new Map());

    useEffect(() => {
        if (!canDecode()) return;
        let aborted = false;
        // **同期的に state を戻さない**（`react-hooks/set-state-in-effect`）。
        // `useMyPhotoIdList` と同じ形
        void (async () => {
            const out = new Map<string, string>();
            for (const p of photos) {
                if (aborted) return;
                const uri = p.blurDataURL;
                if (typeof uri !== "string" || uri.length === 0) continue;
                const id = await bucketFromBlur(uri);
                if (id) out.set(p.id, id);
            }
            if (aborted) return;
            // **1枚も決まらなければ state を触らない**（描き直しを1回節約する）
            if (out.size > 0) setById(out);
        })();
        return () => { aborted = true; };
    }, [photos]);

    return byId;
}
