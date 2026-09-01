import { CognitoUserPool, AuthenticationDetails, CognitoUser, CognitoUserSession, CognitoUserAttribute } from "amazon-cognito-identity-js";
import { cognitoConfig, ADMIN_GROUP_NAME, USER_GROUP_NAME } from "./config";
import { v4 as uuidv4 } from "uuid";
import { log } from "../utils/log";

// Cognito User Poolの初期化（遅延初期化）
function getUserPool(): CognitoUserPool {
    if (!cognitoConfig.userPoolId || !cognitoConfig.clientId) {
        throw new Error("Cognito User Pool ID and Client ID must be set. Please check your environment variables.");
    }

    return new CognitoUserPool({
        UserPoolId: cognitoConfig.userPoolId,
        ClientId: cognitoConfig.clientId,
    });
}

// ログイン
export async function signIn(username: string, password: string): Promise<{
    success: boolean;
    session?: CognitoUserSession;
    error?: string;
    groups?: string[];
    needsVerification?: boolean;
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
                    const groups = Array.isArray(payload["cognito:groups"]) ? payload["cognito:groups"] : [];
                    
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
                    
                    // **「そのメールアドレスは登録されている」を教えない。**
                    // `UserNotFoundException` に「ユーザーが見つかりません」と
                    // 答えると、ログイン画面が**アカウントの有無を確かめる道具**
                    // になる（総当たりでメールアドレスの一覧が作れる）。
                    // 正解不正解のどちらでも同じ文面にする——利用者にとっての
                    // 情報量はほぼ変わらない（打ち直すことに変わりはない）。
                    //
                    // 本来はプール側の `PreventUserExistenceErrors` で塞ぐ設定
                    // だが、**本番プールの現状はこの環境から確認できない**
                    // （AWS の資格情報が無い）。設定がどうであれ、画面が
                    // 教えないようにしておく。
                    if (err.code === "NotAuthorizedException" || err.code === "UserNotFoundException") {
                        errorMessage = "メールアドレスまたはパスワードが正しくありません";
                    } else if (err.code === "UserNotConfirmedException") {
                        resolve({ success: false, error: "メールアドレスの確認が完了していません", needsVerification: true });
                        return;
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
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    const groups = idToken.payload["cognito:groups"];
    return Array.isArray(groups) ? (groups as string[]) : [];
}

// 管理者かどうかをチェック
export async function isAdmin(): Promise<boolean> {
    const groups = await getCurrentUserGroups();
    return groups.includes(ADMIN_GROUP_NAME);
}

// 一般ユーザー（userグループ、adminは含まない）かどうかをチェック
export async function isGeneralUser(): Promise<boolean> {
    const groups = await getCurrentUserGroups();
    return groups.includes(USER_GROUP_NAME) && !groups.includes(ADMIN_GROUP_NAME);
}

// 認証されているかチェック
export async function isAuthenticated(): Promise<boolean> {
    const session = await getCurrentSession();
    return session !== null && session.isValid();
}

// パスワードリセットコードを送信
export async function forgotPassword(username: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
            cognitoUser.forgotPassword({
                onSuccess: () => resolve({ success: true }),
                onFailure: (err: { message?: string; code?: string }) => {
                    let msg = err.message || "エラーが発生しました";
                    // ここも同じ理由で「登録の有無」を教えない。
                    // 送信したかどうかは、届いたかどうかで分かる
                    if (err.code === "UserNotFoundException") {
                        resolve({ success: true });
                        return;
                    }
                    if (err.code === "LimitExceededException") msg = "しばらく時間をおいてから再試行してください";
                    resolve({ success: false, error: msg });
                },
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "エラーが発生しました" });
        }
    });
}

// パスワードリセットを確定
export async function confirmForgotPassword(
    username: string,
    code: string,
    newPassword: string
): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
            cognitoUser.confirmPassword(code, newPassword, {
                onSuccess: () => resolve({ success: true }),
                onFailure: (err: { message?: string; code?: string }) => {
                    let msg = err.message || "エラーが発生しました";
                    if (err.code === "CodeMismatchException") msg = "確認コードが正しくありません";
                    if (err.code === "ExpiredCodeException") msg = "確認コードの有効期限が切れています";
                    if (err.code === "InvalidPasswordException") msg = "パスワードは8文字以上で、英大文字・小文字・数字を含む必要があります";
                    resolve({ success: false, error: msg });
                },
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "エラーが発生しました" });
        }
    });
}

