import React from "react";
import HomeEntryRow from "./HomeEntryRow";
import { ROUTES } from "../../lib/routes";

/**
 * ホームの「今日の一問」への入口（`/q`）。**1行だけ**（形は `HomeEntryRow`）。
 * 3つのタブのどれでも同じ位置（タブの直下）に出す＝切り替えても見出しの位置が動かない。
 *
 * 問題の中身（写真・選択肢）はここでは読まない——開いた日の分を `/q` が読む。
 */
export default function QuizEntry({ locale }: { locale: "ja" | "en" }) {
    const en = locale === "en";
    return (
        <HomeEntryRow
            href={ROUTES.QUIZ}
            testId="home-quiz-entry"
            eyebrow={en ? "Daily quiz" : "今日の一問"}
            text={en ? "Where is this photo?" : "この写真はどこ？"}
        />
    );
}
