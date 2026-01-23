"use client";

import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { getLabels } from "./labels";
import type { Labels } from "./labels";
import type { Locale } from "../data/photos";

type LocaleContextType = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    labels: Labels;
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
    // 初期値はローカルストレージから読み込む（クライアント側のみ）
    // サーバー側では常に"ja"を返す
    const [locale, setLocaleState] = useState<Locale>(() => {
        if (typeof window === "undefined") return "ja";
        const saved = localStorage.getItem("locale");
        return (saved === "en" || saved === "ja") ? saved : "ja";
    });

    // クライアント側でのみローカルストレージからロケールを読み込む
    // デフォルトは日本語（"ja"）
    useEffect(() => {
        // 初回訪問時はlocalStorageを確認せず、日本語をデフォルトにする
        // ユーザーが明示的に言語を切り替えた場合のみlocalStorageから読み込む
        const saved = localStorage.getItem("locale");
        // 保存されている値が有効な場合のみ使用（初回訪問時は"ja"のまま）
        if (saved === "en" || saved === "ja") {
            // ただし、初回訪問時（localStorageに保存されていない場合）は日本語を優先
            // 既に保存されている場合のみ、保存された値を使用
            if (saved && saved !== locale) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setLocaleState(saved);
            }
        }
    }, [locale]);

    // ロケール変更時にローカルストレージに保存
    const setLocale = (newLocale: Locale) => {
        setLocaleState(newLocale);
        if (typeof window !== "undefined") {
            localStorage.setItem("locale", newLocale);
        }
    };

    // ラベルを取得
    const labels = useMemo(() => getLabels(locale), [locale]);

    return (
        <LocaleContext.Provider value={{ locale, setLocale, labels }}>
            {children}
        </LocaleContext.Provider>
    );
}

export function useLocale() {
    const context = useContext(LocaleContext);
    if (context === undefined) {
        throw new Error("useLocale must be used within a LocaleProvider");
    }
    return context;
}
