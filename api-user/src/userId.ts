/**
 * Cognito の sub（UUID）の形かどうか。
 *
 * **ここを見ないと、任意の文字列を相手に見立てて行を作れる。**
 * `follow.ts` はこれを見ずにいた頃、でたらめなIDを投げるだけで
 * `follow#` マーカー・`followstats#`・`notifs#` の3つが作られた。
 * このテーブルは公開一覧（全表 Scan）やストーリーの掃除が端から端まで
 * 読むので、**ゴミが増えるほど全員の表示が遅くなる**。
 *
 * **1か所に置く。** `block.ts` も同じ判定が要る——写すと静かにずれる
 * （このリポジトリが `mediaHosts` や `cdnInvalidate` で何度も踏んだ形）。
 */
export function isUserId(v: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
