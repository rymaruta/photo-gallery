"use client";

import React from "react";
import Link from "next/link";
import SaveSpotButton from "../components/SaveSpotButton";
import { useLocale } from "../i18n/context";
import { useToast } from "../../lib/hooks/useToast";
import { ROUTES } from "../../lib/routes";
import { shareUrl } from "../../lib/utils/share";
import { todayIn } from "../../lib/utils/sunTimes";
import {
    parseDailyQuiz, quizStorageKey, regionLine, QUIZ_TIME_ZONE, type DailyQuiz,
} from "../../lib/utils/dailyQuiz";

/**
 * 今日の一問「この写真はどこ？」。
 *
 * ## 決まりごと
 *
 *  - **日付は日本時間**（`QUIZ_TIME_ZONE`）。全員が同じ日に同じ問題を見る。
 *    どこで開いても日本の暦日のファイルを読む
 *  - 答えは**1回だけ**。選んだものは端末に残し（日付ごと）、開き直しても結果のまま。
 *    その日の問題が差し替わっていたら（選んだものが選択肢に無い）、答えていない扱い
 *  - **順位・連続記録・正解率は出さない**（数えていない・競争の要素は足さない）
 *  - 写真の作者とライセンスは**答える前から**出す（CC の表示条件）。出典のファイル名に
 *    答えが出ることは割り切った（`lib/utils/dailyQuiz.ts` の冒頭）
 *  - 「まだ読んでいる」「その日の問題が無い」「読めなかった」を混ぜない
 */

type Load =
    | { state: "loading" }
    | { state: "none"; date: string | null }
    | { state: "failed"; date: string }
    | { state: "ready"; quiz: DailyQuiz; chosen: string | null };

function readChosen(ymd: string): string | null {
    try {
        return window.localStorage.getItem(quizStorageKey(ymd));
    } catch {
        return null;
    }
}

function writeChosen(ymd: string, spotId: string): void {
    try {
        window.localStorage.setItem(quizStorageKey(ymd), spotId);
    } catch {
        // 残せなくても答えは出す（開き直すと答えていない扱いになるだけ）
    }
}

/** "2026-10-01" → "10/1" */
function shortDate(ymd: string): string {
    const [, m, d] = ymd.split("-");
    return `${Number(m)}/${Number(d)}`;
}

