import DailyQuizClient from "./DailyQuizClient";

/**
 * 今日の一問（`/q`）。問題はビルド時に日ごとのファイルへ書き出してあり
 * （`/app/data/quiz/<日付>.json`・`lib/data/quizFeed.ts`）、画面は開いた日の分を読む。
 * **台帳はここから渡さない**——静的な殻に今日の問題を焼き込むと、次のビルドまで
 * 同じ問題が出続ける。
 */
export default function QuizPage() {
    return <DailyQuizClient />;
}
