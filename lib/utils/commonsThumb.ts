// lib/utils/commonsThumb.ts
//
// Wikimedia Commons のサムネイルの URL から、同じ写真の別の幅の URL を作る。
// 画面（クライアント）からも読むので、**JSON を import しない**（`lib/data/spotSamples.ts` は台帳側）。

/**
 * `…/thumb/a/ab/Name.jpg/1280px-Name.jpg` の `/1280px-` を `/<w>px-` に。
 * 形が違う・元より大きい幅を頼んだときは undefined。
 * Commons が標準で用意する幅（500・960）だけを使う（任意の幅は作り置きが無く遅い）
 */
export function commonsThumbAt(src: string, width: 500 | 960): string | undefined {
    const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+\/)(\d+)px-([^/]+)$/.exec(src);
    if (!m || Number(m[2]) <= width) return undefined;
    return `${m[1]}${width}px-${m[3]}`;
}

/** `<img srcset>` の値（500w・960w・元の幅）。縮小版が作れなければ undefined */
export function commonsSrcSet(src: string, width: number): string | undefined {
    const small = commonsThumbAt(src, 500);
    if (!small) return undefined;
    const mid = commonsThumbAt(src, 960);
    return [`${small} 500w`, ...(mid ? [`${mid} 960w`] : []), `${src} ${width}w`].join(", ");
}
