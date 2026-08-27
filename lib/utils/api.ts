// lib/utils/api.ts
// API リクエストユーティリティ
// NEXT_PUBLIC_API_BASE_URL が設定されている場合は Lambda、未設定の場合はローカル API Routes を使用

import { getCurrentSession } from "../auth/cognito";

function getBaseUrl(): string {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const useLocalApi = process.env.NEXT_PUBLIC_USE_LOCAL_API === "true";

    if (apiBaseUrl && !useLocalApi) {
        return apiBaseUrl.replace(/\/$/, "");
    }
    return "/api";
}

function getUserApiBaseUrl(): string {
    // ローカルAPIを使う指定は管理APIと同じく効かせる。
    // 以前はここだけ見ていなかったので、NEXT_PUBLIC_USE_LOCAL_API=true でも
    // userFetch だけが .env.local に残っている本番のユーザーAPIを叩いていた。
    // ストーリー投稿・プロフィール更新・**退会**まで本番に飛ぶ。
    if (process.env.NEXT_PUBLIC_USE_LOCAL_API === "true") return "/api";
    const userApiBaseUrl = process.env.NEXT_PUBLIC_USER_API_BASE_URL;
    if (userApiBaseUrl) {
        return userApiBaseUrl.replace(/\/$/, "");
    }
    // フォールバック: 管理者APIと同じ（ローカル開発用）
    return getBaseUrl();
}

/**
 * 認証不要のリクエスト（写真一覧取得など）
 */
export async function publicFetch(path: string, options?: RequestInit): Promise<Response> {
    const base = getBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    return fetch(url, options);
}

/**
 * Cognito JWT トークン付きのリクエスト（アップロード・削除など管理者操作）
 */
export async function authenticatedFetch(path: string, options?: RequestInit): Promise<Response> {
    const base = getBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

    // Cognito セッションから JWT トークンを取得
    const session = await getCurrentSession();
    const token = session?.getIdToken()?.getJwtToken();

    if (!token) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
    }

    return fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
    });
}

/**
 * 一般ユーザーAPI向け認証付きリクエスト（アップロードのみ）
 */
export async function userFetch(path: string, options?: RequestInit): Promise<Response> {
    const base = getUserApiBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

    const session = await getCurrentSession();
    const token = session?.getIdToken()?.getJwtToken();

    if (!token) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
    }

    return fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
    });
}

/**
 * 一般ユーザーAPI向けの認証不要リクエスト（ユーザー検索・公開プロフィールなど）。
 *
 * publicFetch は管理APIを向いているため、ユーザーAPI にしか無いエンドポイントは
 * こちらを使う（間違えると 404 になり、その失敗は握り潰されて表示が空になる）。
 */
export async function userPublicFetch(path: string, options?: RequestInit): Promise<Response> {
    const base = getUserApiBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    return fetch(url, options);
}

/**
 * API のエラー応答から、利用者に見せる一文を取り出す。
 *
 * このAPIは日本語の理由を `{ error: "..." }` で返す
 * （例: 「アップロード上限（100枚）に達しています」「そのユーザー名は既に使われています」）。
 * ところが呼び出し側の多くは本文を捨てて「保存に失敗しました」とだけ出すか、
 * 生のJSONを80文字で切って出していた。前者は原因が分からず何度も同じ操作を
 * 繰り返すことになり、後者はクラッシュログのように見える。
 *
 * 読めなければ渡された既定文に落とす。
 */
/**
 * トークンが取れないときに userFetch / userPublicFetch が投げるエラーの文言。
 * 呼び出し側の catch はこれと比較して「通信の失敗」と「未ログイン」を
 * 見分ける（文字列の重複比較を散らばらせない）。
 */
export const AUTH_REQUIRED_MESSAGE = "認証が必要です。ログインしてください。";

/** 期限切れトークンで API Gateway が返す 401 定型に対する置き換え文言 */
export const SESSION_EXPIRED_MESSAGE = "セッションの有効期限が切れています。ログインし直してください";

/**
 * 「消そうとしたものが既に無い」＝目的は達成、と読める 404 か。
 *
 * **サーバーが返した 404 だけ**を成功として扱う。ベースURLの設定ミスで
 * API Gateway が返す 404（ルートが無い）まで飲むと、削除できていないのに
 * 「削除しました」と出る——このファイルの getUserApiBaseUrl のコメントが
 * 警告している踏み方そのもの。うちの API は理由を必ず日本語の
 * `{ error: ... }` で返す（api-user/src/http.ts の jsonError）ので、
 * それを目印にする。API Gateway は `{ message: "Not Found" }`。
 */
export async function isGoneResponse(res: Response): Promise<boolean> {
    if (res.status !== 404) return false;
    try {
        const data = await res.clone().json() as { error?: unknown };
        return typeof data.error === "string" && data.error.length > 0;
    } catch {
        return false;   // JSON でない＝うちの API の応答ではない
    }
}

export async function readApiError(res: Response, fallback: string): Promise<string> {
    let msg = "";
    try {
        const data = await res.json() as { error?: unknown; message?: unknown };
        msg = typeof data.error === "string" ? data.error
            : typeof data.message === "string" ? data.message
                : "";
    } catch { /* JSON でなければ既定文 */ }
    // API Gateway の JWT オーソライザは期限切れトークンに
    // {"message":"Unauthorized"} を返す。英語の定型を生で出さず、
    // 何が起きたか（再ログインで直る）が伝わる文言に置き換える。
    // 自前の API が返す日本語の error（「認証が必要です」等）はそのまま通す。
    if (res.status === 401 && (!msg || msg === "Unauthorized")) return SESSION_EXPIRED_MESSAGE;
    return msg || fallback;
}
