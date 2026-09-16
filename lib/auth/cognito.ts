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
                    // **生の英語を既定にしない。** ここに落ちる例外（`PasswordResetRequiredException`
                    // など）は英語のまま画面に出て、しかも進む先が書いていない
                    let errorMessage = "ログインに失敗しました。しばらくしてからもう一度お試しください";
                    
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
                    } else if (err.code === "PasswordResetRequiredException") {
                        // 管理者がパスワードをリセットした状態。**進む先を言う**
                        // ——以前は英語の "Password reset required for the user."
                        // が出るだけで、画面のどこへ行けばよいか分からなかった
                        errorMessage = "パスワードの再設定が必要です。「パスワードをお忘れですか？」から再設定してください";
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

/**
 * セッションを引いた結果。
 *
 * **「ログインしていない」と「確かめられなかった」を分ける。**
 * 前は両方 `null` に潰していたので、電波の悪い場所で画面を移ると
 * `isAuthenticated` が false になり、`useMemberGate` が `/login` へ
 * 追い出していた——**トークンは端末に残っているのに**、編集中の文章ごと
 * 画面が入れ替わる。電波が戻れば何もせず直るので、本人には理由が分からない。
 *
 * 見分けは**ライブラリが付ける印**で行う。`amazon-cognito-identity-js` は
 * `fetch` が `TypeError` で落ちた回を `Error("Network error")` に包み直し、
 * `err.code = "NetworkError"` を立てる（`lib/Client.js` の
 * `} else if (err instanceof Error && err.message === 'Network error')`）。
 * 失効は `NotAuthorizedException` として別に来る。
 */
export type SessionLookup = {
    session: CognitoUserSession | null;
    /** セッションの有無を確かめられなかった（通信が届かない）。`session` は必ず null */
    unreachable: boolean;
};

/**
 * セッションの有無を確かめられなかった回か。
 *
 * 2つある。どちらも**実物のライブラリに通して形を測って**決めた
 * （`getSession` に届く err を印字した。推測ではない）:
 *
 * 1. **通信そのものが落ちた**（機内モード）——ライブラリが `fetch` の
 *    `TypeError` を `Error("Network error")` に包み `code = "NetworkError"`
 *    を立てる
 * 2. **返ってきたのが Cognito の応答ではなかった**——ホテルや空港の
 *    キャプティブポータル（200 で HTML）、中継機のエラーページ（503 で
 *    HTML）。ライブラリは本文を JSON として読めず `{}` にしたあと、
 *    `data.__type` や `RefreshToken` を触って **`TypeError`** で落ちる:
 *      200+HTML → `Cannot convert undefined or null to object`
 *      503+HTML → `Cannot read properties of undefined (reading 'split')`
 *    **外出先で一番多いのはこちら**（繋がってはいるが通らない）。
 *
 * 逆に、**本当にログインしていない側は必ず素の `Error`** で来る（測定）:
 *   失効           → `code = "NotAuthorizedException"`
 *   サーバーの5xx  → `code = "InternalErrorException"`（理由を名乗っている）
 *   トークン欠損   → `Error("Local storage is missing an ID Token, …")`
 *   更新できない   → `Error("Cannot retrieve a new session. …")`
 * なので `TypeError` かどうかで分けられる。**理由を名乗っている応答は
 * 保たない**——名乗っているならそれは答えなので。
 */
function isUnreachable(err: unknown): boolean {
    const e = err as { code?: unknown; message?: unknown } | null;
    if (e?.code === "NetworkError" || e?.message === "Network error") return true;
    return err instanceof TypeError;
}

// 現在のセッションを取得（理由は捨てる。**新しい呼び出しでは `lookupSession` を使う**）
export async function getCurrentSession(): Promise<CognitoUserSession | null> {
    return (await lookupSession()).session;
}

export async function lookupSession(): Promise<SessionLookup> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = userPool.getCurrentUser();

            if (!cognitoUser) {
                        log.debug("[lookupSession] cognitoUserが見つかりません");
                resolve({ session: null, unreachable: false });
                return;
            }

            cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
                if (err) {
                            log.error("[lookupSession] セッション取得エラー:", err.message);
                    resolve({ session: null, unreachable: isUnreachable(err) });
                    return;
                }
                
                if (!session) {
                            log.debug("[lookupSession] セッションがnullです");
                    resolve({ session: null, unreachable: false });
                    return;
                }
                
                if (!session.isValid()) {
                            log.debug("[lookupSession] セッションが無効です");
                    resolve({ session: null, unreachable: false });
                    return;
                }

                resolve({ session, unreachable: false });
            });
        } catch (error) {
            // 環境変数が設定されていない場合はnullを返す
            log.error("[lookupSession] 例外が発生しました:", error instanceof Error ? error.message : String(error));
            // 設定が無い等。**通信の問題ではない**ので保たない
            resolve({ session: null, unreachable: false });
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
                    let msg = "エラーが発生しました。しばらくしてからもう一度お試しください";
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
                    let msg = "エラーが発生しました。しばらくしてからもう一度お試しください";
                    if (err.code === "CodeMismatchException") msg = "確認コードが正しくありません";
                    if (err.code === "ExpiredCodeException") msg = "確認コードの有効期限が切れています";
                    if (err.code === "InvalidPasswordException") msg = PASSWORD_RULE_MESSAGE;
                    resolve({ success: false, error: msg });
                },
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "エラーが発生しました" });
        }
    });
}

