"use client";

import React, { useEffect, useRef } from "react";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";

export type StorySheetItem = {
    key: string;
    label: string;
    /** 左に置く印。文字（`Aa`）でもアイコンでもよい */
    icon?: React.ReactNode;
    onSelect: () => void;
    /** 取り返しの付かない操作（削除・報告）は赤で */
    danger?: boolean;
    disabled?: boolean;
    /** 処理中（ぐるぐるを出し、押せなくする） */
    busy?: boolean;
    /**
     * 押したらシートを閉じるか。既定は閉じる。**確認の「削除」だけ `false`**
     * ——閉じてしまうと、消えるまでの間どこにも進捗が出ない
     */
    closeOnSelect?: boolean;
};

/**
 * ストーリーの操作シート（最終版モック09 の「ストーリーメニュー」）。
 *
 * iOS のアクションシートの形——**画面の下に、項目を縦に並べ、
 * 「キャンセル」だけ離して置く**。このファイルは `StoryViewer` の
 * 削除の確認が既に持っていた見た目をそのまま切り出したもので、
 * **新しい見た目は足していない**（「…」メニューと削除の確認が
 * 別々の絵になるのを避ける）。
 *
 * **`MoreMenu` は使わない。** あちらは押した場所に出る小さな一覧
 * （写真ページ・スポット）で、モック09 はこの全幅のシートを描いている。
 * 片方をもう片方に寄せると、寄せた側の画面のモックから外れる。
 */
export default function StoryActionSheet({ items, onClose, cancelLabel, description, openerRef }: {
    items: StorySheetItem[];
    onClose: () => void;
    cancelLabel: string;
    /** 確認に使うときの説明文（メニューでは省く） */
    description?: string;
    /** 閉じたときにフォーカスを戻す先（「…」ボタン） */
    openerRef?: React.RefObject<HTMLElement | null>;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    // 中に閉じ込めて、閉じたら押した場所へ戻す（このリポジトリの他のシートと同じ道具）
    useFocusTrap(true, panelRef, openerRef);

    // **最初の項目に当てる。** DOM 順の先頭がそのまま危険な操作になることは
    // 無い（削除・報告は下に置く）
    useEffect(() => {
        panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }, []);

    return (
        <div
            className="absolute inset-0 z-40 flex items-end justify-center bg-black/60 px-3 pb-3"
            onClick={onClose}
        >
            <div ref={panelRef} className="w-full max-w-[340px] space-y-2" onClick={(e) => e.stopPropagation()}>
                <div className="rounded-2xl bg-surface-2/95 backdrop-blur-xl overflow-hidden">
                    {description && (
                        <p className="px-4 py-3.5 text-center text-[13px] text-white/55 leading-snug">{description}</p>
                    )}
                    {items.map((it, idx) => (
                        <button
                            key={it.key}
                            type="button"
                            onClick={() => {
                                if (it.disabled || it.busy) return;
                                if (it.closeOnSelect !== false) onClose();
                                it.onSelect();
                            }}
                            disabled={it.disabled || it.busy}
                            className={`w-full px-4 py-3.5 flex items-center gap-3 text-[16px] hover:bg-white/5 active:bg-white/10 transition disabled:opacity-50
                                ${idx > 0 || description ? "border-t border-white/10" : ""}
                                ${it.danger ? "text-[#ff453a]" : "text-white"}`}
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {/* 印の幅を揃える（文字とアイコンが混ざっても行頭が揃う） */}
                            <span className="w-6 flex-shrink-0 flex items-center justify-center" aria-hidden="true">
                                {it.busy
                                    ? <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                    : it.icon}
                            </span>
                            <span className="text-left">{it.label}</span>
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl bg-surface-2/95 backdrop-blur-xl text-white text-[17px] font-semibold hover:bg-[#2c2c2e]/95 active:bg-[#2c2c2e] transition"
                    style={{ touchAction: "manipulation", marginBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                    {cancelLabel}
                </button>
            </div>
        </div>
    );
}
