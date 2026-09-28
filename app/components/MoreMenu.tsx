"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline";

export type MoreMenuItem = {
    key: string;
    label: string;
    onSelect: () => void;
    /** 取り返しの付かない／目立たせたい項目（通報・ブロック）は赤で */
    danger?: boolean;
};

type Props = {
    items: MoreMenuItem[];
    /** ボタンの読み上げ名（「その他」など） */
    label: string;
    /** 押した要素へフォーカスを戻すために親が握る ref（通報ダイアログの `openerRef` と共用） */
    buttonRef?: React.RefObject<HTMLButtonElement | null>;
    className?: string;
};

/**
 * 最終版モックの「⋯」メニュー（写真ページ・ストーリー・スポット・カードで共通）。
 *
 * - 押すとその場に小さな一覧。Escape・外側のタップ・項目を選ぶ、で閉じる
 * - **項目は `items` で全部渡す**（画面ごとに何を出すかは呼ぶ側が決める）。
 *   中身が無ければボタンごと出さない（押しても何も無いボタンを置かない）
 * - 一覧は `role="menu"`／`menuitem`。矢印キーで移動、Escape で戻る
 */
export default function MoreMenu({ items, label, buttonRef, className = "" }: Props) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const innerBtnRef = useRef<HTMLButtonElement>(null);
    const btnRef = buttonRef ?? innerBtnRef;
    const menuId = useId();

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); }
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
    }, [open, btnRef]);

    useEffect(() => {
        if (!open) return;
        const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
        first?.focus();
    }, [open]);

    if (items.length === 0) return null;

    const onMenuKey = (e: React.KeyboardEvent) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const els = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
        els[next]?.focus();
    };

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={label}
                className="inline-flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors"
                style={{ width: "40px", height: "40px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            >
                <EllipsisHorizontalIcon aria-hidden="true" style={{ width: "24px", height: "24px" }} />
            </button>
            {open && (
                <div
                    id={menuId}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onMenuKey}
                    className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-xl bg-surface-2 ring-1 ring-line shadow-lg shadow-black/40 py-1"
                >
                    {items.map((it) => (
                        <button
                            key={it.key}
                            type="button"
                            role="menuitem"
                            onClick={() => { setOpen(false); it.onSelect(); }}
                            className={`block w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors ${it.danger ? "text-danger" : "text-white"}`}
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {it.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