// 新規ユーザー登録
// このプールは AliasAttributes:email なので username は UUID、email は属性として渡す
export async function signUp(email: string, password: string): Promise<{
    success: boolean;
    username?: string;  // 確認コード送信に使うUUID
    error?: string;
    aliasExists?: boolean;
}> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const username = uuidv4();
            const attributes = [
                new CognitoUserAttribute({ Name: "email", Value: email }),
            ];
            userPool.signUp(username, password, attributes, [], (err) => {
                if (err) {
                    log.error("signUp error:", { name: err.name, message: err.message });
                    let msg = err.message || "登録に失敗しました";
                    if (err.name === "InvalidPasswordException") msg = "パスワードは8文字以上で、英大文字・小文字・数字・記号（!@#$%など）をそれぞれ1文字以上含める必要があります";
                    if (err.name === "InvalidParameterException") msg = `入力エラー: ${err.message}`;
                    if (err.name === "UsernameExistsException" || err.name === "AliasExistsException") {
                        resolve({ success: false, error: "このメールアドレスはすでに登録されています", aliasExists: true });
                        return;
                    }
                    resolve({ success: false, error: msg });
                    return;
                }
                resolve({ success: true, username });
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "登録処理中にエラーが発生しました" });
        }
    });
}

// メール確認コードで登録を確定（username は signUp が返した UUID）
export async function confirmSignUp(username: string, code: string): Promise<{
    success: boolean;
    error?: string;
}> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
            // 第2引数は forceAliasCreation。**false にすること。**
            //
            // true は「そのメールが既に他の人に紐づいていても、強制的に
            // こちらへ付け替える」という意味になる。踏み方:
            //   攻撃者が被害者のメールで新規登録する
            //   → 確認コードは**被害者の受信箱**に届く（攻撃者は読めない）
            //   → 被害者が「正規のコードだ」と思って渡してしまうと、
            //     true のせいでエラーにならず**メールが攻撃者のアカウントへ移り、
            //     被害者は自分のメールでログインできなくなる**（旧アカウントの
            //     写真も辿れなくなる）
            // false なら AliasExistsException で止まる。true にしている必然性は
            // 無い——「未確認のまま放置した自分の登録をやり直す」用途なら
            // false でも通る（その場合エイリアスはまだ誰にも付いていない）。
            cognitoUser.confirmRegistration(code, false, (err) => {
                if (err) {
                    // 「すでに確認済み」は成功として扱う。
                    // PostConfirmation トリガーが失敗すると ConfirmSignUp も
                    // 失敗するが、Cognito 側では既に確認が済んでいる。
                    // ここで失敗を返すと、コードを入れ直しても永久に
                    // 確認画面から出られなくなる（登録完了に進めない）。
                    if (err.name === "NotAuthorizedException") {
                        resolve({ success: true });
                        return;
                    }
                    let msg = err.message || "確認に失敗しました";
                    if (err.name === "CodeMismatchException") msg = "確認コードが正しくありません";
                    if (err.name === "ExpiredCodeException") msg = "確認コードの有効期限が切れています。再送してください";
                    // forceAliasCreation を false にしたので、そのメールが既に
                    // 他のアカウントで使われていると、ここで止まる（＝正しい）。
                    // 生の英語文言のままだと何が起きたのか分からないので置き換える。
                    // 進む先を必ず添える。ここに落ちる人の多くは「既に持って
                    // いるのを忘れて登録し直した本人」で、コードは自分の受信箱に
                    // 届いている。文言だけだと確認画面から出る道が無い
                    // （signUp 側の同じ状況には案内が付いている）。
                    if (err.name === "AliasExistsException") {
                        msg = "このメールアドレスはすでに別のアカウントで使われています。" +
                            "そのアカウントでログインするか、パスワードをお忘れの場合は再設定してください。";
                    }
                    resolve({ success: false, error: msg });
                    return;
                }
                resolve({ success: true });
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "確認処理中にエラーが発生しました" });
        }
    });
}

// 確認コードを再送（username は signUp が返した UUID）
export async function resendConfirmationCode(username: string): Promise<{
    success: boolean;
    error?: string;
}> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
            cognitoUser.resendConfirmationCode((err) => {
                if (err) {
                    let msg = err.message || "再送に失敗しました";
                    if (err.name === "LimitExceededException") msg = "送信回数の上限に達しました。しばらく時間をおいてから再試行してください";
                    resolve({ success: false, error: msg });
                    return;
                }
                resolve({ success: true });
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "再送処理中にエラーが発生しました" });
        }
    });
}

// Cognito アカウントを削除（退会）。現在ログイン中のユーザーが対象。
// deleteUser は有効なセッションが必要なため、先に getSession でトークンを整える。
export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = userPool.getCurrentUser();
            if (!cognitoUser) {
                resolve({ success: false, error: "ログインしていません" });
                return;
            }
            cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
                if (err || !session || !session.isValid()) {
                    resolve({ success: false, error: "セッションが無効です。再度ログインしてください" });
                    return;
                }
                cognitoUser.deleteUser((deleteErr) => {
                    if (deleteErr) {
                        log.error("deleteUser error:", deleteErr);
                        resolve({ success: false, error: deleteErr.message || "アカウント削除に失敗しました" });
                        return;
                    }
                    resolve({ success: true });
                });
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "アカウント削除中にエラーが発生しました" });
        }
    });
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
