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
