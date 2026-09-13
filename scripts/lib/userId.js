/**
 * userId の形を見る規則（スクリプト側）。**2つある。**
 *
 *   apiAccepts  … `api-user/src/userId.ts` の `isUserId` と同じ。素の16進。
 *                 **API が実際に受け付けた／読む側が実際に通す**のはこちら。
 *   STRICT_RE   … 版 1-5・variant 8-b まで見る。書き込む側（埋め戻し・修復）は
 *                 こちらで絞る。`scripts/__tests__/userIdParity.test.ts` が
 *                 「スクリプトが通すものは API も必ず通す」を縛っている。
 *
 * **なぜ分けるか。** 厳しい側だけを持っていると、捨てた行が
 *
 *   (a) API も弾く形（本物のゴミ）
 *   (b) API は通すのにスクリプトだけが弾く形（**規則のずれ**）
 *
 * のどちらなのか**外から区別できない**。本番のドライランが
 * 「マーカー 2 件 / 対象 0 人・捨てた 2 件」を出したとき、まさにそれが
 * 読めなかった——(b) なら**本物のフォローを埋め戻していない**ことになり、
 * 「フォロワー一覧だけ空」の直接の原因になる。台帳の型
 * 「道具が『0件』と言うとき、数え方を疑う」。
 *
 * 規則そのものは変えない（緩めると、API が弾く行を書き込む側に倒れる）。
 * **理由を分けて数えられるようにするだけ。**
 */

/** `api-user/src/userId.ts` の `isUserId` と同じ規則（素の16進） */
const API_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 書き込む側が使う、より厳しい規則（版 1-5・variant 8-b） */
const STRICT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** API（読む側）が通すか */
const apiAccepts = (v) => typeof v === "string" && API_RE.test(v);

/** スクリプト（書く側）が通すか */
const strictAccepts = (v) => typeof v === "string" && STRICT_RE.test(v);

/**
 * 捨てる理由を分ける。**通るなら `null`。**
 *
 * @returns `null`（通す）／`"api-rejects"`（本物のゴミ）／
 *   `"rule-drift"`（API は通すのにスクリプトが弾いた＝規則のずれ）
 */
function rejectReason(v) {
    if (strictAccepts(v)) return null;
    return apiAccepts(v) ? "rule-drift" : "api-rejects";
}

module.exports = { API_RE, STRICT_RE, apiAccepts, strictAccepts, rejectReason };
