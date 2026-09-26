"use client";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useTransition,
    memo,
} from "react";
import debounce from "lodash.debounce";
import { isImeKey } from "../../lib/utils/ime";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { getLabels } from "../i18n/labels";
import type { FilterValues } from "../../lib/types/gallery";
import { tagKey } from "../../lib/utils/collections";

type TagInfo = { label: string; desc?: string };

type Props = {
    categories: string[];
    tags: string[]; // keys
    values: FilterValues;
    onChange: (next: Partial<FilterValues>) => void;
    className?: string;
    locale?: string;
    categoryDisplayMap?: Record<string, string>;
    tagDisplayMap?: Record<string, TagInfo>;
    tagCounts?: Record<string, number>;
};

/**
 * 溢れの逃がし方を幅で変える行（カテゴリ・タグ）。
 *
 *   < 1024px … 1行のまま**横スクロール**（画面の上に横一列で置く）
 *   ≥ 1024px … **折り返す**（`/search` の PC は左の柱に置くので、
 *              幅 248px しか無く横スクロールは指の当てどころが無い）
 *
 * ⚠️ **`overflow-x-auto` と `flex-wrap` は共存できない。** 溢れを
 * スクロールで逃がす箱は折り返さない。だから `lg:` で `overflow-visible`
 * へ**戻してから** `lg:flex-wrap` を当てる——片方だけ足すと効かない。
 *
 * この部品を使っているのは `/search`（`GalleryPageClient` の `surface="search"`）
 * だけなので、幅だけで決めてよい（props で切り替える必要が無い）。
 * **props にしなかったのは水和のため**——`matchMedia` で選ぶと、PC の
 * 初回描画が一度スマホの形で出てから組み替わる。
 */
const WRAPPING_ROW = "-mx-1 px-1 overflow-x-auto no-scrollbar lg:mx-0 lg:px-0 lg:overflow-visible lg:flex-wrap";

