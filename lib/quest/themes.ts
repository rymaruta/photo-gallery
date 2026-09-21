/**
 * Photo Quest — 毎日ひとつの撮影テーマ。
 *
 * **このファイルは純粋な計算だけを持つ。** 画面（`app/quest/**`）と
 * サーバー（`api-user/src/quest.ts`）の両方が同じ答えを出す必要があるので、
 * 表と引き方を1か所に置く。
 *
 * ## なぜ「日付 → テーマ」の関数なのか（テーマを保存するのではなく）
 *
 * このサイトは `output: "export"` の**完全な静的書き出し**で、しかも
 * 定期ビルドは**週1**（`CLAUDE.md`）。つまり「今日のテーマ」を HTML に
 * 焼くと、**最大7日前のテーマが「今日」と名乗る**。
 *
 * だからテーマは保存せず、**日付から決まる関数**にする。ビルドがいつでも
 * 画面は今日を出せるし、サーバーも同じ日付から同じテーマを引ける
 * （保存した値を突き合わせる必要が無い＝ずれようが無い）。
 *
 * ## `Date.parse` を通さない
 *
 * `lib/utils/photoOrder.ts` が測って書いているとおり、JS は
 * ゾーンの無い `2024-11-01T07:30:00` を**ローカル時刻**として、日付だけの
 * `2024-11-01` を **UTC** として解釈する。**文字列を JS に解釈させない。**
 * ここでは自分で `YYYY-MM-DD` から数値3つを取り出し、`Date.UTC(y, m-1, d)`
 * に**数値として**渡す。数値には解釈の余地が無いので、閲覧者のタイムゾーンで
 * 答えが変わらない。
 */

/** 撮影テーマ1つ。`id` は URL とテストが掴む安定な名前で、**並べ替えても変えない** */
export type QuestTheme = {
    /** 安定な識別子（英小文字とハイフンのみ）。表示には使わない */
    id: string;
    /** 画面に出す題 */
    title: string;
    /** 題だけだと何を撮ればいいか分からないときの一言 */
    hint: string;
};

/**
 * テーマの表。
 *
 * **順番を入れ替えない・間から消さない。** 並びが変わると過去の日付が
 * 引くテーマも変わる——「あの日のクエスト」を指す URL が別の題を出す。
 * 増やすときは**末尾に足す**（それでも周期が変わるので過去は動くが、
 * 参加の一覧は日付で持つので取り違えは起きない）。
 *
 * **競争にしない。** 連続記録・レベル・称号・ランキングは作らない
 * （owner の明示の指示・`CLAUDE.md` の「SNS的な競争要素は増やさない」）。
 * ここに在るのは「今日は何を撮ろうか」の一言だけ。
 */
export const QUEST_THEMES: readonly QuestTheme[] = [
    { id: "todays-sky", title: "今日の空", hint: "見上げた空を、そのまま" },
    { id: "light-and-shadow", title: "光と影", hint: "光が作った形をさがす" },
    { id: "something-blue", title: "青いもの", hint: "青ければ何でも" },
    { id: "morning", title: "朝の気配", hint: "一日が始まる前の静けさ" },
    { id: "water", title: "水のかたち", hint: "川・海・水たまり・グラスの中" },
    { id: "doors-and-windows", title: "扉と窓", hint: "向こう側を想像させるもの" },
    { id: "green", title: "緑のなか", hint: "葉・草・苔・木立" },
    { id: "texture", title: "手ざわり", hint: "触れたら分かる表面を、目で" },
    { id: "long-road", title: "続く道", hint: "どこかへ向かっている線" },
    { id: "small-things", title: "小さなもの", hint: "近づかないと見えない大きさ" },
    { id: "reflection", title: "うつりこみ", hint: "水面・ガラス・金属" },
    { id: "golden-hour", title: "日が傾くころ", hint: "沈む少し前の色" },
    { id: "geometry", title: "まっすぐな線", hint: "建物・階段・柵" },
    { id: "someone-there", title: "そこにいた人", hint: "後ろ姿でも、影でも" },
    { id: "red", title: "赤いもの", hint: "ひとつだけ赤いと目が行く" },
    { id: "weather", title: "その日の天気", hint: "雨・風・霧・晴れ" },
    { id: "food-table", title: "食卓", hint: "食べる前の、その一瞬" },
    { id: "night-lights", title: "夜のあかり", hint: "街灯・窓・看板" },
    { id: "old-things", title: "古いもの", hint: "時間が付いた表面" },
    { id: "from-above", title: "見下ろす", hint: "いつもより高いところから" },
    { id: "from-below", title: "見上げる", hint: "しゃがんで、下から" },
    { id: "white", title: "白いもの", hint: "雪・壁・紙・雲" },
    { id: "moving", title: "動いているもの", hint: "止めても、流しても" },
    { id: "quiet-corner", title: "静かな一角", hint: "人のいない場所" },
    { id: "sign", title: "文字のある風景", hint: "看板・標識・落書き" },
    { id: "plants-in-town", title: "街の植物", hint: "誰かが置いた緑、勝手に生えた緑" },
    { id: "far-away", title: "遠くのもの", hint: "山・水平線・向こう岸" },
    { id: "warm-color", title: "あたたかい色", hint: "橙・黄・肌の色" },
];

/** `YYYY-MM-DD` ちょうどの形か（時刻付きは受けない） */
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 1日のミリ秒 */
const MS_PER_DAY = 86_400_000;

/**
 * `YYYY-MM-DD` を「1970-01-01 から数えた日数」にする。形が違えば `null`。
 *
 * **`Date.parse` にも `new Date(文字列)` にも渡さない。** 数値3つに分けて
 * `Date.UTC` へ渡す。ついでに `Date.UTC` は `2026-02-31` のような存在しない
 * 日を 3/3 に繰り上げるので、**戻して突き合わせて弾く**（繰り上がった値を
 * 通すと、無効な日付が有効な日付の別名になり、参加の行が2つに割れる）。
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
    const ms = back.getTime();
    return Math.floor(ms / MS_PER_DAY);
}

/** `YYYY-MM-DD` として妥当か */
export function isQuestDateKey(value: unknown): value is string {
    return typeof value === "string" && questDayNumber(value) !== null;
}

/**
 * その日のテーマ。形が違う日付には `null`（**適当な既定を返さない**——
 * 壊れた入力に「今日の空」を返すと、サーバーと画面が違う日の話を始める）。
 */
export function questThemeForDate(dateKey: string): QuestTheme | null {
    const day = questDayNumber(dateKey);
    if (day === null) return null;
    // 1970-01-01 より前は負になる。剰余の符号を正に畳む
    const n = QUEST_THEMES.length;
    return QUEST_THEMES[((day % n) + n) % n];
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
