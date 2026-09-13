"use client";

/**
 * 一覧（正方形）に出る範囲を白枠で示し、**掴んで動かせる**部品。
 *
 * owner の指示「この一覧に表示する部分は固定ではなくユーザが任意に
 * ずらせるといいね」。動かした位置は `focalPoint`（0〜1 の割合）として
 * 保存され、一覧・拡大表示・写真ページが `object-position` で同じ場所を
 * 出す——**読む側は前からこれを見ていたが、書く口がどこにも無かった**ので
 * 誰も設定できず、実質いつでも中央だった。
 *
 * **アップロードと編集の2画面で使う。** 片方に直書きすると、もう片方だけ
 * 挙動がずれる（このリポジトリが何度も踏んでいる形）。読み込めなかった
 * ときの出方だけ画面ごとに違うので、そこは `fallback` で受け取る。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

export type FocalPoint = { x: number; y: number };

// **横長なら左右、縦長なら上下にしか動かない。** 短い辺は枠と同じ長さなので
// 動かす余地が無い。動かない軸を掴めるように見せると「効かない」と読まれる。
export default function CropFramePicker({ src, hint, focalPoint, onChange, fallback, crossOrigin, onLoadError }: {
    src: string;
    hint: string;
    focalPoint?: FocalPoint;
    onChange?: (fp: FocalPoint) => void;
    /** 読み込めなかったときに代わりに出すもの（文言は画面ごとに違う） */
    fallback: React.ReactNode;
    crossOrigin?: "anonymous" | "use-credentials";
    /** 読み込みに失敗したことを外へ伝える（控えの掃除など） */
    onLoadError?: (el: HTMLImageElement) => void;
}) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    // **このブラウザで開けなかった写真**（PC の Chrome で選んだ HEIC など。
    // `addFiles` が断るのは「画像でない」「GIF」「50MB超」だけなので、
    // 種別が画像で開けないファイルはここまで来る）。
    // `block w-auto max-h-56` は高さを予約しないので、`onError` を持たない
    // 頃は**プレビューが高さ 0 に潰れ**（Chromium 実測 390x224 → 390x0）、
    // 切り抜きの白枠も出ないまま「公開」を押して初めて断られていた。
    // 文言は `unstrippableMessage` の「開けなかった」と同じものを使う
    // ——公開を押したときに出るのと同じ文にする（画面ごとに書き分けない）
    // 下ろす側は書かない——`src` は項目ごとに1回だけ作られ（`addFiles` の
    // `URL.createObjectURL`）、同じ instance で差し替わらない。念のため
    // 呼び出し側で `key={it.preview}` にしてあるので、変わったら作り直される。
    // 「入るたびに下ろす」の effect を足すと**踏まれない分岐**になり、
    // このリポジトリが避けている死にコードになる
    const [failed, setFailed] = useState(false);

    const measure = useCallback(() => {
        const el = imgRef.current;
        if (!el) return;
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        setSize({ w, h });
    }, []);

    useEffect(() => {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [measure]);

    const fp = focalPoint ?? { x: 0.5, y: 0.5 };
    const side = size ? Math.min(size.w, size.h) : 0;
    // 枠の左上。**中心の割合から、はみ出さない位置へ直す。**
    // 素直に `fp.x * w - side/2` と置くと端で枠が画像から出る
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const box = size
        ? { side, left: clamp(fp.x * size.w - side / 2, size.w - side), top: clamp(fp.y * size.h - side / 2, size.h - side) }
        : null;
    const movable = size ? { x: size.w > size.h, y: size.h > size.w } : { x: false, y: false };
    const draggable = !!onChange && (movable.x || movable.y);

    /**
     * 画面の座標を、枠の中心の割合へ。
     *
     * **動かせない軸は、はみ出しの止めだけで中央に固定される。**
     * 枠の一辺は短い方の辺と同じ長さなので、その軸では
     * `[半分, 長さ-半分]` が1点に潰れる＝どこを掴んでも 0.5。
     * 最初ここに「横長なら x、縦長なら y」の分岐も置いたが、**変異で
     * 落ちなかった**（結果が1文字も変わらない＝死にコード）ので外した。
     */
    const pointTo = useCallback((clientX: number, clientY: number) => {
        const el = imgRef.current;
        if (!el || !onChange) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const half = Math.min(r.width, r.height) / 2;
        const fit = (v: number, len: number) => Math.max(half, Math.min(len - half, v)) / len;
        onChange({ x: fit(clientX - r.left, r.width), y: fit(clientY - r.top, r.height) });
    }, [onChange]);

    if (failed) return <>{fallback}</>;

    return (
        <div className="relative bg-black flex justify-center">
            <div className="relative inline-block overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    ref={imgRef}
                    src={src}
                    alt=""
                    onLoad={measure}
                    crossOrigin={crossOrigin}
                    onError={(e) => { setFailed(true); onLoadError?.(e.currentTarget); }}
                    className="block w-auto max-h-56 max-w-full"
                    draggable={false}
                    // **掴むのは写真そのもの。** 枠だけを的にすると、
                    // 指の太さ（枠は画像の短辺ぶんしかない）で外しやすい。
                    // `setPointerCapture` で、指が枠から出ても追随させる
                    onPointerDown={draggable ? (e) => {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        pointTo(e.clientX, e.clientY);
                    } : undefined}
                    onPointerMove={draggable ? (e) => {
                        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                        pointTo(e.clientX, e.clientY);
                    } : undefined}
                    // **縦スクロールを奪わない。** 動かせるのが横だけの写真で
                    // `touch-none` にすると、写真の上で指を上下に振っても
                    // ページが動かなくなる
                    style={draggable ? { touchAction: movable.x && movable.y ? "none" : movable.x ? "pan-y" : "pan-x" } : undefined}
                />
                {box && (
                    <div
                        className="absolute border-2 border-white/90 pointer-events-none"
                        style={{
                            width: box.side,
                            height: box.side,
                            left: box.left,
                            top: box.top,
                            // 枠外を暗くする（コンテナで overflow-hidden 済み）
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                        }}
                    >
                        <span className="absolute -top-px left-0 right-0 h-px bg-white/40" />
                    </div>
                )}
            </div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/70 text-[11px] text-white/90 pointer-events-none whitespace-nowrap">
                {hint}
            </span>
        </div>
    );
}