function FilterBarInner({
    categories,
    tags,
    values,
    onChange,
    className = "",
    locale = "ja",
    categoryDisplayMap,
    tagDisplayMap = {},
    tagCounts = {},
}: Props) {
    const safeLocale = locale === "en" ? "en" : "ja";
    const labels = useMemo(() => getLabels(safeLocale), [safeLocale]);

    const actionLabels = labels.actions;

    const clearLabel = actionLabels.clearTags;

    // 入力欄の値は自分で持ち、確定した値だけ 300ms 後に親へ渡す。
    const [localQuery, setLocalQuery] = useState(() => values.query || "");

    // 親から来た値を入力欄に反映するのは「外部で変わったとき」だけにする。
    // 以前は localQuery !== values.query なら常に上書きしていたため、
    // 入力してから親に反映されるまでの300msの間に入力欄が空へ戻され、
    // 日本語の変換中の文字まで消えていた（1文字ずつしか入らない原因）。
    const appliedQueryRef = useRef(values.query || "");
    useEffect(() => {
        const next = values.query || "";
        if (next !== appliedQueryRef.current) {
            appliedQueryRef.current = next;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLocalQuery(next);
        }
    }, [values.query]);

    // 日本語入力の変換中は確定させない（変換候補の途中で検索が走らないように）
    const composingRef = useRef(false);

    const debouncedApply = useMemo(
        () =>
            debounce((q: string) => {
                onChange({ query: q });
            }, 300),
        [onChange]
    );
    useEffect(() => () => debouncedApply.cancel(), [debouncedApply]);

    // toggle tag (stable)
    // **同じタグは同じ物差しで見る。** 完全一致で切り替えていた頃は、
    // `?tags=<スラッグ>` で来た選択（`mount-fuji`）を生のチップ
    // （`Mount Fuji`）から外せず、押すたびに**2つ目が足される**だけだった。
    const toggleTag = useCallback(
        (t: string) => {
            const key = tagKey(t);
            const rest = values.selectedTags.filter((s) => tagKey(s) !== key);
            // 消えていれば「選択されていた」＝解除。同じ長さなら追加
            onChange({ selectedTags: rest.length === values.selectedTags.length ? [...rest, t] : rest });
        },
        [values.selectedTags, onChange]
    );

    // clear with guard + cancel debounce + low priority transition
    const [isPending, startTransition] = useTransition();
    const clearTags = useCallback(() => {
        if (!values.selectedTags || values.selectedTags.length === 0) return;
        try {
            debouncedApply.cancel?.();
        } catch {
            /* noop */
        }
        startTransition(() => {
            onChange({ selectedTags: [] });
        });
    }, [values.selectedTags, debouncedApply, onChange]);

    // labels for categories
    const labelForCategory = useCallback(
        (k: string) => {
            return categoryDisplayMap?.[k] ?? labels.category.names?.[k] ?? k;
        },
        [categoryDisplayMap, labels]
    );

    // compute counts (best-effort)
    const counts = useMemo(() => {
        if (Object.keys(tagCounts).length) return tagCounts;
        const map: Record<string, number> = {};
        for (const t of tags) map[t] = (map[t] ?? 0) + 1;
        return map;
    }, [tagCounts, tags]);

    // sort menu state refs and keyboard handling (stable)
    const [isSortOpen, setSortOpen] = useState(false);
    const sortButtonRef = useRef<HTMLButtonElement | null>(null);
    const sortMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const onDocClick = (e: PointerEvent) => {
            if (!isSortOpen) return;
            const tgt = e.target as Node | null;
            if (!tgt) return;
            if (sortButtonRef.current?.contains(tgt) || sortMenuRef.current?.contains(tgt)) return;
            setSortOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            // 並び替えメニューが開いているときだけ反応する。
            // 以前は常に document で拾って並び替えボタンに焦点を移していたので、
            //   - 一覧の下の方で写真モーダルを Esc で閉じると、位置が戻った直後に
            //     ページ先頭のボタンへ焦点が飛んでスクロールが巻き戻る
            //   - 検索欄で Esc（type="search" の消去）を押すと焦点を奪われ、
            //     続きが打てなくなる
            // が起きていた。
            if (!isSortOpen) return;
            if (e.key === "Escape") {
                setSortOpen(false);
                setTimeout(() => sortButtonRef.current?.focus(), 0);
            }
        };
        // **`pointerdown` で聞く。** `mousedown` だけだと、iOS は
        // 「押せない要素」に互換マウスイベントを合成しないことがあるので、
        // グリッドの余白をタップしても閉じない（このリポジトリは
        // `app/globals.css` に「button/a に cursor:pointer が無いと
        // タップが効かない」という同種の記録を既に持っている）。
        // スマホには Esc も無いので、閉じ損なうと開きっぱなしになる。
        document.addEventListener("pointerdown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [isSortOpen]);

    useEffect(() => {
        if (!isSortOpen) return;
        const options = Array.from(
            sortMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []
        );
        if (!options.length) return;
        let idx = options.findIndex((o) => o.getAttribute("data-value") === values.sort);
        if (idx === -1) idx = 0;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                idx = (idx + 1) % options.length;
                options[idx]?.focus();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                idx = (idx - 1 + options.length) % options.length;
                options[idx]?.focus();
            } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                options[idx]?.click();
            }
        };
        document.addEventListener("keydown", onKey);
        setTimeout(() => options[idx]?.focus(), 0);
        return () => document.removeEventListener("keydown", onKey);
    }, [isSortOpen, values.sort]);

    const sortOptions: Array<"new" | "old" | "popular"> = useMemo(
        () => ["new", "old", "popular"],
        []
    );

    // query change (local + debounced)
    const onQueryChange = useCallback(
        (v: string) => {
            setLocalQuery(v);
            // 自分で流した値は「外部からの変更」と見なさない（上の効果で打ち消さないため）
            appliedQueryRef.current = v;
            // 変換中は流さない。確定（compositionend）でまとめて流す
            if (!composingRef.current) debouncedApply(v);
        },
        [debouncedApply]
    );

    /** 変換確定。確定した文字列で即座に検索する */
    const onCompositionEnd = useCallback(
        (e: React.CompositionEvent<HTMLInputElement>) => {
            composingRef.current = false;
            const v = e.currentTarget.value;
            setLocalQuery(v);
            appliedQueryRef.current = v;
            debouncedApply(v);
        },
        [debouncedApply]
    );

    // chip keyboard handler
    const onChipKey = useCallback(
        (e: React.KeyboardEvent, t: string) => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggleTag(t);
            }
        },
        [toggleTag]
    );

    // Styles memoized to avoid re-creating objects on each render
    const STYLE = useMemo(
        () => ({
            chipBase: { padding: "6px 14px", minHeight: 32, borderRadius: 9999, width: "auto", flexShrink: 0 } as React.CSSProperties,
            controlBtn: { padding: "6px 14px", minHeight: 32, borderRadius: 9999, whiteSpace: "nowrap", flexShrink: 0 } as React.CSSProperties,
        }),
        []
    );

    // render helpers memoized
    const renderCategoryButtons = useMemo(
        () =>
            categories.map((c) => {
                const active = values.category === c;
                return (
                    <button
                        key={c}
                        type="button"
                        onClick={() => onChange({ category: c })}
                        aria-pressed={active}
                        aria-label={labelForCategory(c)}
                        className={`inline-flex items-center justify-center text-[13px] focus:outline-none focus:ring-0 transition-colors ${active ? "bg-accent-fill text-ink font-medium" : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"}`}
                        style={{
                            ...STYLE.controlBtn,
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                        }}
                    >
                        {labelForCategory(c)}
                    </button>
                );
            }),
        [categories, values.category, onChange, labelForCategory, STYLE.controlBtn]
    );

    const renderAllButton = useMemo(
        () => (
            <button
                type="button"
                onClick={() => onChange({ category: "all" })}
                aria-pressed={values.category === "all"}
                aria-label={labelForCategory("all")}
                className={`inline-flex items-center justify-center text-[13px] focus:outline-none focus:ring-0 transition-colors ${values.category === "all" ? "bg-accent-fill text-ink font-medium" : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"}`}
                style={{
                    ...STYLE.controlBtn,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                }}
            >
                {labelForCategory("all")}
            </button>
        ),
        [values.category, onChange, labelForCategory, STYLE.controlBtn]
    );

    const renderTagChips = useMemo(
        () =>
            tags.map((t) => {
                const active = values.selectedTags.some((s) => tagKey(s) === tagKey(t));
                const info = tagDisplayMap[t];
                const display = info?.label ?? t;
                const count = counts[t] ?? 0;
                const showCount = count > 1;
                const ariaLabel = `${display}${info?.desc ? `: ${info.desc}` : ""}${showCount ? ` (${count})` : ""}`;

                return (
                    <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        onKeyDown={(e) => onChipKey(e, t)}
                        role="switch"
                        aria-checked={active}
                        aria-label={ariaLabel}
                        className={`inline-flex items-center gap-1.5 text-[13px] focus:outline-none focus:ring-0 transition-colors ${active ? "bg-accent-fill text-ink font-medium" : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"}`}
                        style={{
                            ...STYLE.chipBase,
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                        }}
                    >
                        <span className="truncate" style={{ maxWidth: 160 }}>
                            {display}
                        </span>
                        {showCount ? <span className={`text-[11px] ${active ? "text-white" : "text-white/50"}`}>{count}</span> : null}
                    </button>
                );
            }),
        [tags, values.selectedTags, tagDisplayMap, counts, toggleTag, onChipKey, STYLE.chipBase]
    );

    const sortLabel = useMemo(() => {
        return labels.sort.options[values.sort] ?? values.sort;
    }, [labels, values.sort]);

    return (
        <section className={`mb-2 ${className}`}>
            <div className="space-y-2.5 lg:space-y-3">
                {/* カテゴリ: 1行横スクロールのピル（PC の柱では折り返す） */}
                <div className={`flex gap-1.5 ${WRAPPING_ROW}`}>
                    {renderAllButton}
                    {renderCategoryButtons}
                </div>

                {/* 検索 + 並び替え。**PC の柱では縦に積む**——248px の柱に
                    検索欄と並び替えを横に並べると、検索欄が語句を1つ置くのも
                    苦しい幅（約150px）になる */}
                <div className="flex items-center gap-1.5 lg:flex-col lg:items-stretch">
                    <div className="relative flex-1">
                        <label htmlFor="filter-query" className="sr-only">
                            {labels.search.placeholder}
                        </label>
                        {/* 検索アイコン（デバウンス中は点滅） */}
                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                            <MagnifyingGlassIcon className={`w-4 h-4 ${localQuery !== (values.query || "") ? "text-white/70 animate-pulse" : "text-white/35"}`} />
                        </div>
                        <input
                            id="filter-query"
                            type="search"
                            value={localQuery}
                            onChange={(e) => onQueryChange(e.target.value)}
                            onCompositionStart={() => { composingRef.current = true; }}
                            onCompositionEnd={onCompositionEnd}
                            onKeyDown={(e) => {
                                // 確定キー（iPhone では「検索」）でキーボードを閉じる。結果は打つたびに
                                // 出ているので、閉じないとキーボードが結果を隠したまま残る。
                                // 変換の確定の Enter は除く
                                if (e.key === "Enter" && !isImeKey(e.nativeEvent)) e.currentTarget.blur();
                            }}
                            enterKeyHint="search"
                            placeholder={labels.search.placeholder}
                            className="search-own-clear w-full rounded-full bg-white/[0.06] text-white placeholder:text-white/35 border border-transparent focus:border-white/20 focus:bg-white/10 transition-all duration-200 outline-none"
                            style={{ padding: "8px 38px 8px 38px", fontSize: 13, minHeight: 36 }}
                        />
                        {/* クリアボタン（入力時のみ表示） */}
                        {localQuery && (
                            <button
                                type="button"
                                onClick={() => {
                                    setLocalQuery("");
                                    appliedQueryRef.current = "";
                                    debouncedApply("");
                                }}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                                aria-label={locale === "en" ? "Clear search" : "検索をクリア"}
                                style={{
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                }}
                            >
                                <XMarkIcon className="w-4 h-4 text-white/60 hover:text-white/90" />
                            </button>
                        )}
                    </div>

                    {/* 並び替え。PC の柱では縦に積むので、箱をボタンの幅に
                        縮めて（`lg:self-start`）吊る一覧の右端が柱の端まで
                        飛ばないようにする */}
                    <div className="relative flex-shrink-0 lg:self-start">
                        <button
                            ref={sortButtonRef}
                            type="button"
                            onClick={() => setSortOpen((s) => !s)}
                            aria-haspopup="listbox"
                            aria-expanded={isSortOpen}
                            // 開いている間だけ指す（`HeaderNav` と同じ理由）。
                            // 一覧（`id="sort-menu"`）は `isSortOpen` のときしか
                            // 描かれないので、無条件だと閉じている間は
                            // **存在しない id を指す**
                            aria-controls={isSortOpen ? "sort-menu" : undefined}
                            className="inline-flex items-center gap-1 text-[13px] text-white/60 hover:text-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 bg-transparent transition-colors"
                            style={{
                                padding: "8px 4px 8px 10px",
                                minHeight: 36,
                                whiteSpace: "nowrap",
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            <span>{sortLabel}</span>
                            <svg className={`h-3.5 w-3.5 transition-transform ${isSortOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" aria-hidden>
                                <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>

                        {isSortOpen && (
                            <div
                                ref={sortMenuRef}
                                id="sort-menu"
                                role="listbox"
                                aria-label={labels.sort.label}
                                /* **PC の柱では左に揃える。** 柱では箱が
                                   ボタンの幅（約76px）まで縮むので、`right-0`
                                   のまま吊ると幅 130px の一覧が左へはみ出す
                                   ——実測で左端が **x=-14**（英語は -23）、
                                   しかも `scrollWidth == innerWidth` なので
                                   スクロールしても出てこない（レビューが計測） */
                                className="absolute right-0 lg:right-auto lg:left-0 mt-1 z-50 shadow-xl"
                                style={{ minWidth: 130, borderRadius: 12, overflow: "hidden", background: "#101214", border: "1px solid rgba(255,255,255,0.10)" }}
                            >
                                {sortOptions.map((opt) => {
                                    const isActive = values.sort === opt;
                                    return (
                                        <button
                                            key={opt}
                                            role="option"
                                            data-value={opt}
                                            aria-selected={isActive}
                                            onClick={() => {
                                                onChange({ sort: opt as "new" | "old" | "popular" });
                                                setSortOpen(false);
                                                setTimeout(() => sortButtonRef.current?.focus(), 0);
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-white/5 transition-colors"
                                            style={{
                                                background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                                                color: isActive ? "#fff" : "rgba(255,255,255,0.7)",
                                                touchAction: "manipulation",
                                                WebkitTapHighlightColor: "transparent",
                                            }}
                                        >
                                            {labels.sort.options[opt] ?? opt}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* タグ: よく使うものだけを1行で。全件（数十個）並べても選べないので、
                    残りは検索で探してもらう */}
                <div className={`flex items-center gap-1.5 ${WRAPPING_ROW}`}>
                    {renderTagChips}

                    {values.selectedTags && values.selectedTags.length > 0 && (
                        <button
                            type="button"
                            onClick={clearTags}
                            disabled={isPending}
                            className={`inline-flex items-center text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition-colors ${isPending ? "opacity-60 pointer-events-none text-white/50" : "text-white/50 hover:text-white/90"} bg-transparent border border-white/15 hover:border-white/40`}
                            style={{
                                ...STYLE.controlBtn,
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            {isPending ? "..." : clearLabel}
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}

export default memo(FilterBarInner);
