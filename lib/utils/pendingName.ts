/**
 * 新規登録で入力した表示名を、確認〜初回ログインまで端末に控えておくためのキー。
 *
 * なぜメールアドレスで区切るか:
 *   以前は `jp_pending_displayName` という端末で1つのキーだった。
 *   登録を途中でやめた人の表示名がそのまま残り、次にその端末でログインした
 *   **別人**のプロフィールに付いていた（共有のiPadなど）。付けられた本人には
 *   どこから来た名前なのか分からない。
 *
 * なぜ小文字に揃えるか:
 *   Cognito のメールエイリアスは大文字小文字を区別しないので、
 *   「Taro@Example.com で登録 → taro@example.com でログイン」が成立する。
 *   生の入力をキーにすると、その場合だけ控えた名前が拾えず黙って消える。
 */
function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function pendingNameKey(email: string): string {
    return `jp_pending_name_${normalizeEmail(email)}`;
}

/**
 * 確認コードの再送に必要な「控えたユーザー名（UUID）」のキー。
 *
 * 上と同じ理由で同じ正規化を使う。揃っていなかった頃はこうなった:
 *   `Taro@Example.com` で登録 → 確認前にタブを閉じる
 *   → `taro@example.com` でログイン → UserNotConfirmedException
 *   → `/signup?email=taro%40example.com` に飛ぶ
 *   → 控えたユーザー名が**別のキーの下にあって拾えない**
 *   → 再登録すると aliasExists で「すでに登録されています」＝行き止まり。
 * 再送に必要な UUID は端末にあるのに、誰も読まない場所に置かれていた。
 */
export function pendingVerifyKey(email: string): string {
    return `jp_verify_${normalizeEmail(email)}`;
}
