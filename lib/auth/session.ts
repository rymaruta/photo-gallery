import { cognitoConfig } from "./config";
import type { SessionLookup } from "./cognito";

/**
 * **セッションを引くための薄い入口。SDK を読まずに済む回は読まない。**
 *
 * `amazon-cognito-identity-js` は SRP（BigInteger と SHA-256 の実装）を
 * 抱えていて大きい。実測（`npx next build` の出力を gzip して数えた）:
 *
 *     写真ページが読む JS   828KB → gzip 257KB
 *     うち 認証 SDK          95KB → gzip  28KB   ← **全ページ**
 *
 * しかも**それを読む相手のほとんどはログインしていない**——このサイトの
 * 主戦場は検索流入で、着地するのは写真の個別ページ（索引に載るページの
 * 約6割）。訪問者は SRP の実装を1バイトも要らない。
 *
 * 載っていた理由は、`lib/utils/api.ts` と `app/auth/context.tsx`（＝
 * ルートレイアウトにある）が `lib/auth/cognito.ts` を**静的に** import
 * していたこと。あちらは触らない——認証は台帳でいちばん傷の多い場所で、
 * 圏外の扱い・キャプティブポータルの見分けなど、実物のライブラリに通して
 * 測った判断がぎっしり書いてある。**中身は1行も変えずに、手前に置く。**
 *
 * **「読まなくてよい回」の見分けは、ライブラリ自身の置き場所で行う。**
 * `amazon-cognito-identity-js` はログインすると
 * `CognitoIdentityServiceProvider.<clientId>.LastAuthUser` を localStorage に
 * 書き、`getCurrentUser()` はその値が無ければ `null` を返す。
 * つまり**この鍵が無ければ、SDK を読み込んでも答えは
 * `{ session: null, unreachable: false }` で確定している**
 * （`lookupSession` の `if (!cognitoUser)` の枝）。
 * ログアウトも退会も `signOut()` がこの鍵を消すので、
 * 「消えたのに読み込んでしまう」側には倒れない。
 *
 * **迷ったら読み込む側に倒す。** `localStorage` が使えない端末
 * （プライベートモード・容量超過）では例外が飛ぶ——そこで「無い」と
 * 決めると**ログインしている人を未ログインとして扱う**ことになるので、
 * 読めなければ SDK を読み込んで本物に判断させる。
 */
function hasStoredSession(): boolean {
    try {
        if (typeof localStorage === "undefined") return true;   // サーバー側では判断しない
        if (!cognitoConfig.clientId) return true;               // 設定が無いなら本物に任せる
        const key = `CognitoIdentityServiceProvider.${cognitoConfig.clientId}.LastAuthUser`;
        return !!localStorage.getItem(key);
    } catch {
        // 読めない＝分からない。**分からないときは読み込む**
        return true;
    }
}

/** SDK を読み込まずに返せる答え（＝端末に何も残っていない） */
const SIGNED_OUT: SessionLookup = { session: null, unreachable: false };

/**
 * セッションを引く。`lib/auth/cognito.ts` の `lookupSession` と**同じ契約**。
 * 端末に何も残っていなければ SDK を読み込まずに「ログインしていない」を返す。
 */
export async function lookupSession(): Promise<SessionLookup> {
    if (!hasStoredSession()) return SIGNED_OUT;
    const { lookupSession: real } = await import("./cognito");
    return real();
}

/** 理由を捨てる版（既存の呼び出しに合わせる。新しい呼び出しは `lookupSession` を使う） */
export async function getCurrentSession() {
    return (await lookupSession()).session;
}