/**
 * パスワードの規則。**画面とサーバーで食い違わせない。**
 *
 * `scripts/provision-env.js` のプールは
 * `{MinimumLength: 8, RequireUppercase, RequireLowercase, RequireNumbers, RequireSymbols}`。
 * ところがパスワード再設定の `InvalidPasswordException` だけ**記号が
 * 抜けていた**——`Password1` を入れると弾かれるのに、エラーは
 * 「英大文字・小文字・数字」と言うので条件は満たしているように読め、
 * 同じものを打ち直して抜けられない。しかも真上のプレースホルダ
 * （「8文字以上、英大・小文字・数字・記号を含む」）と矛盾していた。
 */
export const PASSWORD_RULE_MESSAGE =
    "パスワードは8文字以上で、英大文字・小文字・数字・記号（!@#$%など）をそれぞれ1文字以上含める必要があります";

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
                // **前後の空白を落とす。** スマホのキーボードは補完のあとに
                // 空白を1つ付けることがあり、そのまま登録すると確認コードは
                // 届くのに**ログインで打ち直したメールと一致しない**。
                // 大文字小文字はここでは触らない——このプールの
                // `UsernameConfiguration` はリポジトリのどこでも指定して
                // おらず、揃え方を間違えると**既にあるアカウントで
                // ログインできなくなる**（本番プールの設定は未確認）
                new CognitoUserAttribute({ Name: "email", Value: email.trim() }),
            ];
            userPool.signUp(username, password, attributes, [], (err) => {
                if (err) {
                    log.error("signUp error:", { name: err.name, message: err.message });
                    let msg = "登録に失敗しました。しばらくしてからもう一度お試しください";
                    if (err.name === "InvalidPasswordException") msg = PASSWORD_RULE_MESSAGE;
                    // **AWS の英文をそのまま出さない。** `InvalidParameterException` の
                    // `message` は "1 validation error detected: Value at 'password'
                    // failed to satisfy constraint: Member must satisfy regular
                    // expression pattern: ..." のような正規表現つきの英文で、
                    // 読んでも直し方が分からない。実際にここへ落ちるのは
                    // パスワードかメールの形なので、その2つを言う
                    if (err.name === "InvalidParameterException") {
                        msg = `メールアドレスの形式か、${PASSWORD_RULE_MESSAGE}`;
                    }
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
                    let msg = "確認に失敗しました。しばらくしてからもう一度お試しください";
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
    /**
     * 例外の名前。**「一時的な失敗」と「この控えはもう使えない」を
     * 呼び出し側が見分けるために返す。**
     *
     * 見分けずに「失敗したら控えを捨てる」にしたら、`LimitExceededException`
     * （再送の回数制限）や通信断でも唯一の手がかり（UUID）を捨てるようになり、
     * **確認画面に二度と戻れなくなった**（登録し直しても
     * 「すでに登録されています」で終わり、未確認なのでパスワード再設定も
     * 効かない）。24時間で TTL が切れて自然に回復する元の形より悪い。
     */
    code?: string;
}> {
    return new Promise((resolve) => {
        try {
            const userPool = getUserPool();
            const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
            cognitoUser.resendConfirmationCode((err) => {
                if (err) {
                    let msg = "再送に失敗しました。しばらくしてからもう一度お試しください";
                    if (err.name === "LimitExceededException") msg = "送信回数の上限に達しました。しばらく時間をおいてから再試行してください";
                    resolve({ success: false, error: msg, code: err.name });
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
/**
 * **ログイン中に自分のパスワードを変える。**
 *
 * これが無かった間、変える手段は「ログアウト → `/login` →
 * パスワードをお忘れですか → メールのコード」**だけ**だった
 * ——漏洩を疑ったその場で替えられず、しかも「忘れた」を装う必要があった。
 * `forgotPassword` は**メールが届く人**にしか効かないので、
 * メールを受け取れなくなった人には出口が無い（そちらは別枠）。
 *
 * 形は `deleteAccount` に揃える（同じ「セッションが要る操作」なので、
 * 取り方と失敗の返し方を割らない）。
 *
 * **返す文言は利用者が次に何をすればいいか分かるものにする。** Cognito の
 * 素のメッセージは英語で、`InvalidPasswordException` は規則を
 * 部分的にしか言わない（`PASSWORD_RULE_MESSAGE` のコメントを見よ）。
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
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
                    // **通信断を「セッション切れ」と言わない**（圏外でログインし直せと
                    // 言う形。台帳の NET-MSG と同じ判断）
                    if (isUnreachable(err)) {
                        resolve({ success: false, error: "ネットワークにつながりません。接続を確認してもう一度お試しください" });
                        return;
                    }
                    resolve({ success: false, error: "セッションが無効です。再度ログインしてください" });
                    return;
                }
                cognitoUser.changePassword(oldPassword, newPassword, (changeErr) => {
                    if (changeErr) {
                        const name = (changeErr as { code?: string; name?: string }).code
                            ?? (changeErr as { name?: string }).name ?? "";
                        log.warn("changePassword error:", name);
                        resolve({ success: false, error: changePasswordErrorMessage(name, changeErr) });
                        return;
                    }
                    resolve({ success: true });
                });
            });
        } catch (e) {
            resolve({ success: false, error: e instanceof Error ? e.message : "パスワードの変更中にエラーが発生しました" });
        }
    });
}

/**
 * `changePassword` の失敗を、利用者が次の一手を決められる日本語にする
 * （**純関数**。Cognito を呼ばずに直接見られる）。
 *
 * 知らない種別は素のメッセージに落とす——**握って既定文にすると、
 * 本当の理由が画面にもログにも出なくなる**。
 */
export function changePasswordErrorMessage(name: string, err?: unknown): string {
    switch (name) {
        case "NotAuthorizedException":
            // いまのパスワードが違う。**「セッション切れ」とは言わない**
            // ——ここまで来ている＝セッションは有効
            return "いまのパスワードが違います";
        case "InvalidPasswordException":
        case "InvalidParameterException":
            return PASSWORD_RULE_MESSAGE;
        case "LimitExceededException":
        case "TooManyRequestsException":
            return "試行回数が多すぎます。しばらく待ってからもう一度お試しください";
        case "NetworkError":
            return "ネットワークにつながりません。接続を確認してもう一度お試しください";
        default:
            return (err as { message?: string } | undefined)?.message || "パスワードを変更できませんでした";
    }
}

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
