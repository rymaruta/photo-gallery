"use client";
import React, { useMemo, useCallback, useState, useEffect } from "react";

export type FilterValues = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: string;
};

export type FilterBarProps = {
    categories: string[];
    tags: string[];
    values: FilterValues;
    onChange: (next: Partial<FilterValues>) => void;
    debounceMs?: number;
};

function ToggleButton({
    children,
    pressed,
    onClick,
    className = "",
    ariaLabel,
}: {
    children: React.ReactNode;
    pressed: boolean;
    onClick: () => void;
    className?: string;
    ariaLabel?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={pressed}
            aria-label={ariaLabel}
            className={`px-3 py-1 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus-visible:ring-2 ${pressed ? "bg-blue-600 text-white" : "bg-white/6 text-white"} ${className}`}
        >
            {children}
        </button>
    );
}

export default function FilterBar({
    categories,
    tags,
    values,
    onChange,
    debounceMs = 250,
}: FilterBarProps) {
    // ローカル query state を持ち、debounce して onChange を呼ぶ
    const [localQuery, setLocalQuery] = useState(values.query);

    useEffect(() => setLocalQuery(values.query), [values.query]);

    useEffect(() => {
        const t = setTimeout(() => {
            if (localQuery !== values.query) onChange({ query: localQuery });
        }, debounceMs);
        return () => clearTimeout(t);
    }, [localQuery, debounceMs, onChange, values.query]);

    const setCategory = useCallback(
        (c: string) => onChange({ category: c }),
        [onChange]
    );

    const toggleTag = useCallback(
        (tag: string) => {
            const next = values.selectedTags.includes(tag)
                ? values.selectedTags.filter((t) => t !== tag)
                : [...values.selectedTags, tag];
            onChange({ selectedTags: next });
        },
        [onChange, values.selectedTags]
    );

    const setSort = useCallback(
        (s: string) => onChange({ sort: s }),
        [onChange]
    );

    const clearAll = useCallback(() => {
        onChange({ category: "All", selectedTags: [], query: "", sort: "new" });
    }, [onChange]);

    const selectedCount = useMemo(() => values.selectedTags.length + (values.category !== "All" ? 1 : 0) + (values.query ? 1 : 0), [values]);

    return (
        <div className="bg-white/5 p-3 rounded-md flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 flex-wrap">
                <label className="sr-only" htmlFor="gallery-search">写真検索</label>
                <input
                    id="gallery-search"
                    type="search"
                    value={localQuery}
                    onChange={(e) => setLocalQuery(e.target.value)}
                    placeholder="検索（タイトル・説明）"
                    className="bg-white/6 placeholder:text-white/70 text-white px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
                />

                <div className="flex items-center gap-2 flex-wrap">
                    {categories.map((c) => (
                        <ToggleButton key={c} pressed={values.category === c} onClick={() => setCategory(c)}>
                            {c}
                        </ToggleButton>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <div className="flex gap-2 flex-wrap">
                    {tags.map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => toggleTag(t)}
                            className={`px-2 py-1 rounded-md text-sm focus:outline-none focus:ring-2 ${values.selectedTags.includes(t) ? "bg-green-600 text-white" : "bg-white/6 text-white"}`}
                            aria-pressed={values.selectedTags.includes(t)}
                            aria-label={`Toggle tag ${t}`}
                        >
                            #{t}
                        </button>
                    ))}
                </div>

                <label className="sr-only" htmlFor="sort-select">並び替え</label>
                <select
                    id="sort-select"
                    value={values.sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="bg-white/6 text-white px-2 py-1 rounded-md"
                >
                    <option value="new">新しい順</option>
                    <option value="old">古い順</option>
                    <option value="popular">人気順</option>
                </select>

                <div className="ml-2 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={clearAll}
                        className="text-xs text-white/70 px-2 py-1 rounded-md hover:bg-white/6 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                        クリア
                    </button>
                    <div className="text-xs text-white/60" aria-live="polite">
                        選択: {selectedCount}
                    </div>
                </div>
            </div>
        </div>
    );
}
