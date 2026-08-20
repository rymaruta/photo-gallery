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
export function pendingNameKey(email: string): string {
    return `jp_pending_name_${email.trim().toLowerCase()}`;
}
