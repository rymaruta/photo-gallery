"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isImeKey } from "../../lib/utils/ime";
import debounce from "lodash.debounce";
import {
    MagnifyingGlassIcon, XMarkIcon, MapIcon, ListBulletIcon,
} from "@heroicons/react/24/outline";
import { getLabels } from "../i18n/labels";
import { categoryDisplayName } from "../../lib/utils/collections";
import type { MapCategory } from "../../lib/utils/mapFilter";

/** 地図／リストのどちらを見ているか（スマホだけの切り替え。PC は両方出す） */
export type MapView = "map" | "list";

/**
 * 撮影地マップの上に載る操作一式（最終版モック `06-map.jpg` の①と⑤）。
 *
 *   ① 検索欄「撮影地・都市・スポットを検索」＋ 絞り込みのチップ
 *   ⑤ 地図／リストの切り替え
 *
 * **チップは決め打ちで並べない。** モックの「風景・街並み・グルメ・建築・自然」は
 * 絵で、実データに無い種別を出すと**押しても0件の欄**になる。ここに来るのは
 * `mapCategories()` が数えた「いま地図に在るカテゴリ」だけ。
 *
 * **寸法は全部 px。** 640px 未満で root が 14px に落ちる（`app/globals.css`）
 * ので、rem で書くとスマホだけ縮む。モックの画素から測った値:
 *
 *     検索欄  高さ 45画素 → 48px・左右の余白 16px・角丸 20px
 *     チップ  高さ 28画素 → 32px・間隔 8px・文字 13px
 */
