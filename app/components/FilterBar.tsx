// app/components/FilterBar.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
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
    // optional map to override category display names: { key: "表示名" }
    categoryDisplayMap?: Record<string, string>;
}) {
    const labels: Labels = getLabels(locale);

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

    // Visual constants (黒寄りパネル、白めの境界)
    const bg = "#07090a";
    const outerBorder = "rgba(255,255,255,0.26)";
    const innerLine = "rgba(255,255,255,0.12)";
    const subtleInset = "inset 0 1px 0 rgba(255,255,255,0.02)";
    const subtleShadow = "0 1px 8px rgba(0,0,0,0.65)";

    return (
        <section className={`mb-6 ${className}`}>
            <div
                className="rounded-lg p-4"
                style={{
                    backgroundColor: bg,
                    border: `2px solid ${outerBorder}`,
                    boxShadow: `${subtleShadow}, ${subtleInset}`,
                }}
            >
                {/* 上段: カテゴリ + 並び替え */}
                <div
                    className="flex items-center gap-4 flex-wrap"
                    style={{
                        paddingBottom: 12,
                        borderBottom: `2px solid ${innerLine}`,
                        marginBottom: 12,
                    }}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-white/70 mr-2">{labels.category.title}</span>

                        <div className="flex gap-2">
                            {/* "All" ボタン */}
                            <button
                                key="all"
                                onClick={() => onChange({ category: "all" })}
                                className={`px-2 py-1 text-sm rounded-md ${values.category === "all" ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                                aria-pressed={values.category === "all"}
                            >
                                {labelForCategory("all")}
                            </button>

                            {categories.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => onChange({ category: c })}
                                    className={`px-2 py-1 text-sm rounded-md ${values.category === c ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                                    aria-pressed={values.category === c}
                                >
                                    {labelForCategory(c)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <label className="text-sm text-white/70">{labels.sort.label}</label>

                        <select
                            value={values.sort}
                            onChange={(e) => onChange({ sort: e.target.value })}
                            aria-label={labels.sort.label}
                            className="appearance-none px-2 py-1 rounded-md text-sm"
                            style={{
                                backgroundColor: bg,
                                color: "#ffffff",
                                border: `1px solid rgba(255,255,255,0.06)`,
                            }}
                        >
                            <option value="new" style={{ backgroundColor: bg, color: "#ffffff" }}>
                                {labels.sort.options.new}
                            </option>
                            <option value="old" style={{ backgroundColor: bg, color: "#ffffff" }}>
                                {labels.sort.options.old}
                            </option>
                            <option value="popular" style={{ backgroundColor: bg, color: "#ffffff" }}>
                                {labels.sort.options.popular}
                            </option>
                        </select>
                    </div>
                </div>

                {/* タグ */}
                <div className="mt-1">
                    <div className="text-sm text-white/70 mb-2">{labels.tags.title}</div>
                    <div className="flex gap-2 flex-wrap">
                        {tags.map((t) => {
                            const active = values.selectedTags.includes(t);
                            return (
                                <button
                                    key={t}
                                    onClick={() => toggleTag(t)}
                                    className={`px-2 py-1 text-sm rounded-md ${active ? "bg-white text-black" : "bg-white/5 text-white/80"}`}
                                    aria-pressed={active}
                                >
                                    {t}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 検索行（上と分離） */}
                <div
                    className="mt-4"
                    style={{
                        paddingTop: 12,
                        borderTop: `2px solid ${innerLine}`,
                        marginTop: 12,
                    }}
                >
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            type="search"
                            value={localQuery}
                            onChange={(e) => {
                                setLocalQuery(e.target.value);
                                debouncedApply(e.target.value);
                            }}
                            placeholder={labels.search.placeholder}
                            className="w-full px-3 py-2 rounded-md text-sm"
                            aria-label={labels.search.placeholder}
                            style={{
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
                                className="px-2 py-1 rounded-md text-sm"
                                style={{
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
