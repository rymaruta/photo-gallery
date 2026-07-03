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
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { getLabels } from "../i18n/labels";
import type { FilterValues } from "../../lib/types/gallery";

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
    mobileCollapseLimit?: number;
};

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
    mobileCollapseLimit = 6,
}: Props) {
    const safeLocale = locale === "en" ? "en" : "ja";
    const labels = useMemo(() => getLabels(safeLocale), [safeLocale]);

    const tagLabels = labels.tags;
    const actionLabels = labels.actions;

    const multipleLabel = tagLabels.multiple ?? "tags";
    const singleLabel = tagLabels.single ?? "tag";
    const noneLabel = tagLabels.none ?? "No tags";
    const clearLabel = actionLabels?.clearTags ?? "Clear";
    const showAllFixedLabel = actionLabels?.showAllGeneric ?? actionLabels?.showAll ?? "Show";

    // local query state + debounced apply
    const [localQuery, setLocalQuery] = useState(() => values.query || "");
    useEffect(() => {
        if (localQuery !== (values.query || "")) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLocalQuery(values.query || "");
        }
    }, [values.query, localQuery]);

    const debouncedApply = useMemo(
        () =>
            debounce((q: string) => {
                onChange({ query: q });
            }, 300),
        [onChange]
    );
    useEffect(() => () => debouncedApply.cancel(), [debouncedApply]);

    // toggle tag (stable)
    const toggleTag = useCallback(
        (t: string) => {
            const set = new Set(values.selectedTags);
            if (set.has(t)) set.delete(t);
            else set.add(t);
            onChange({ selectedTags: Array.from(set) });
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
        const onDocClick = (e: MouseEvent) => {
            if (!isSortOpen) return;
            const tgt = e.target as Node | null;
            if (!tgt) return;
            if (sortButtonRef.current?.contains(tgt) || sortMenuRef.current?.contains(tgt)) return;
            setSortOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSortOpen(false);
                setTimeout(() => sortButtonRef.current?.focus(), 0);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
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
            debouncedApply(v);
        },
        [debouncedApply]
    );

    // showAll toggle (visual only)
    const [showAllTags, setShowAllTags] = useState(false);
    const toggleShowAll = useCallback(() => setShowAllTags((s) => !s), []);

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

    const selectedSummary = useMemo(
        () =>
            values.selectedTags.length > 0
                ? `${values.selectedTags.length} ${values.selectedTags.length > 1 ? multipleLabel : singleLabel}`
                : noneLabel,
        [values.selectedTags.length, multipleLabel, singleLabel, noneLabel]
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
                        className={`inline-flex items-center justify-center text-[13px] focus:outline-none focus:ring-0 transition-colors ${active ? "bg-white text-black font-medium" : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"}`}
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
                className={`inline-flex items-center justify-center text-[13px] focus:outline-none focus:ring-0 transition-colors ${values.category === "all" ? "bg-white text-black font-medium" : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"}`}
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

    const visibleTags = useMemo(
        () => (showAllTags ? tags : tags.slice(0, Math.max(0, mobileCollapseLimit))),
        [showAllTags, tags, mobileCollapseLimit]
    );

    const renderTagChips = useMemo(
        () =>
            visibleTags.map((t) => {
                const active = values.selectedTags.includes(t);
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
                        className={`inline-flex items-center gap-1.5 text-[13px] focus:outline-none focus:ring-0 transition-colors ${active ? "bg-white text-black font-medium" : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"}`}
                        style={{
                            ...STYLE.chipBase,
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                        }}
                    >
                        <span className="truncate" style={{ maxWidth: 160 }}>
                            {display}
                        </span>
                        {showCount ? <span className={`text-[11px] ${active ? "text-black/50" : "text-white/40"}`}>{count}</span> : null}
                    </button>
                );
            }),
        [visibleTags, values.selectedTags, tagDisplayMap, counts, toggleTag, onChipKey, STYLE.chipBase]
    );

    const sortLabel = useMemo(() => {
        return labels.sort.options[values.sort] ?? values.sort;
    }, [labels, values.sort]);

    return (
        <section className={`mb-2 ${className}`}>
            <div className="space-y-2.5">
                {/* カテゴリ: 1行横スクロールのピル */}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
                    {renderAllButton}
                    {renderCategoryButtons}
                </div>

                {/* 検索 + 並び替え */}
                <div className="flex items-center gap-1.5">
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
                            placeholder={labels.search.placeholder}
                            className="w-full rounded-full bg-white/[0.06] text-white placeholder:text-white/35 border border-transparent focus:border-white/20 focus:bg-white/10 transition-all duration-200 outline-none"
                            style={{ padding: "8px 38px 8px 38px", fontSize: 13, minHeight: 36 }}
                        />
                        {/* クリアボタン（入力時のみ表示） */}
                        {localQuery && (
                            <button
                                type="button"
                                onClick={() => {
                                    setLocalQuery("");
                                    debouncedApply("");
                                }}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition-colors focus:outline-none"
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

                    {/* 並び替え */}
                    <div className="relative flex-shrink-0">
                        <button
                            ref={sortButtonRef}
                            type="button"
                            onClick={() => setSortOpen((s) => !s)}
                            aria-haspopup="listbox"
                            aria-expanded={isSortOpen}
                            aria-controls="sort-menu"
                            className="inline-flex items-center gap-1 text-[13px] text-white/60 hover:text-white/90 focus:outline-none bg-transparent transition-colors"
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
                                className="absolute right-0 mt-1 z-50 shadow-xl"
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

                {/* タグ: 折り畳み時は1行横スクロール、展開時は折り返し */}
                <div className={`flex items-center gap-1.5 ${showAllTags ? "flex-wrap" : "overflow-x-auto no-scrollbar -mx-1 px-1"}`}>
                    {renderTagChips}

                    {/* 「+N」自体が展開ボタン */}
                    {!showAllTags && tags.length > mobileCollapseLimit && (
                        <button
                            type="button"
                            onClick={toggleShowAll}
                            aria-expanded={false}
                            aria-label={showAllFixedLabel}
                            className="inline-flex items-center text-[13px] text-white/50 hover:text-white/90 bg-transparent border border-white/15 hover:border-white/40 focus:outline-none transition-colors"
                            style={{
                                ...STYLE.controlBtn,
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            +{tags.length - mobileCollapseLimit}
                        </button>
                    )}
                    {showAllTags && tags.length > mobileCollapseLimit && (
                        <button
                            type="button"
                            onClick={toggleShowAll}
                            aria-expanded={true}
                            className="inline-flex items-center text-[13px] text-white/50 hover:text-white/90 bg-transparent border border-white/15 hover:border-white/40 focus:outline-none transition-colors"
                            style={{
                                ...STYLE.controlBtn,
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            {locale === "en" ? "Less" : "閉じる"}
                        </button>
                    )}

                    {values.selectedTags && values.selectedTags.length > 0 && (
                        <button
                            type="button"
                            onClick={clearTags}
                            disabled={isPending}
                            className={`inline-flex items-center text-[13px] focus:outline-none transition-colors ${isPending ? "opacity-60 pointer-events-none text-white/50" : "text-white/50 hover:text-white/90"} bg-transparent border border-white/15 hover:border-white/40`}
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
