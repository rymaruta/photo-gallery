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

    // --- Safe access: labels may not have typed 'tags' or 'actions' properties.
    // Use type assertion and provide fallbacks.
    const rawLabels = labels as Record<string, unknown>;

    const tagLabels = useMemo(() => {
        const t = rawLabels?.tags as Record<string, unknown> | undefined;
        return {
            title: t?.title as string | undefined,
            multiple: t?.multiple as string | undefined,
            single: t?.single as string | undefined,
            none: t?.none as string | undefined,
        };
    }, [rawLabels?.tags]);

    const actionLabels = useMemo(() => {
        const a = rawLabels?.actions as Record<string, unknown> | undefined;
        return {
            clearTags: a?.clearTags as string | undefined,
            showAll: a?.showAll as string | undefined,
            showAllGeneric: a?.showAllGeneric as string | undefined,
        };
    }, [rawLabels?.actions]);

    const multipleLabel = tagLabels.multiple ?? "tags";
    const singleLabel = tagLabels.single ?? "tag";
    const noneLabel = tagLabels.none ?? "No tags";
    const clearLabel = actionLabels.clearTags ?? "Clear";
    const showAllFixedLabel = actionLabels.showAllGeneric ?? actionLabels.showAll ?? "Show";

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
    }, [values.selectedTags, debouncedApply, onChange, startTransition]);

    // labels for categories
    const labelForCategory = useCallback(
        (k: string) => {
            const categoryNames = (rawLabels?.category as Record<string, unknown> | undefined)?.names as Record<string, string> | undefined;
            return categoryDisplayMap?.[k] ?? categoryNames?.[k] ?? k;
        },
        [categoryDisplayMap, rawLabels]
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
            container: { backgroundColor: "var(--filter-bg, #07090a)", border: "1px solid rgba(255,255,255,0.10)", padding: 8 },
            input: { padding: "6px 10px", border: "1px solid rgba(255,255,255,0.06)", outline: "none", fontSize: 13 } as React.CSSProperties,
            chipBase: { padding: "2px 8px", minHeight: 44, borderRadius: 6, width: "auto" } as React.CSSProperties,
            controlBtn: { padding: "2px 8px", minHeight: 44, borderRadius: 6, whiteSpace: "nowrap" } as React.CSSProperties,
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
                        onTouchStart={(e) => {
                            e.stopPropagation();
                        }}
                        onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onChange({ category: c });
                        }}
                        aria-pressed={active}
                        aria-label={labelForCategory(c)}
                        className={`inline-flex items-center justify-center gap-2 text-xs focus:outline-none focus:ring-0 font-normal ${active ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
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
                onTouchStart={(e) => {
                    e.stopPropagation();
                }}
                onTouchEnd={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onChange({ category: "all" });
                }}
                aria-pressed={values.category === "all"}
                aria-label={labelForCategory("all")}
                className={`inline-flex items-center justify-center gap-2 text-xs focus:outline-none focus:ring-0 font-normal ${values.category === "all" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
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
                        onTouchStart={(e) => {
                            e.stopPropagation();
                        }}
                        onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleTag(t);
                        }}
                        onKeyDown={(e) => onChipKey(e, t)}
                        role="switch"
                        aria-checked={active}
                        aria-label={ariaLabel}
                        className={`inline-flex items-center gap-2 text-xs focus:outline-none focus:ring-0 transition-colors font-normal ${active ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                        style={{
                            ...STYLE.chipBase,
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                        }}
                    >
                        <span className="truncate" style={{ maxWidth: 160 }}>
                            {display}
                        </span>
                        {showCount ? <span className="text-[11px] text-white/60">{count}</span> : null}
                    </button>
                );
            }),
        [visibleTags, values.selectedTags, tagDisplayMap, counts, toggleTag, onChipKey, STYLE.chipBase]
    );

    const sortLabel = useMemo(() => {
        const sortOptions = (rawLabels?.sort as Record<string, unknown> | undefined)?.options as Record<string, string> | undefined;
        return sortOptions?.[values.sort] ?? values.sort;
    }, [rawLabels, values.sort]);

    return (
        <section className={`mb-2 ${className}`}>
            <div className="rounded-lg" style={STYLE.container}>
                {/* categories */}
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 6 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-white/70 mr-1">{(rawLabels?.category as Record<string, unknown> | undefined)?.title as string | undefined ?? labels.category?.title ?? "Category"}</span>
                        <div className="flex gap-1 flex-wrap">
                            {renderAllButton}
                            {renderCategoryButtons}
                        </div>
                    </div>
                </div>

                {/* search + mobile sort */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2" style={{ marginBottom: 6 }}>
                    <div style={{ flex: "1 1 auto", position: "relative" }}>
                        <label htmlFor="filter-query" className="sr-only">
                            {(rawLabels?.search as Record<string, unknown> | undefined)?.placeholder as string | undefined ?? labels.search?.placeholder ?? "Search"}
                        </label>
                        {/* 検索アイコン */}
                        <div className="absolute left-3 top-1/2 transform -translate-y-1/2 pointer-events-none z-10">
                            <MagnifyingGlassIcon className="w-4 h-4 text-white/40" />
                        </div>
                        <input
                            id="filter-query"
                            type="search"
                            value={localQuery}
                            onChange={(e) => onQueryChange(e.target.value)}
                            placeholder={(rawLabels?.search as Record<string, unknown> | undefined)?.placeholder as string | undefined ?? labels.search?.placeholder ?? "Search"}
                            className="w-full rounded-md bg-white/5 text-white placeholder:text-white/40 text-sm pl-10 pr-10 border border-white/10 focus:border-white/30 focus:bg-white/8 transition-all duration-200 outline-none"
                            style={{ padding: "8px 36px 8px 36px", fontSize: 13 }}
                        />
                        {/* クリアボタン（入力時のみ表示） */}
                        {localQuery && (
                            <button
                                type="button"
                                onClick={() => {
                                    setLocalQuery("");
                                    debouncedApply("");
                                }}
                                onTouchStart={(e) => {
                                    e.stopPropagation();
                                }}
                                onTouchEnd={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    setLocalQuery("");
                                    debouncedApply("");
                                }}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 rounded-full hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
                                aria-label={locale === "en" ? "Clear search" : "検索をクリア"}
                                style={{ 
                                    touchAction: "manipulation",
                                    WebkitTapHighlightColor: "transparent",
                                    minWidth: "44px",
                                    minHeight: "44px"
                                }}
                            >
                                <XMarkIcon className="w-4 h-4 text-white/60 hover:text-white/90" />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 md:hidden">
                            <span className="text-xs text-white/70">{(rawLabels?.sort as Record<string, unknown> | undefined)?.label as string | undefined ?? labels.sort?.label ?? "Sort"}</span>
                            <div className="relative">
                                <button
                                    ref={sortButtonRef}
                                    type="button"
                                    onClick={() => setSortOpen((s) => !s)}
                                    onTouchStart={(e) => {
                                        e.stopPropagation();
                                    }}
                                    onTouchEnd={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setSortOpen((s) => !s);
                                    }}
                                    aria-haspopup="listbox"
                                    aria-expanded={isSortOpen}
                                    aria-controls="sort-menu"
                                    className="inline-flex items-center gap-2 text-xs focus:outline-none bg-transparent"
                                    style={{
                                        ...STYLE.controlBtn,
                                        touchAction: "manipulation",
                                        WebkitTapHighlightColor: "transparent",
                                    }}
                                >
                                    <span>{sortLabel}</span>
                                    <svg className="h-4 w-4 text-white/70" viewBox="0 0 20 20" fill="none" aria-hidden>
                                        <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>

                                {isSortOpen && (
                                    <div
                                        ref={sortMenuRef}
                                        id="sort-menu"
                                        role="listbox"
                                        aria-label={(rawLabels?.sort as Record<string, unknown> | undefined)?.label as string | undefined ?? labels.sort?.label ?? "Sort"}
                                        className="absolute right-0 mt-2 z-50"
                                        style={{ minWidth: 140, borderRadius: 8, overflow: "hidden", background: "#07090a", border: "1px solid rgba(255,255,255,0.08)" }}
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
                                                    onTouchStart={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onTouchEnd={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        onChange({ sort: opt as "new" | "old" | "popular" });
                                                        setSortOpen(false);
                                                        setTimeout(() => sortButtonRef.current?.focus(), 0);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-xs"
                                                    style={{ 
                                                        background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                                                        color: "#fff",
                                                        touchAction: "manipulation",
                                                        WebkitTapHighlightColor: "transparent",
                                                        minHeight: "44px"
                                                    }}
                                                >
                                                    {(() => {
                                                        const sortOptions = (rawLabels?.sort as Record<string, unknown> | undefined)?.options as Record<string, string> | undefined;
                                                        return sortOptions?.[opt] ?? labels.sort?.options?.[opt] ?? opt;
                                                    })()}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* tags */}
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 0 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-white/70 mr-1">{tagLabels.title ?? (rawLabels?.tags as Record<string, unknown> | undefined)?.title as string | undefined ?? labels.tags?.title ?? "Tags"}</span>
                        <div className="flex gap-1 flex-wrap">
                            {renderTagChips}
                            {!showAllTags && tags.length > mobileCollapseLimit && (
                                <div className="flex items-center text-xs text-white/60 px-2">+{tags.length - mobileCollapseLimit}</div>
                            )}
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <div className="hidden sm:block text-xs text-white/60">{selectedSummary}</div>
                        <button
                            type="button"
                            onClick={toggleShowAll}
                            onTouchStart={(e) => {
                                e.stopPropagation();
                            }}
                            onTouchEnd={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                toggleShowAll();
                            }}
                            aria-expanded={showAllTags}
                            className={`inline-flex items-center gap-2 text-xs focus:outline-none focus:ring-0 font-normal ${showAllTags ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                            style={{
                                ...STYLE.controlBtn,
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            {showAllFixedLabel}
                        </button>

                        <button
                            type="button"
                            onClick={clearTags}
                            onTouchStart={(e) => {
                                e.stopPropagation();
                            }}
                            onTouchEnd={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (!isPending && values.selectedTags && values.selectedTags.length > 0) {
                                    clearTags();
                                }
                            }}
                            disabled={!values.selectedTags || values.selectedTags.length === 0 || isPending}
                            aria-disabled={!values.selectedTags || values.selectedTags.length === 0 || isPending}
                            className={`inline-flex items-center gap-2 text-xs focus:outline-none focus:ring-0 font-normal ${isPending ? "opacity-60 pointer-events-none text-white/60" : !values.selectedTags || values.selectedTags.length === 0 ? "opacity-50 pointer-events-none text-white/60" : "bg-white/5 text-white/80"}`}
                            style={{
                                ...STYLE.controlBtn,
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            {isPending ? "Clearing..." : clearLabel}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}

export default memo(FilterBarInner);
