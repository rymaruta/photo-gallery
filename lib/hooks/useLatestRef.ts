import { useEffect, useLayoutEffect, useRef } from "react";

/** サーバーの事前描画では `useLayoutEffect` が警告を出すので、そちらでは `useEffect` */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * いちばん新しい値を持つ ref。**描画の途中では書かない**（`react-hooks/refs`）。
 *
 * 描き終えた直後（layout effect）に書くので、同じ回の `useEffect` と、そのあとの
 * イベント（地図のズーム・押されたピン）からは必ず新しい値が読める。
 * 地図のように「作り直したくないもの」に、関数や配列を依存に入れずに渡すための口。
 */
export function useLatestRef<T>(value: T): { readonly current: T } {
    const ref = useRef(value);
    useIsoLayoutEffect(() => { ref.current = value; });
    return ref;
}
