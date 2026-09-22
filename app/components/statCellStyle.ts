/**
 * マイページの「数字の行」と「旅の実績」の文字の大きさ。
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
export const STAT_LABEL_PX = 13;
/** 数字の行の縦の区切り線の高さ。モックは行の高さいっぱいではなく、文字の塊ぶんだけ */
export const STAT_DIVIDER_PX = 28;
export const ACHIEVEMENT_VALUE_PX = 21;
export const ACHIEVEMENT_LABEL_PX = 14;
/** 旅の実績のアイコン（青）。モックでは2行ぶんの高さがある */
export const ACHIEVEMENT_ICON_PX = 28;
