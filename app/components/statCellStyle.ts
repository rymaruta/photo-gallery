/**
 * マイページの「数字の行」の文字の大きさ。
 * （「旅の実績」の行の値もここに在ったが、v2 の「旅の記録」（`app/users/TravelRecord.tsx`）に
 * 置き換えたので消した。下の表の「24」「総移動距離」はそのときの実測の記録）
 *
 * 最終版モック（`docs/mockups/04-mypage.jpg`）の**画素から測った**値。
 * 端末の画面は x=314..677（364px）で、これを 393px と見て 1画素 ≈ 1.08 CSS px。
 * 文字は墨（ink）の高さから逆算する（数字の大文字高 ≈ 0.72em・漢字 ≈ 0.87em）:
 *
 *     「182」          墨 13px → 14.0 CSS → 19.4 → 20
 *     「投稿」          墨 11px → 11.9 CSS → 13.7 → 13
 *     「24」「128,600」 墨 14px → 15.1 CSS → 21.0 → 21
 *     「総移動距離」     墨 12px → 13.0 CSS → 14.9 → 14
 *     縦の区切り線      墨 24px → 26 CSS          → 28
 *
 * **2つのファイルが同じ数字を持たないように、ここ1つから読む。**
 * 数字の行は `app/users/UserProfileClient.tsx`（投稿のセル）と
 * `app/components/FollowButton.tsx`（`variant="stats"` のフォロワー／フォロー中）に
 * 分かれていて、片方だけ直すと同じ行の中で字の大きさが割れる。
 */
export const STAT_NUMBER_PX = 20;
/**
 * **2026-10-30 束 0b C14: iOS の `ProfileStat` にそろえる。** 数は 20 semibold の等幅数字（`JPFont.statNumber`）、
 * 名前はその下 2 に 12 の text-3、**左寄せで縦の区切り線なし**（以前は 20 bold・名前 13 白60%・中央寄せ・線あり）。
 * 名前の 13 は上のモックの実測だったが、iOS の実装は 12（`JPFont.caption`）
 */
export const STAT_LABEL_PX = 12;
/** 数（白・semibold・等幅数字・行の高さ 1） */
export const STAT_NUMBER_CLASS = "block font-semibold tabular-nums leading-none text-white";
/** 名前（text-3・数の下 2） */
export const STAT_LABEL_CLASS = "block text-text-3 mt-[2px] leading-none";
/** 1つの数の札（左寄せ・押せる高さ 44） */
export const STAT_CELL_CLASS = "flex-1 text-left";
/** 大きい数（旅の記録の距離など・iOS `JPTypeScale.figureLarge` 28） */
export const STAT_FIGURE_LARGE_PX = 28;
