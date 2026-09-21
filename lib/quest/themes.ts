/**
 * Photo Quest — 毎日ひとつの撮影テーマ。
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
 * **日付の扱いは `./questDate` に置いてある**——あちらは `api-user` に
 * 写しがあり、サーバーと画面の両方が同じ答えを出す必要があるため。
 * **テーマの表はサーバーに要らない**（サーバーは日付で行を持つだけ）ので、
 * 写しはここ1本のまま。
 */

import { questDayNumber } from "./questDate";

// 日付まわりはここから再輸出する（呼ぶ側が2つの入口を覚えなくてよいように）
export {
    questDayNumber,
    isQuestDateKey,
    questTodayKey,
    isQuestJoinable,
    questRowId,
    QUEST_JOIN_WINDOW_DAYS,
} from "./questDate";

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
