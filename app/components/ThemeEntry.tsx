"use client";

import React from "react";
import HomeEntryRow from "./HomeEntryRow";
import { ROUTES } from "../../lib/routes";
import { dailyThemeFor, type DailyThemeEntry } from "../../lib/utils/dailyTheme";

/**
 * ホームの「今日のテーマ」への入口（アプリ v2 の `DailyThemeCard` の Web 版・2026-10-15）。
 * **1行だけ**（形は `HomeEntryRow`。ホームに大きな札を足さない決まり）。
 * 押すと、そのタグを入れた投稿画面を開く（`?tag=`・`readThemeTag` がテーマのタグだけ通す）。
 *
 * **テーマは見ている端末の日付で決める**ので、描くのは載ったあと。静的書き出しの HTML は
 * 書き出した日のテーマを焼き込んでしまい、翌日も古いまま配られる（と、載った瞬間に
 * 食い違って React が描き直す）。載るまでは行の形だけ出す——高さは変わらないので画面は跳ねない。
 */
export default function ThemeEntry({ locale }: { locale: "ja" | "en" }) {
    const en = locale === "en";
    const [theme, setTheme] = React.useState<DailyThemeEntry | null>(null);
    React.useEffect(() => { setTheme(dailyThemeFor()); }, []);
    return (
        <HomeEntryRow
            href={theme ? `${ROUTES.UPLOAD}?tag=${encodeURIComponent(theme.tag)}` : ROUTES.UPLOAD}
            testId="home-theme-entry"
            eyebrow={en ? "Today's theme" : "今日のテーマ"}
            text={theme ? `#${theme.tag} · ${en ? theme.title.en : theme.title.ja}` : ""}
        />
    );
}
