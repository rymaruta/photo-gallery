// AWS Cognito設定
//
// User Pool ID / Client ID は公開識別子（シークレットではない）。
// 環境変数が未設定・空・不正形式（改行や空白の混入など）の場合は本番の値にフォールバックする。
// "Invalid UserPoolId format" は不可視文字が混じった値をそのまま CognitoUserPool に
// 渡すと発生するため、ここで形式検証してから使う。
const POOL_ID_RE = /^[\w-]+_[0-9a-zA-Z]+$/;
const CLIENT_ID_RE = /^[\w+]+$/;

const envPoolId = (process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "").trim();
const envClientId = (process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "").trim();

export const cognitoConfig = {
    userPoolId: POOL_ID_RE.test(envPoolId) ? envPoolId : "ap-northeast-1_ZbuhDQsWz",
    clientId: CLIENT_ID_RE.test(envClientId) ? envClientId : "21cs4cd8dkttmg3snloj72u8mu",
    // ⚠️ セキュリティ警告: 通常、Cognito App Clientにはシークレットを設定しません（公開クライアント）
    // このプロジェクトは静的エクスポート（output: "export"）を使用しているため、すべてのコードがクライアントサイドで実行されます
    // そのため、NEXT_PUBLIC_プレフィックスがついた環境変数はクライアントサイドに公開されます
    region: (process.env.NEXT_PUBLIC_AWS_REGION ?? "").trim() || "ap-northeast-1",
};

// グループ名
export const ADMIN_GROUP_NAME = "admin";
export const USER_GROUP_NAME = "user";

// 認証が必要なページパス
export const PROTECTED_PATHS = ["/user/upload"];
