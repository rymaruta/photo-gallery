/**
 * Photo Quest の日付まわり。**画面とサーバーの両方が同じ答えを出す必要がある。**
 *
 * ⚠️ **このファイルは `lib/quest/` と `api-user/src/` の2本に写しがある。**
 * ユーザーAPI（`api-user`）は別パッケージ・別の esbuild で、ルートの `lib` を
 * import できない（`publicFeed.ts` `cdnInvalidate.ts` `env.ts` と同じ事情）。
 * ずれると**行を見ても分からない壊れ方**をする——画面が「今日のクエスト」
 * として出している日付を、サーバーが「範囲外」と撥ねる。
 * 一致は `scripts/__tests__/questDateParity.test.ts` が見る。
 * **片方だけ直さないこと。**
 *
 * ## `Date.parse` を通さない
 *
 * `lib/utils/photoOrder.ts` が測って書いているとおり、JS はゾーンの無い
 * `2024-11-01T07:30:00` を**ローカル時刻**として、日付だけの `2024-11-01` を
 * **UTC** として解釈する。**文字列を JS に解釈させない。** ここでは自分で
 * `YYYY-MM-DD` から数値3つを取り出し、`Date.UTC` に**数値として**渡す。
 * 数値には解釈の余地が無いので、閲覧者のタイムゾーンで答えが変わらない。
 */

/** `YYYY-MM-DD` ちょうどの形か（時刻付きは受けない） */
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 1日のミリ秒 */
const MS_PER_DAY = 86_400_000;

/**
 * `YYYY-MM-DD` を「1970-01-01 から数えた日数」にする。形が違えば `null`。
 */
export function questDayNumber(dateKey: string): number | null {
    const m = DATE_KEY.exec(dateKey);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const back = new Date(Date.UTC(y, mo - 1, d));
    /**
     * **組み直して、書かれていた文字列と丸ごと突き合わせる。**
     * これ1つで「範囲の検査」も「存在しない日付」も「2桁年」も兼ねる。
     *
     * `Date.UTC` は範囲外を黙って繰り上げる（`2026-13-01` → 2027-01-01、
     * `2026-09-00` → 2026-08-31、`2026-02-31` → 2026-03-03）。通すと
     * **存在しない日付が有効な日付の別名**になり、参加の行が2つに割れる。
     *
     * また `Date.UTC(26, …)` は西暦26年ではなく **1926年**を指す（2桁年の
     * 遺産）。`0026-09-21` は 1926-09-21 になるが、文字列が一致しないので
     * 落ちる——黙って1926年として通らない。
     *
     * **なぜ年・月・日を別々に比べないのか。** 最初はそう書いていたが、
     * 変異テストで**日の比較を消しても1件も落ちなかった**。総当たり
     * （2026年の全月 × 日0〜99＝1,200通り）で確かめると、年と月が一致した
     * まま日だけずれる入力は **0件**——繰り上がりは必ず月をまたぐので、
     * 日の比較は**一度も到達しない死んだ枝**だった。その手前に書いていた
     * `mo < 1 || mo > 12 || …` の範囲検査も同じ理由で死んでいた。
     * 丸ごと1回比べる形なら、どこを削っても必ずテストが落ちる。
     */
    if (back.toISOString().slice(0, 10) !== dateKey) return null;
    return Math.floor(back.getTime() / MS_PER_DAY);
}

/** `YYYY-MM-DD` として妥当か */
export function isQuestDateKey(value: unknown): value is string {
    return typeof value === "string" && questDayNumber(value) !== null;
}

/**
 * 閲覧者の**その場の日付**を `YYYY-MM-DD` で返す。
 *
 * **UTC ではなく端末の暦で切る。** 「今日の空」は見ている人の今日であって、
 * グリニッジの今日ではない（JST の夜9時は UTC ではまだ前日）。
 * 文字列を解釈させる経路は通らない——`Date` から数値を取り出して組むだけ。
 *
 * ⚠️ **サーバーから呼ばない。** Lambda の now は UTC で、投稿者の今日とは
 * 限らない。サーバーは受け取った日付を検証する側に回る。
 */
export function questTodayKey(now: Date = new Date()): string {
    const y = String(now.getFullYear()).padStart(4, "0");
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/**
 * 参加を受ける窓。**今日ちょうどには縛らない。**
 *
 * 端末の暦で切るので、世界のどこから押すかで最大±1日ずれる（UTC-11 と
 * UTC+14 では暦日が2つ違う）。サーバーが「UTC の今日」だけを通すと、
 * **その時間帯の人は自分の画面に出ているクエストに参加できない**。
 * だから前後に1日ずつ余裕を持たせる。
 *
 * 一方で**いくらでも過去に参加できるようにはしない**——過去のクエストを
 * 遡って埋める形は「毎日の参加を強制しない」の逆側（埋めたくなる）で、
 * owner が作るなと言っている連続記録と同じものを利用者の頭の中に作る。
 */
export const QUEST_JOIN_WINDOW_DAYS = 1;

/** `dateKey` が `nowKey` から見て参加を受け付けられる範囲か */
export function isQuestJoinable(dateKey: string, nowKey: string): boolean {
    const a = questDayNumber(dateKey);
    const b = questDayNumber(nowKey);
    if (a === null || b === null) return false;
    return Math.abs(a - b) <= QUEST_JOIN_WINDOW_DAYS;
}

/** 参加の一覧を持つ行の id。`updateUserList` の「対象ごとの1行」 */
export function questRowId(dateKey: string): string {
    return `quest#${dateKey}`;
}
