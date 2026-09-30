// lib/data/quizFeed.ts（サーバー専用）
//
// **今日の一問のファイル**（`/app/data/quiz/<YYYY-MM-DD>.json`）をビルド時に書き出す。
// 出題の規則は `lib/utils/dailyQuiz.ts`。Web の `/q` もアプリも、この日ごとのファイルを読む
// ＝同じ日に同じ問題（規則を2か所に書かない）。
//
// ## 何日ぶん書くか
//
// ビルドした日（日本時間）の**前日から 60 日ぶん**。定期ビルドは週1（日曜）なので、
// 次のビルドまで必ず足りる。前日を含めるのは、日本より時差の遅い土地で開いたときや、
// ビルドが日付の変わり目をまたいだときに「今日」のファイルが無い、を避けるため。
// ファイルが無い日は、画面が「今日の一問はまだありません」と言うだけ（作り話の問題を出さない）。
//
// ## 材料
//
// アプリの索引（`spotFeed.ts`）のうち、**公開済みで写真のある行**。索引と同じ関数から取るので、
// アプリが知っているスポットと食い違わない。
//
// 🔴 台帳を値で読む。**`"use client"` から import しない**。

import { spotIndexFeed, type SpotFeedItem } from "./spotFeed";
import { buildDailyQuiz, datesFrom, QUIZ_TIME_ZONE, type QuizSpot, type DailyQuiz } from "../utils/dailyQuiz";
import { todayIn } from "../utils/sunTimes";

/** 何日ぶん書くか（前日を含む） */
export const QUIZ_DAYS_AHEAD = 60;

export function quizPool(items: readonly SpotFeedItem[]): QuizSpot[] {
    return items
        .filter((i) => i.stage === "published" && i.image)
        .map((i) => ({ spotId: i.spotId, slug: i.slug, name: i.name, region: i.region, image: i.image! }));
}

/** 書き出す日付（ビルドした日の前日から） */
export function quizDates(now: Date = new Date()): string[] {
    const today = todayIn(QUIZ_TIME_ZONE, now);
    if (!today) return [];
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return datesFrom(yesterday, QUIZ_DAYS_AHEAD + 1);
}

/** 実際の候補。ビルドの間は台帳が変わらないので1回だけ作る（日ごとに索引を作り直さない） */
let cachedPool: QuizSpot[] | null = null;

export function dailyQuizFor(ymd: string, items?: readonly SpotFeedItem[]): DailyQuiz | null {
    const pool = items ? quizPool(items) : (cachedPool ??= quizPool(spotIndexFeed()));
    return buildDailyQuiz(pool, ymd);
}
