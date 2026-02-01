/**
 * API呼び出し用ヘルパー関数
 * Cognito JWT認証に対応
 */

import { getIdToken } from "../auth/cognito";
import { log } from "./log";

/**
 * APIベースURLを取得
 * NEXT_PUBLIC_API_BASE_URLが設定されている場合はそれを使用
 * 未設定の場合は相対パス（/api）を使用（ローカル開発用）
 * 
 * 注意: 静的エクスポート（output: "export"）では、この関数はクライアントサイドでのみ実行されます
 * 
 * ローカル開発環境では、NEXT_PUBLIC_USE_LOCAL_API=trueを設定することで、
 * NEXT_PUBLIC_API_BASE_URLが設定されていてもローカルAPI（/api）を優先できます
 */
function getApiBaseUrl(): string {
    // 静的エクスポートではサーバーサイドは存在しないため、常にクライアントサイドとして扱う
    
    // ローカルAPIを強制的に使用するフラグが設定されている場合
    if (process.env.NEXT_PUBLIC_USE_LOCAL_API === "true") {
        return "/api";
    }
    
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (apiBaseUrl) {
        return apiBaseUrl;
    }
    
    // デフォルトは相対パス（ローカル開発用、ただし静的エクスポートでは動作しない）
    return "/api";
}

/**
 * 認証が必要なAPIリクエストを送信
 * - NEXT_PUBLIC_API_BASE_URL あり: Lambda → JWT (Authorization: Bearer)
 * - なし: ローカル app/api → x-api-key（NEXT_PUBLIC_UPLOAD_API_KEY を .env.local に設定）
 * 
 * ⚠️ セキュリティ警告: NEXT_PUBLIC_UPLOAD_API_KEYはクライアントサイドに公開されます
 * このプロジェクトは静的エクスポート（output: "export"）を使用しているため、すべてのコードがクライアントサイドで実行されます
 * そのため、NEXT_PUBLIC_プレフィックスがついた環境変数はクライアントサイドに公開されます
 * 本番環境では、NEXT_PUBLIC_API_BASE_URLを設定してJWT認証を使用してください
 * ローカル開発環境でのみ、NEXT_PUBLIC_UPLOAD_API_KEYを使用することを推奨します
 */
export async function authenticatedFetch(
    url: string,
    options: RequestInit = {}
): Promise<Response> {
    const apiBaseUrl = getApiBaseUrl();
    const fullUrl = url.startsWith("http") ? url : `${apiBaseUrl}${url}`;
    // ローカルAPIを使用する場合は、NEXT_PUBLIC_USE_LOCAL_API=trueまたはNEXT_PUBLIC_API_BASE_URLが未設定の場合
    const isLambda = !!process.env.NEXT_PUBLIC_API_BASE_URL && process.env.NEXT_PUBLIC_USE_LOCAL_API !== "true";

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };

    if (isLambda) {
        const idToken = await getIdToken();
        if (!idToken) {
            // JWTトークンが取得できない場合は、デバッグ情報を出力してからエラーを投げる
            log.error("[authenticatedFetch] JWTトークンが取得できませんでした:", {
                userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
                clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
                hasUserPoolId: !!process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
                hasClientId: !!process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
            });
            
            // ブラウザのlocalStorageを確認（デバッグ用）
            if (typeof window !== "undefined") {
                const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
                if (clientId) {
                    const lastAuthUser = localStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.LastAuthUser`);
                    log.debug("[authenticatedFetch] localStorage確認:", {
                        lastAuthUser,
                        hasLastAuthUser: !!lastAuthUser,
                        cognitoKeys: Object.keys(localStorage).filter(key => key.includes("CognitoIdentityServiceProvider")),
                    });
                }
            }
            
            // JWTトークンが取得できない場合は、エラーを投げる
            // これにより、認証されていない状態でLambda APIにリクエストを送信することを防ぐ
            throw new Error(
                "認証が必要です。ログインしてから再度お試しください。\n" +
                "Lambda APIを使用する場合は、Cognitoでログインし、adminグループに属している必要があります。"
            );
        }
        headers["Authorization"] = `Bearer ${idToken}`;
    } else {
        // ⚠️ ローカル開発環境でのみ使用（本番環境では使用しない）
        const apiKey = process.env.NEXT_PUBLIC_UPLOAD_API_KEY || "";
        if (apiKey) {
            headers["x-api-key"] = apiKey;
        } else {
            // ローカルAPIを使用する場合、APIキーが設定されていない場合は警告を出す
            log.warn(
                "⚠️ NEXT_PUBLIC_UPLOAD_API_KEYが設定されていません。\n" +
                "ローカルAPIを使用する場合は、.env.localにNEXT_PUBLIC_UPLOAD_API_KEYを設定してください。\n" +
                "または、NEXT_PUBLIC_API_BASE_URLをコメントアウトしてLambda APIを使用してください。"
            );
        }
    }

    return fetch(fullUrl, {
        ...options,
        headers,
    });
}

/**
 * 公開APIリクエストを送信（認証不要）
 */
export async function publicFetch(
    url: string,
    options: RequestInit = {}
): Promise<Response> {
    const apiBaseUrl = getApiBaseUrl();
    const fullUrl = url.startsWith("http") ? url : `${apiBaseUrl}${url}`;
    
    // ヘッダーを設定
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };
    
    // リクエストを送信
    return fetch(fullUrl, {
        ...options,
        headers,
    });
}
