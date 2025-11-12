"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash.debounce";
import { getLabels, Labels } from "../i18n/labels";

export type FilterValues = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: string;
};

export default function FilterBar({
    categories,
    tags,
    values,
    onChange,
    className = "",
    locale = "ja",
    categoryDisplayMap,
}: {
    categories: string[];
    tags: string[];
    values: FilterValues;
    onChange: (next: Partial<FilterValues>) => void;
    className?: string;
    locale?: string;
    categoryDisplayMap?: Record<string, string>;
}) {
    const safeLocale = locale === "en" ? "en" : "ja";
    const labels = getLabels(safeLocale);
    const [localQuery, setLocalQuery] = useState(values.query || "");
    useEffect(() => {
        setLocalQuery(values.query || "");
    }, [values.query]);

    const debouncedApply = useMemo(
        () =>
            debounce((q: string) => {
                onChange({ query: q });
            }, 300),
        [onChange]
    );
    useEffect(() => {
        return () => debouncedApply.cancel();
    }, [debouncedApply]);

    const toggleTag = (t: string) => {
        const set = new Set(values.selectedTags);
        if (set.has(t)) set.delete(t);
        else set.add(t);
        onChange({ selectedTags: Array.from(set) });
    };

    const labelForCategory = (key: string) => {
        if (categoryDisplayMap && categoryDisplayMap[key]) return categoryDisplayMap[key];
        return labels.category.names?.[key] ?? key;
    };

    // Visual constants
    const bg = "#07090a";
    const outerBorder = "rgba(255,255,255,0.26)";
    const innerLine = "rgba(255,255,255,0.12)";
    const subtleInset = "inset 0 1px 0 rgba(255,255,255,0.02)";
    const subtleShadow = "0 1px 8px rgba(0,0,0,0.65)";

    // Sort dropdown state / refs
    const [isSortOpen, setSortOpen] = useState(false);
    const sortButtonRef = useRef<HTMLButtonElement | null>(null);
    const sortMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!isSortOpen) return;
            const target = e.target as Node | null;
            if (sortButtonRef.current?.contains(target) || sortMenuRef.current?.contains(target)) return;
            setSortOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSortOpen(false);
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
        const options = Array.from(sortMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
        let idx = options.findIndex((o) => o.getAttribute("data-value") === values.sort);
        if (idx === -1) idx = 0;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                idx = (idx + 1 + options.length) % options.length;
                options[idx]?.focus();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                idx = (idx - 1 + options.length) % options.length;
                options[idx]?.focus();
            } else if (e.key === "Enter") {
                options[idx]?.click();
            }
        };
        document.addEventListener("keydown", onKey);
        setTimeout(() => options[idx]?.focus(), 0);
        return () => document.removeEventListener("keydown", onKey);
    }, [isSortOpen, values.sort]);

    const sortOptions: Array<"new" | "old" | "popular"> = ["new", "old", "popular"];

    return (
        <section className={`mb-4 ${className}`}>
            <div
                className="rounded-lg"
                style={{
                    backgroundColor: bg,
                    border: `2px solid ${outerBorder}`,
                    boxShadow: `${subtleShadow}, ${subtleInset}`,
                    padding: 10,
                }}
            >
                {/* Top row: categories + sort */}
                <div
                    className="flex items-center gap-3 flex-wrap"
                    style={{
                        paddingBottom: 6,
                        borderBottom: `2px solid ${innerLine}`,
                        marginBottom: 8,
                    }}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-white/70 mr-2">{labels.category.title}</span>

                        <div className="flex gap-1.5">
                            <button
                                key="all"
                                onClick={() => onChange({ category: "all" })}
                                className={`text-sm rounded-md ${values.category === "all" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                                aria-pressed={values.category === "all"}
                                aria-label={labelForCategory("all")}
                                style={{ padding: "4px 6px" }}
                            >
                                {labelForCategory("all")}
                            </button>

                            {categories.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => onChange({ category: c })}
                                    className={`text-sm rounded-md ${values.category === c ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                                    aria-pressed={values.category === c}
                                    aria-label={labelForCategory(c)}
                                    style={{ padding: "4px 6px" }}
                                >
                                    {labelForCategory(c)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sort dropdown */}
                    <div className="ml-auto flex items-center gap-2">
                        <span className="text-sm text-white/70">{labels.sort.label}</span>

                        <div className="relative">
                            <button
                                type="button"
                                ref={sortButtonRef}
                                onClick={() => setSortOpen((s) => !s)}
                                aria-haspopup="listbox"
                                aria-expanded={isSortOpen}
                                className="flex items-center gap-2 rounded-md text-sm"
                                style={{
                                    backgroundColor: bg,
                                    color: "#ffffff",
                                    border: `1px solid rgba(255,255,255,0.06)`,
                                    padding: "4px 8px",
                                }}
                            >
                                <span style={{ lineHeight: 1 }}>{labels.sort.options[values.sort as "new" | "old" | "popular"] ?? values.sort}</span>
                                <svg className="h-4 w-4 ml-1 text-white/70" viewBox="0 0 20 20" fill="none" aria-hidden>
                                    <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>

                            {isSortOpen && (
                                <div
                                    ref={sortMenuRef}
                                    role="listbox"
                                    aria-label={labels.sort.label}
                                    className="absolute right-0 mt-2 z-50"
                                    style={{
                                        minWidth: 140,
                                        borderRadius: 10,
                                        overflow: "hidden", // 角丸に沿わせるためクリップ
                                        backgroundColor: bg,
                                        border: `2px solid ${outerBorder}`,
                                        boxShadow: `${subtleShadow}, ${subtleInset}`,
                                        padding: 0, // ← 内枠余白をゼロにする
                                    }}
                                >
                                    <div className="flex flex-col" role="presentation" style={{ padding: 0, margin: 0 }}>
                                        {sortOptions.map((val, i) => {
                                            const isActive = values.sort === val;
                                            const isFirst = i === 0;
                                            const isLast = i === sortOptions.length - 1;

                                            const borderRadiusStyle: React.CSSProperties = isActive
                                                ? {
                                                    borderTopLeftRadius: isFirst ? 10 : 0,
                                                    borderTopRightRadius: isFirst ? 10 : 0,
                                                    borderBottomLeftRadius: isLast ? 10 : 0,
                                                    borderBottomRightRadius: isLast ? 10 : 0,
                                                }
                                                : { borderRadius: 0 };

                                            return (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    role="option"
                                                    data-value={val}
                                                    aria-selected={isActive}
                                                    onClick={() => {
                                                        onChange({ sort: val });
                                                        setSortOpen(false);
                                                    }}
                                                    className="text-left w-full text-sm focus:outline-none"
                                                    style={{
                                                        margin: 0, // 外側余白を消す
                                                        padding: "8px 10px", // option 自体のパディングのみで調整
                                                        backgroundColor: isActive ? "#ffffff" : "transparent",
                                                        color: isActive ? "#07090a" : "rgba(255,255,255,0.92)",
                                                        ...borderRadiusStyle,
                                                        transition: "background-color .12s, color .12s",
                                                        boxShadow: isActive ? "inset 0 -1px 0 rgba(0,0,0,0.06)" : undefined,
                                                        border: "none",
                                                        display: "block",
                                                    }}
                                                >
                                                    {labels.sort.options[val]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tags */}
                <div className="mt-1">
                    <div className="text-sm text-white/70 mb-1">{labels.tags.title}</div>
                    <div className="flex gap-1.5 flex-wrap">
                        {tags.map((t) => {
                            const active = values.selectedTags.includes(t);
                            return (
                                <button
                                    key={t}
                                    onClick={() => toggleTag(t)}
                                    className={`text-sm rounded-md ${active ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                                    aria-pressed={active}
                                    style={{ padding: "4px 6px" }}
                                >
                                    {t}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Search */}
                <div
                    className="mt-3"
                    style={{
                        paddingTop: 8,
                        borderTop: `2px solid ${innerLine}`,
                        marginTop: 8,
                    }}
                >
                    <div className="flex items-center gap-2">
                        <input
                            type="search"
                            value={localQuery}
                            onChange={(e) => {
                                setLocalQuery(e.target.value);
                                debouncedApply(e.target.value);
                            }}
                            placeholder={labels.search.placeholder}
                            className="w-full text-sm rounded-md"
                            aria-label={labels.search.placeholder}
                            style={{
                                padding: "6px 8px",
                                backgroundColor: "rgba(255,255,255,0.02)",
                                color: "#ffffff",
                                border: `1px solid rgba(255,255,255,0.04)`,
                            }}
                        />
                        {localQuery && (
                            <button
                                onClick={() => {
                                    setLocalQuery("");
                                    onChange({ query: "" });
                                }}
                                className="text-sm rounded-md"
                                style={{
                                    padding: "6px 8px",
                                    backgroundColor: "rgba(255,255,255,0.02)",
                                    color: "#ffffff",
                                    border: `1px solid rgba(255,255,255,0.04)`,
                                }}
                            >
                                {labels.search.clear}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