export default function MapControls({
    query, onQueryChange, categories, category, onCategoryChange,
    view, onViewChange, locale,
}: {
    query: string;
    onQueryChange: (next: string) => void;
    categories: readonly MapCategory[];
    category: string;
    onCategoryChange: (slug: string) => void;
    view: MapView;
    onViewChange: (next: MapView) => void;
    locale: "ja" | "en";
}) {
    const en = locale === "en";
    const labels = useMemo(() => getLabels(en ? "en" : "ja"), [en]);
    const names = labels.category.names ?? {};

    // 入力欄の値は自分で持ち、確定した値だけ 250ms 後に親へ渡す。
    // **親から来た値で上書きするのは「外で変わったとき」だけ。** 毎回上書きすると、
    // 入力してから親に反映されるまでの間に欄が空へ戻り、日本語の変換中の文字まで
    // 消える（`FilterBar` が実際に踏んだ形）
    const [local, setLocal] = useState(query);
    const appliedRef = useRef(query);
    useEffect(() => {
        if (query !== appliedRef.current) {
            appliedRef.current = query;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLocal(query);
        }
    }, [query]);

    const composingRef = useRef(false);
    // **待たせた関数の中で ref を書かない。** 描画中に作る関数へ ref を
    // 渡すと lint が止める（`react-hooks/refs`）し、実際「いつ書かれるか」が
    // 描画の外からは見えない。親が値を反映したのを上の effect が見て控える
    // ——`FilterBar` と同じ形
    const apply = useMemo(() => debounce((q: string) => onQueryChange(q), 250), [onQueryChange]);
    useEffect(() => () => apply.cancel(), [apply]);

    const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setLocal(v);
        // 日本語入力の変換中は確定させない（候補の途中で絞り込みが走らないように）
        if (!composingRef.current) apply(v);
    }, [apply]);

    const clear = useCallback(() => {
        apply.cancel();
        setLocal("");
        appliedRef.current = "";
        onQueryChange("");
    }, [apply, onQueryChange]);

    const chips: { slug: string; label: string }[] = [
        { slug: "all", label: en ? "All" : "すべて" },
        ...categories.map((c) => ({
            slug: c.slug,
            // 表示名は集約ページ・写真ページと同じ表で引く（`architecture` → 建築）。
            // 表に無いカテゴリ（別名表に載っていない自由入力）は生のスラッグ
            label: names[c.slug] ?? categoryDisplayName(c.slug) ?? c.slug,
        })),
    ];

    return (
        <div data-testid="map-controls">
            {/* ① 検索欄。モックの文言は「撮影地・都市・スポットを検索」だが、
                **当たるのは撮影地と題だけ**（`matchesMapQuery`）。持っていない
                「スポット」の台帳を名乗らない言葉にする */}
            <div className="relative">
                <MagnifyingGlassIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 text-white/60"
                    style={{ width: "20px", height: "20px", marginLeft: "16px", marginTop: "14px" }}
                />
                <input
                    type="search"
                    value={local}
                    onChange={onInput}
                    onCompositionStart={() => { composingRef.current = true; }}
                    onCompositionEnd={(e) => {
                        composingRef.current = false;
                        apply(e.currentTarget.value);
                    }}
                    onKeyDown={(e) => {
                        // 確定キー（iPhone では「検索」）でキーボードを閉じる。結果は打つたびに
                        // 出ているので、閉じないとキーボードが結果を隠したまま残る。
                        // 変換の確定の Enter は除く
                        if (e.key === "Enter" && !isImeKey(e.nativeEvent)) e.currentTarget.blur();
                    }}
                    enterKeyHint="search"
                    placeholder={en ? "Search places and titles" : "撮影地・写真の題で検索"}
                    aria-label={en ? "Search places and titles" : "撮影地・写真の題で検索"}
                    className="search-own-clear w-full rounded-[20px] bg-surface-2/90 text-white placeholder:text-white/50 ring-1 ring-white/12 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    style={{
                        height: "48px", fontSize: "15px",
                        paddingLeft: "44px", paddingRight: local ? "44px" : "16px",
                    }}
                    data-testid="map-search-input"
                />
                {local && (
                    <button
                        type="button" onClick={clear}
                        aria-label={en ? "Clear search" : "検索を消す"}
                        className="absolute right-0 top-0 flex items-center justify-center text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-full"
                        style={{ width: "44px", height: "48px", touchAction: "manipulation" }}
                    >
                        <XMarkIcon aria-hidden="true" style={{ width: "20px", height: "20px" }} />
                    </button>
                )}
            </div>

            {/* 絞り込みのチップ。**横に流す**（種別が増えても折り返さない）。
                `role="switch"` と押し直しで外れる形は `FilterBar` と揃える
                ——同じ見た目のものが別の操作になるのを防ぐ */}
            {categories.length > 0 && (
                <div
                    className="flex overflow-x-auto no-scrollbar"
                    style={{ gap: "8px", marginTop: "12px", paddingBottom: "2px" }}
                    data-testid="map-category-chips"
                >
                    {chips.map((c) => {
                        const on = category === c.slug;
                        return (
                            <button
                                key={c.slug}
                                type="button"
                                role="switch"
                                aria-checked={on}
                                onClick={() => onCategoryChange(on && c.slug !== "all" ? "all" : c.slug)}
                                className={`flex-shrink-0 rounded-full whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                                    on
                                        ? "bg-primary text-ink font-medium"
                                        : "bg-surface-2/80 text-white/80 ring-1 ring-white/12 hover:text-white"
                                }`}
                                style={{ height: "32px", paddingLeft: "14px", paddingRight: "14px", fontSize: "13px", touchAction: "manipulation" }}
                            >
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* ⑤ 地図／リスト。**PC では出さない**——あちらは左に一覧・右に地図で
                両方同時に見えるので、切り替える物が無い */}
            <div
                className="flex lg:hidden rounded-full bg-surface-2/80 ring-1 ring-white/12"
                style={{ marginTop: "12px", padding: "3px" }}
                role="group"
                aria-label={en ? "Map or list" : "地図とリストの切り替え"}
            >
                {([["map", en ? "Map" : "地図", MapIcon], ["list", en ? "List" : "リスト", ListBulletIcon]] as const).map(([v, label, Icon]) => {
                    const on = view === v;
                    return (
                        <button
                            key={v}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onViewChange(v)}
                            className={`flex-1 flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                                on ? "bg-primary text-ink font-medium" : "text-white/70 hover:text-white"
                            }`}
                            style={{ height: "34px", fontSize: "13px", gap: "6px", touchAction: "manipulation" }}
                            data-testid={`map-view-${v}`}
                        >
                            <Icon aria-hidden="true" style={{ width: "16px", height: "16px" }} />
                            {label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
