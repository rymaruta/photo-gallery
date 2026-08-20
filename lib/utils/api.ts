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
        throw new Error("認証が必要です。ログインしてください。");
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
        throw new Error("認証が必要です。ログインしてください。");
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
export async function readApiError(res: Response, fallback: string): Promise<string> {
    try {
        const data = await res.json() as { error?: unknown; message?: unknown };
        const msg = typeof data.error === "string" ? data.error
            : typeof data.message === "string" ? data.message
                : "";
        if (msg) return msg;
    } catch { /* JSON でなければ既定文 */ }
    return fallback;
}
