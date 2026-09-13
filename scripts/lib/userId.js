/**
 * userId の形を見る規則（スクリプト側）。**`api-user/src/userId.ts` と同一。**
 *
 * ## 分けていた頃に何が起きたか（2026-09-13・本番の実測）
 *
 * 以前ここは版 1-5・variant 8-b まで見る**より厳しい**規則で、
 * `userIdParity.test.ts` は「スクリプトの方が厳しい」を安全側として
 * 記録していた（緩いと、API が弾く行を書き込んでしまうため）。
 *
 * 実際には安全ではなかった。`repair-follow-graph` のドライランが出した本番:
 *
 *     follow#… 2 行 / following#… 2 行 / followers#… 0 行
 *     有効なフォロー 2 件 / 壊れたマーカー 0 件
 *     規則のずれで保留したマーカー 2 件
 *
 * **本番のフォロー2件は本物**（読む側の `isUserId` を通り、画面にも出て
 * いた）。なのに埋め戻し（`backfill-followers.js`）だけが「Cognito の sub の
 * 形でないゴミ」として捨てていたので、**`followers#` が一度も作られなかった**
 * ——「フォロー一覧は観れるのにフォロワー一覧が見れない」の正体。
 *
 * 厳しい側が捨てたものは、**気づける**（件数と理由は出る）が**直せない**。
 * 出た理由は「Cognito の sub の形でない」で、それ自体が誤りだった。
 * 実データが「sub は必ずしも RFC 4122 v4 の形ではない」と示した以上、
 * **書く側が読む側より厳しい理由は無い。**
 *
 * ## だから1つにする
 *
 * 同一なので「スクリプトの方が緩い」（＝API が弾く行を書き込む）も
 * 起こらない。`scripts/__tests__/userIdParity.test.ts` が、
 * **`api-user/src/userId.ts` の正規表現そのものを読んで**一致を縛る
 * ——書き写しに戻ると落ちる。
 */

const fs = require("fs");
const path = require("path");

/** `api-user/src/userId.ts` の `isUserId` と同じ規則 */
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** その文字列が userId の形か */
const isUserId = (v) => typeof v === "string" && USER_ID_RE.test(v);

/**
 * `api-user/src/userId.ts` に書いてある正規表現を、ソースから読み出す。
 * **テスト専用**（本番の経路では使わない——Lambda のバンドルにこの
 * ファイルは入らないし、実行時にソースを読むのは筋が悪い）。
 *
 * @returns 正規表現リテラルの文字列（`/^…$/i`）。見つからなければ `null`
 */
function apiRuleSource() {
    const src = fs.readFileSync(path.resolve(__dirname, "../../api-user/src/userId.ts"), "utf8");
    return /return\s+(\/.+\/i?)\.test\(/.exec(src)?.[1] ?? null;
}

module.exports = { USER_ID_RE, isUserId, apiRuleSource };
