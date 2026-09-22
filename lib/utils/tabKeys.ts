/**
 * タブのキーボード操作（WAI-ARIA の tabs の作法）の**判断の部分だけ**。
 *
 * ## なぜ切り出すか
 *
 * `role="tablist"` を名乗った以上、矢印で動けないと壊れて見える
 * ——支援技術は「1/4」と読み上げるのに動かない。その処理が
 * `NotificationsBell`（通知のタブ4つ）と `SpotPageClient`（概要／写真／地図）に
 * **別々に書かれていた**。片方だけ直す事故が起きる形なので、**判断だけ**を
 * 純関数にして両方から呼ぶ。
 *
 * ## 判断だけ。DOM は呼ぶ側に残す
 *
 * `setState` と `document.getElementById(...)?.focus()`（roving tabindex は
 * 「選択中だけが停止点」なので、移さないと次の Tab が中身を飛ばす）は
 * **呼ぶ側の仕事**——タブの id の付け方も、状態の持ち方も画面ごとに違う。
 * ここに寄せると DOM を知る純関数になり、テストが書けなくなる。
 *
 * ## `e.preventDefault()` は「動いたときだけ」
 *
 * `null` が返った回（タブに関係ないキー）で止めてはいけない。止めると
 * `Tab` や文字入力まで飲む。呼ぶ側は `null` なら**何もせずに抜ける**。
 */

/**
 * 押されたキーから、移る先の位置を返す。関係ないキーなら `null`。
 *
 * @param key   `KeyboardEvent.key`
 * @param at    いま選ばれているタブの位置（`indexOf` の結果をそのまま渡してよい）
 * @param count タブの数
 *
 * 端では折り返す（`ArrowRight` で最後 → 先頭）。WAI-ARIA の tabs の作法で、
 * 元の2か所とも折り返していた。
 *
 * **範囲外の `at` は先頭として扱う。** `indexOf` が `-1` を返す
 * （状態がタブの一覧に無い）場合、元の `NotificationsBell` は
 * `ArrowLeft` で `-2` を作って `NOTIF_TABS[-2]` = `undefined` を
 * `setTab` に渡していた。実際には起きない筋（状態は必ず一覧の中）だが、
 * 共通部に寄せる以上、**範囲内の答えしか返さない**と決めておく。
 */
export function nextTabIndex(key: string, at: number, count: number): number | null {
    if (!Number.isInteger(count) || count <= 0) return null;
    const i = Number.isInteger(at) && at >= 0 && at < count ? at : 0;
    switch (key) {
        case "ArrowRight": return (i + 1) % count;
        case "ArrowLeft": return (i - 1 + count) % count;
        case "Home": return 0;
        case "End": return count - 1;
        default: return null;
    }
}
