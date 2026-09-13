// AWS Cognito設定
//
// User Pool ID / Client ID は公開識別子（シークレットではない）。
// "Invalid UserPoolId format" は不可視文字が混じった値をそのまま CognitoUserPool に
// 渡すと発生するため、ここで形式検証してから使う。
//
// 本番値へのフォールバックは置かない。以前は形式が不正なら本番の値に落としており、
// staging のビルドで値を渡し忘れると**本番のユーザープールで認証**されてしまった。
// 不正なら空にして、ログイン時に分かる形で失敗させる。
const POOL_ID_RE = /^[\w-]+_[0-9a-zA-Z]+$/;
const CLIENT_ID_RE = /^[\w+]+$/;

const envPoolId = (process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "").trim();
const envClientId = (process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "").trim();

export const cognitoConfig = {
    userPoolId: POOL_ID_RE.test(envPoolId) ? envPoolId : "",
    clientId: CLIENT_ID_RE.test(envClientId) ? envClientId : "",
    // ⚠️ セキュリティ警告: 通常、Cognito App Clientにはシークレットを設定しません（公開クライアント）
    // このプロジェクトは静的エクスポート（output: "export"）を使用しているため、すべてのコードがクライアントサイドで実行されます
    // そのため、NEXT_PUBLIC_プレフィックスがついた環境変数はクライアントサイドに公開されます
    region: (process.env.NEXT_PUBLIC_AWS_REGION ?? "").trim() || "ap-northeast-1",
};

// グループ名
export const ADMIN_GROUP_NAME = "admin";
export const USER_GROUP_NAME = "user";