export default function DailyQuizClient() {
    const { locale } = useLocale();
    const en = locale === "en";
    const { showToast } = useToast();
    const [load, setLoad] = React.useState<Load>({ state: "loading" });
    const [attempt, setAttempt] = React.useState(0);

    React.useEffect(() => {
        const ymd = todayIn(QUIZ_TIME_ZONE);
        let alive = true;
        (async () => {
            if (!ymd) {
                if (alive) setLoad({ state: "none", date: null });
                return;
            }
            try {
                const res = await fetch(`/app/data/quiz/${ymd}.json`);
                if (!alive) return;
                if (res.status === 404) {
                    setLoad({ state: "none", date: ymd });
                    return;
                }
                if (!res.ok) throw new Error(String(res.status));
                const quiz = parseDailyQuiz(await res.json(), ymd);
                if (!alive) return;
                if (!quiz) {
                    setLoad({ state: "none", date: ymd });
                    return;
                }
                const saved = readChosen(ymd);
                const chosen = saved && quiz.choices.some((c) => c.spotId === saved) ? saved : null;
                setLoad({ state: "ready", quiz, chosen });
            } catch {
                if (alive) setLoad({ state: "failed", date: ymd });
            }
        })();
        return () => {
            alive = false;
        };
    }, [attempt]);

    if (load.state === "loading") {
        return (
            <Shell en={en} date={null}>
                <div className="w-full aspect-[4/3] rounded-2xl bg-surface animate-pulse" aria-hidden />
                <p className="m-0 mt-4 text-white/60" style={{ fontSize: "13px" }} role="status">
                    {en ? "Loading today's question…" : "今日の一問を読み込んでいます…"}
                </p>
            </Shell>
        );
    }
    if (load.state === "none") {
        return (
            <Shell en={en} date={load.date}>
                <Notice>
                    {en ? "There's no question for today yet. Please check back later." : "今日の一問はまだありません。時間をおいて開き直してください。"}
                </Notice>
            </Shell>
        );
    }
    if (load.state === "failed") {
        return (
            <Shell en={en} date={load.date}>
                <Notice>
                    <span role="alert">{en ? "Couldn't load today's question." : "今日の一問を読み込めませんでした。"}</span>
                    <button
                        type="button"
                        onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}
                        className="mt-3 min-h-[44px] px-5 rounded-full bg-accent-fill text-ink font-semibold"
                        style={{ fontSize: "15px", touchAction: "manipulation" }}
                    >
                        {en ? "Try again" : "もう一度読み込む"}
                    </button>
                </Notice>
            </Shell>
        );
    }

    const { quiz, chosen } = load;
    const answer = quiz.choices.find((c) => c.spotId === quiz.answer)!;
    const answered = chosen !== null;
    const correct = chosen === quiz.answer;

    const choose = (spotId: string) => {
        if (answered) return;
        writeChosen(quiz.date, spotId);
        setLoad({ state: "ready", quiz, chosen: spotId });
    };

    const share = async () => {
        const url = `${window.location.origin}${ROUTES.QUIZ}`;
        const text = en
            ? `Journey Photo · Where is this? ${shortDate(quiz.date)} ${correct ? "✓" : "✗"}`
            : `Journey Photo 今日の一問 ${shortDate(quiz.date)} ${correct ? "✓ 正解" : "✗"}`;
        const result = await shareUrl(url, en ? "Where is this?" : "今日の一問", text);
        if (result === "copied") showToast(en ? "Link copied" : "リンクをコピーしました", "success");
        if (result === "failed") showToast(en ? "Couldn't share." : "共有できませんでした。", "error");
    };

    return (
        <Shell en={en} date={quiz.date}>
            <figure className="m-0">
                <div className="relative w-full aspect-[4/3] overflow-hidden rounded-2xl bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={quiz.photo.url}
                        alt={en ? "Photo for today's question" : "今日の一問の写真"}
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                </div>
                {/* 作者・ライセンス（文面へ）・出典（CC BY / BY-SA の表示条件） */}
                <figcaption className="mt-1.5 text-white/60 text-right" style={{ fontSize: "11px", lineHeight: "15px" }}>
                    {en ? "Photo: " : "写真: "}{quiz.photo.author}{" / "}
                    {quiz.photo.licenseUrl ? (
                        <a href={quiz.photo.licenseUrl} target="_blank" rel="noopener noreferrer license"
                           className="underline underline-offset-2 hover:text-white">{quiz.photo.license}</a>
                    ) : quiz.photo.license}
                    {" / "}
                    <a href={quiz.photo.pageUrl} target="_blank" rel="noopener noreferrer"
                       className="underline underline-offset-2 hover:text-white">Wikimedia Commons</a>
                </figcaption>
            </figure>

            <h2 className="m-0 mt-5 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.4" }}>
                {en ? "Where is this?" : "この写真はどこ？"}
            </h2>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2" role="group"
                 aria-label={en ? "Choices" : "選択肢"}>
                {quiz.choices.map((c) => {
                    const isAnswer = c.spotId === quiz.answer;
                    const isChosen = c.spotId === chosen;
                    // 答える前は全部同じ見た目。答えたあとは正解を白地、外した選択を赤の縁
                    const look = !answered
                        ? "bg-surface text-white hover:bg-surface-2 ring-1 ring-white/10"
                        : isAnswer
                            ? "bg-primary text-ink font-bold"
                            : isChosen
                                ? "bg-surface text-white ring-2 ring-danger"
                                : "bg-surface text-white/50";
                    return (
                        <button
                            key={c.spotId}
                            type="button"
                            onClick={() => choose(c.spotId)}
                            disabled={answered}
                            aria-pressed={answered ? isChosen : undefined}
                            className={`min-h-[48px] px-4 py-2 rounded-xl text-left transition-colors ${look}`}
                            style={{ fontSize: "15px", lineHeight: "1.4", touchAction: "manipulation" }}
                        >
                            {c.name}
                            {answered && isAnswer && <span className="sr-only">{en ? " (answer)" : "（正解）"}</span>}
                            {answered && isChosen && !isAnswer && <span className="sr-only">{en ? " (your choice)" : "（あなたの選択）"}</span>}
                        </button>
                    );
                })}
            </div>

            {answered && (
                <section className="mt-6 rounded-2xl bg-surface p-4 sm:p-5" aria-live="polite" data-testid="quiz-result">
                    <p className={`m-0 font-mono font-medium uppercase ${correct ? "text-accent" : "text-white/60"}`}
                       style={{ fontSize: "11px", letterSpacing: "1.5px" }}>
                        {correct ? (en ? "Correct" : "正解") : (en ? "Not quite" : "残念")}
                    </p>
                    <p className="m-0 mt-1 font-serif font-bold text-white" style={{ fontSize: "20px", lineHeight: "1.4" }}>
                        {answer.name}
                    </p>
                    {regionLine(answer.region) && (
                        <p className="m-0 mt-0.5 text-white/60" style={{ fontSize: "13px" }}>{regionLine(answer.region)}</p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link
                            href={`/spots/${answer.slug}`}
                            prefetch={false}
                            className="inline-flex items-center min-h-[44px] px-5 rounded-full bg-accent-fill text-ink font-semibold"
                            style={{ fontSize: "15px" }}
                        >
                            {en ? "See the guide" : "ガイドを見る"}
                        </Link>
                        <SaveSpotButton slug={answer.slug} name={answer.name} locale={en ? "en" : "ja"} kind="spot" />
                        <button
                            type="button"
                            onClick={share}
                            className="inline-flex items-center min-h-[44px] px-5 rounded-full ring-1 ring-white/30 text-white hover:bg-white/10"
                            style={{ fontSize: "15px", touchAction: "manipulation" }}
                        >
                            {en ? "Share" : "結果を共有"}
                        </button>
                    </div>
                    <p className="m-0 mt-4 text-white/60" style={{ fontSize: "12px" }}>
                        {en ? "A new photo tomorrow." : "明日また新しい写真が出ます。"}
                    </p>
                </section>
            )}
        </Shell>
    );
}

function Shell({ en, date, children }: { en: boolean; date: string | null; children: React.ReactNode }) {
    return (
        <main className="px-4 sm:px-6 pt-5 pb-28 min-h-screen text-white bg-bg max-w-xl mx-auto w-full">
            <p className="m-0 font-mono font-medium uppercase text-accent" style={{ fontSize: "11px", letterSpacing: "1.5px" }}>
                {en ? "Today's question" : "今日の一問"}{date ? ` · ${date.replaceAll("-", ".")}` : ""}
            </p>
            <h1 className="sr-only">{en ? "Today's question" : "今日の一問"}</h1>
            <div className="mt-3">{children}</div>
        </main>
    );
}

function Notice({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-2xl bg-surface py-12 px-6 flex flex-col items-center text-center text-white/70" style={{ fontSize: "14px" }}>
            {children}
        </div>
    );
}
