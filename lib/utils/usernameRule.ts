/**
 * **@ユーザー名の長さ。画面が送る前に確かめるぶんだけ。**
 *
 * 正は `api-user/src/userProfile.ts` の `USERNAME_RE`（`/^[a-z0-9_]{3,20}$/`）。
 * 画面からは import できないので数字だけこちらに置き、
 * **`scripts/__tests__/limitParity.test.ts` が正規表現と突き合わせる**
 * （片方だけ変えたら落ちる）。
 *
 * 直した形: 画面は `maxLength={20}` で**上限だけ**縛り、**下限3文字は
 * 一切見ていなかった**。`ab` と入れて保存すると、サーバーが
 * **書き込みの前に** 400 を返す（`userProfile.ts:522`）ので、
 * **同じ保存に乗せた自己紹介・表示名・テーマ色も1件も保存されない**。
 * 押せるのに必ず失敗する形だった。
 *
 * ⚠️ **予約語（`RESERVED_USERNAMES`）は写さない。** あれは
 * サーバーだけが持つ一覧で、こちらに置くと**静かに古くなる2つ目の表**に
 * なる（別名表を私が毎回直す形は一度断られている）。予約語は今までどおり
 * サーバーが断り、その文言をそのまま出す。
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * 長さが規則から外れていれば、サーバーと**同じ文言**を返す（無ければ null）。
 * 空は「@名を消す」なので通す（サーバーも `normalizeUsername` で通す）。
 */
export function usernameLengthError(raw: string, isJa: boolean): string | null {
    const u = (raw ?? "").trim().toLowerCase().replace(/^@+/, "");
    if (!u) return null;
    if (u.length >= USERNAME_MIN && u.length <= USERNAME_MAX) return null;
    return isJa
        ? `ユーザー名は英小文字・数字・_ の${USERNAME_MIN}〜${USERNAME_MAX}文字で入力してください`
        : `Username must be ${USERNAME_MIN}-${USERNAME_MAX} lowercase letters, numbers or _`;
}
