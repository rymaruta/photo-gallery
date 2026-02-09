import { CognitoUserPool, AuthenticationDetails, CognitoUser, CognitoUserSession } from "amazon-cognito-identity-js";
import { cognitoConfig, ADMIN_GROUP_NAME } from "./config";
import { log } from "../utils/log";

// Cognito User Poolの初期化（遅延初期化）
function getUserPool(): CognitoUserPool {
    if (!cognitoConfig.userPoolId || !cognitoConfig.clientId) {
        throw new Error("Cognito User Pool ID and Client ID must be set. Please check your environment variables.");
    }

    const poolConfig: {
        UserPoolId: string;
        ClientId: string;
        ClientSecret?: string;
    } = {
        UserPoolId: cognitoConfig.userPoolId,
        ClientId: cognitoConfig.clientId,
    };

    // シークレットが設定されている場合のみ追加
    // ⚠️ 注意: シークレットありのクライアントを使用する場合は、CognitoUserPoolが自動的にSECRET_HASHを計算します
    if (cognitoConfig.clientSecret) {
        poolConfig.ClientSecret = cognitoConfig.clientSecret;
    }

    return new CognitoUserPool(poolConfig);
}

// ログイン
export async function signIn(username: string, password: string): Promise<{
    success: boolean;
    session?: CognitoUserSession;
    error?: string;
    groups?: string[];
}> {
    return new Promise((resolve) => {
        try {
            // 環境変数の確認
            if (!cognitoConfig.userPoolId || !cognitoConfig.clientId) {
                log.error("Cognito設定エラー:", {
                    hasUserPoolId: !!cognitoConfig.userPoolId,
                    hasClientId: !!cognitoConfig.clientId,
                });
                resolve({
                    success: false,
                    error: "Cognitoの設定が正しくありません。環境変数を確認してください。",
                });
                return;
            }

            const authenticationDetails = new AuthenticationDetails({
                Username: username,
                Password: password,
            });

            const userPool = getUserPool();
            const cognitoUser = new CognitoUser({
                Username: username,
                Pool: userPool,
            });

            cognitoUser.authenticateUser(authenticationDetails, {
                onSuccess: (session) => {
                    log.debug("認証成功");
                    // ユーザーグループを取得
                    const idToken = session.getIdToken();
                    const payload = idToken.payload;
                    const groups = payload["cognito:groups"] || [];
                    
                    // デバッグ情報を詳細に出力（開発環境のみ）
                    log.debug("IDトークンのペイロード:", {
                        groups: groups,
                        allPayload: payload,
                        username: payload["cognito:username"],
                        email: payload["email"],
                    });
                    log.debug("ユーザーグループ:", groups);
                    log.debug("管理者グループ名:", ADMIN_GROUP_NAME);
                    log.debug("管理者かどうか:", groups.includes(ADMIN_GROUP_NAME));

                    resolve({
                        success: true,
                        session,
                        groups: groups as string[],
                    });
                },
                onFailure: (err) => {
                    log.error("認証失敗:", err);
                    // エラーメッセージを日本語化
                    let errorMessage = err.message || "ログインに失敗しました";
                    
                    if (err.code === "NotAuthorizedException") {
                        errorMessage = "メールアドレスまたはパスワードが正しくありません";
                    } else if (err.code === "UserNotFoundException") {
                        errorMessage = "ユーザーが見つかりません";
                    } else if (err.code === "InvalidParameterException") {
                        errorMessage = "入力内容に誤りがあります";
                    } else if (err.message?.includes("SECRET_HASH")) {
                        errorMessage = "認証設定エラー: アプリクライアントのシークレット設定を確認してください";
                    }

                    resolve({
                        success: false,
                        error: errorMessage,
                    });
                },
                newPasswordRequired: (_userAttributes, _requiredAttributes) => {
                    log.info("新しいパスワードが必要");
                    resolve({
                        success: false,
                        error: "初回ログイン時はパスワードの変更が必要です。AWSコンソールからパスワードを変更してください。",
                    });
                },
            });
        } catch (error: unknown) {
            log.error("認証処理エラー:", error);
            const errorMessage = error instanceof Error ? error.message : "ログイン処理中にエラーが発生しました";
            resolve({
                success: false,
                error: errorMessage,
            });
        }
    });
}

// ログアウト
export function signOut(): void {
    try {
        const userPool = getUserPool();
        const cognitoUser = userPool.getCurrentUser();
        if (cognitoUser) {
            cognitoUser.signOut();
        }
    } catch (error) {
        // 環境変数が設定されていない場合は何もしない
        log.warn("Failed to sign out:", error);
    }
}

// 現在のセッションを取得
export async function getCurrentSession(): Promise<CognitoUserSession | null> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = userPool.getCurrentUser();

            if (!cognitoUser) {
                        log.debug("[getCurrentSession] cognitoUserが見つかりません");
                resolve(null);
                return;
            }

            cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
                if (err) {
                            log.error("[getCurrentSession] セッション取得エラー:", err.message);
                    resolve(null);
                    return;
                }
                
                if (!session) {
                            log.debug("[getCurrentSession] セッションがnullです");
                    resolve(null);
                    return;
                }
                
                if (!session.isValid()) {
                            log.debug("[getCurrentSession] セッションが無効です");
                    resolve(null);
                    return;
                }

                resolve(session);
            });
        } catch (error) {
            // 環境変数が設定されていない場合はnullを返す
            log.error("[getCurrentSession] 例外が発生しました:", error instanceof Error ? error.message : String(error));
            resolve(null);
        }
    });
}

// 現在のユーザーのグループを取得
export async function getCurrentUserGroups(): Promise<string[]> {
    const session = await getCurrentSession();
    if (!session) {
        return [];
    }

    const idToken = session.getIdToken();
    const groups = idToken.payload["cognito:groups"] || [];
    return groups as string[];
}

// 管理者かどうかをチェック
export async function isAdmin(): Promise<boolean> {
    const groups = await getCurrentUserGroups();
    return groups.includes(ADMIN_GROUP_NAME);
}

// 認証されているかチェック
export async function isAuthenticated(): Promise<boolean> {
    const session = await getCurrentSession();
    return session !== null && session.isValid();
}

// IDトークンを取得（JWT文字列として）
export async function getIdToken(): Promise<string | null> {
    const session = await getCurrentSession();
    if (!session || !session.isValid()) {
        return null;
    }
    const idToken = session.getIdToken();
    return idToken.getJwtToken();
}
