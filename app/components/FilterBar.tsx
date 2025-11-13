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
import { getLabels } from "../i18n/labels";

export type FilterValues = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: string;
};

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

    const [localQuery, setLocalQuery] = useState(values.query || "");
    useEffect(() => setLocalQuery(values.query || ""), [values.query]);

    const debouncedApply = useMemo(
        () =>
            debounce((q: string) => {
                onChange({ query: q });
            }, 300),
        [onChange]
    );
    useEffect(() => () => debouncedApply.cancel(), [debouncedApply]);

    const toggleTag = useCallback(
        (t: string) => {
            const set = new Set(values.selectedTags);
            if (set.has(t)) set.delete(t);
            else set.add(t);
            onChange({ selectedTags: Array.from(set) });
        },
        [values.selectedTags, onChange]
    );

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

    const labelForCategory = useCallback(
        (k: string) => categoryDisplayMap?.[k] ?? labels.category.names?.[k] ?? k,
        [categoryDisplayMap, labels.category.names]
    );

    const counts = useMemo(() => {
        if (Object.keys(tagCounts).length) return tagCounts;
        const map: Record<string, number> = {};
        for (const t of tags) map[t] = (map[t] ?? 0) + 1;
        return map;
    }, [tagCounts, tags]);

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

    const onQueryChange = useCallback(
        (v: string) => {
            setLocalQuery(v);
            debouncedApply(v);
        },
        [debouncedApply]
    );

    const [showAllTags, setShowAllTags] = useState(false);
    const toggleShowAll = useCallback(() => setShowAllTags((s) => !s), []);

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
                ? `${values.selectedTags.length} ${values.selectedTags.length > 1
                    ? labels.tags?.multiple ?? "tags"
                    : labels.tags?.single ?? "tag"
                }`
                : labels.tags?.none ?? "No tags",
        [values.selectedTags.length, labels.tags]
    );

    // --- ADJUSTED SIZES: control buttons slightly smaller, chips remain compact ---
    const CONTROL_PAD_Y = 4; // smaller vertical padding for control buttons
    const CONTROL_PAD_X = 8; // smaller horizontal padding for control buttons
    const CONTROL_MIN_H = 30; // slightly lower min height
    const CONTROL_RADIUS = 8;

    const CHIP_PAD_Y = 4;
    const CHIP_PAD_X = 8;
    const CHIP_MIN_H = 28;

    const STYLE = useMemo(
        () => ({
            container: { backgroundColor: "var(--filter-bg, #07090a)", border: "1px solid rgba(255,255,255,0.10)", padding: 8 },
            input: { padding: `${CONTROL_PAD_Y}px ${CONTROL_PAD_X}px`, border: "1px solid rgba(255,255,255,0.06)", outline: "none", fontSize: 13 } as React.CSSProperties,
            controlBtn: { padding: `${CONTROL_PAD_Y}px ${CONTROL_PAD_X}px`, minHeight: CONTROL_MIN_H, borderRadius: CONTROL_RADIUS, whiteSpace: "nowrap" } as React.CSSProperties,
            chipBase: { padding: `${CHIP_PAD_Y}px ${CHIP_PAD_X}px`, minHeight: CHIP_MIN_H, borderRadius: 9999, width: "auto" } as React.CSSProperties,
        }),
        []
    );

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
                        className={`inline-flex items-center justify-center gap-2 text-xs focus:outline-none ${active ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                        style={STYLE.controlBtn}
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
                className={`inline-flex items-center justify-center gap-2 text-xs focus:outline-none ${values.category === "all" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                style={STYLE.controlBtn}
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
                        className={`inline-flex items-center gap-2 text-xs focus:outline-none transition-colors ${active ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                        style={STYLE.chipBase}
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

    const sortLabel = useMemo(() => labels.sort.options[values.sort as "new" | "old" | "popular"] ?? values.sort, [labels.sort.options, values.sort]);

    return (
        <section className={`mb-2 ${className}`}>
            <div className="rounded-lg" style={STYLE.container}>
                {/* categories */}
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 6 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-white/70 mr-1">{labels.category.title}</span>
                        <div className="flex gap-1 flex-wrap">
                            {renderAllButton}
                            {renderCategoryButtons}
                        </div>
                    </div>

                    <div className="ml-auto text-xs text-white/60 flex items-center gap-2">
                        <div className="hidden sm:block">{selectedSummary}</div>
                    </div>
                </div>

                {/* search + mobile sort */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2" style={{ marginBottom: 6 }}>
                    <div style={{ flex: "1 1 auto" }}>
                        <label htmlFor="filter-query" className="sr-only">
                            {labels.search.placeholder}
                        </label>
                        <input
                            id="filter-query"
                            type="search"
                            value={localQuery}
                            onChange={(e) => onQueryChange(e.target.value)}
                            placeholder={labels.search.placeholder}
                            className="w-full rounded-md bg-white/5 text-white placeholder:text-white/40 text-sm"
                            style={STYLE.input}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 md:hidden">
                            <span className="text-xs text-white/70">{labels.sort.label}</span>
                            <div className="relative">
                                <button
                                    ref={sortButtonRef}
                                    type="button"
                                    onClick={() => setSortOpen((s) => !s)}
                                    aria-haspopup="listbox"
                                    aria-expanded={isSortOpen}
                                    aria-controls="sort-menu"
                                    className="inline-flex items-center gap-2 text-xs focus:outline-none bg-transparent"
                                    style={STYLE.controlBtn}
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
                                        aria-label={labels.sort.label}
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
                                                        onChange({ sort: opt });
                                                        setSortOpen(false);
                                                        setTimeout(() => sortButtonRef.current?.focus(), 0);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-xs"
                                                    style={{ background: isActive ? "rgba(255,255,255,0.06)" : "transparent", color: "#fff" }}
                                                >
                                                    {labels.sort.options[opt]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* tags header */}
                <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-white/70">{labels.tags?.title ?? "Tags"}</div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={toggleShowAll}
                            aria-expanded={showAllTags}
                            className={`inline-flex items-center gap-2 text-xs focus:outline-none ${showAllTags ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                            style={STYLE.controlBtn}
                        >
                            {labels.actions?.showAllGeneric ?? labels.actions?.showAll ?? "Show"}
                        </button>

                        <button
                            type="button"
                            onClick={clearTags}
                            disabled={!values.selectedTags || values.selectedTags.length === 0 || isPending}
                            aria-disabled={!values.selectedTags || values.selectedTags.length === 0 || isPending}
                            className={`inline-flex items-center gap-2 text-xs focus:outline-none ${isPending ? "opacity-60 pointer-events-none text-white/60" : !values.selectedTags || values.selectedTags.length === 0 ? "opacity-50 pointer-events-none text-white/60" : "bg-white/5 text-white/80"}`}
                            style={STYLE.controlBtn}
                        >
                            {isPending ? "Clearing..." : labels.actions?.clearTags ?? "Clear"}
                        </button>
                    </div>
                </div>

                {/* tag chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {renderTagChips}

                    {!showAllTags && tags.length > mobileCollapseLimit && (
                        <div className="flex items-center text-xs text-white/60">+{tags.length - mobileCollapseLimit}</div>
                    )}
                </div>
            </div>
        </section>
    );
}

export default memo(FilterBarInner);
