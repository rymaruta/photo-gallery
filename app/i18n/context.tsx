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
    // サーバーとクライアントの初期値を "ja" で統一してハイドレーションミスマッチを防ぐ
    // localStorage の読み込みは useEffect でマウント後に行う
    const [locale, setLocaleState] = useState<Locale>("ja");

    // マウント後に localStorage から保存済みロケールを読み込む（SSRハイドレーション対応）
    useEffect(() => {
        const saved = localStorage.getItem("locale");
        if (saved === "en" || saved === "ja") {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLocaleState(saved);
        }
    }, []);

    // ロケール変更時に <html lang> を更新
    useEffect(() => {
        document.documentElement.lang = locale;
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
