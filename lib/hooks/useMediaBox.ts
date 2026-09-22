import { useCallback, useEffect, useRef, useState } from "react";

export type MediaBox = { left: number; top: number; width: number; height: number };

/**
 * 写真や動画が**実際に描かれている矩形**を、囲みの中の座標で返す。
 *
 * ## なぜ要るか
 *
 * ストーリーの絵は `object-contain` なので、端末の縦横比によって
 * 上下（または左右）に余白ができる。文字の位置を**囲み**に対する割合で
 * 持つと、置いた端末と見る端末で**写真のどこに載るかがずれる**
 * ——「顔の横に置いた」が別の端末では空に浮く。
 *
 * 絵そのものの矩形に対する割合にすれば、どの端末でも同じ場所に載る。
 *
 * ## 測れないときは null
 *
 * `null` を返したら、呼ぶ側は**囲み全体**を使う（文字を消さない）。
 * jsdom にはレイアウトが無く `getBoundingClientRect` が全部 0 を返すので、
 * 「測れていない」と「幅が0」を分けないと**テストで文字が消える**。
 */
export function useMediaBox(containerRef: React.RefObject<HTMLElement | null>) {
    const [box, setBox] = useState<MediaBox | null>(null);
    const elRef = useRef<HTMLElement | null>(null);

    const measure = useCallback(() => {
        const el = elRef.current;
        const container = containerRef.current;
        if (!el || !container) { setBox(null); return; }
        const a = el.getBoundingClientRect();
        const b = container.getBoundingClientRect();
        // レイアウトが無い環境（jsdom）は全部 0。**0 は「測れていない」**
        if (!a.width || !a.height) { setBox(null); return; }
        const next = { left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height };
        setBox((prev) =>
            prev && prev.left === next.left && prev.top === next.top
                && prev.width === next.width && prev.height === next.height
                ? prev   // 参照を変えない（毎フレーム再描画しない）
                : next);
    }, [containerRef]);

    const roRef = useRef<ResizeObserver | null>(null);

    /**
     * 測る対象。ref コールバックとして渡す（付け外しで測り直す）。
     *
     * **見張りも付け替える。** 以前は `elRef` を差し替えるだけで、
     * `ResizeObserver` は最初に観測した要素を握ったままだった——
     * 絵と動画は別の要素なので（`StoryViewer` の `attachMedia` /
     * `attachVideo`）、種別をまたぐと**画面から消えた方**を見張り続け、
     * いま出ている絵の大きさが変わっても測り直しが走らなかった。
     * 囲みと `window` は別に観測しているので、**絵だけが変わる回**に効く。
     */
    const attach = useCallback((el: HTMLElement | null) => {
        const ro = roRef.current;
        if (ro && elRef.current !== el) {
            if (elRef.current) ro.unobserve(elRef.current);
            if (el) ro.observe(el);
        }
        elRef.current = el;
        measure();
    }, [measure]);

    useEffect(() => {
        const RO = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
        const ro = RO ? new RO(() => measure()) : null;
        roRef.current = ro;
        if (ro) {
            if (elRef.current) ro.observe(elRef.current);
            if (containerRef.current) ro.observe(containerRef.current);
        }
        // **回転とソフトキーボードも拾う。** `ResizeObserver` が無い環境の
        // 唯一の測り直しでもある
        window.addEventListener("resize", measure);
        window.addEventListener("orientationchange", measure);
        return () => {
            ro?.disconnect();
            if (roRef.current === ro) roRef.current = null;
            window.removeEventListener("resize", measure);
            window.removeEventListener("orientationchange", measure);
        };
    }, [measure, containerRef]);

    return { attach, box, measure };
}
