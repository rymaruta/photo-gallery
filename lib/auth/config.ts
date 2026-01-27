// AWS Cognito設定
export const cognitoConfig = {
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
    clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
    // ⚠️ セキュリティ警告: 通常、Cognito App Clientにはシークレットを設定しません（公開クライアント）
    // シークレットが必要な場合は、サーバーサイドでのみ使用してください（クライアントに公開しない）
    // このプロジェクトは静的エクスポート（output: "export"）を使用しているため、すべてのコードがクライアントサイドで実行されます
    // そのため、NEXT_PUBLIC_プレフィックスがついた環境変数はクライアントサイドに公開されます
    // 機密クライアント（Confidential Client）を使用する場合は、別の認証方式を検討してください
    clientSecret: process.env.NEXT_PUBLIC_COGNITO_CLIENT_SECRET || "",
    region: process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1",
};

// 管理者グループ名
export const ADMIN_GROUP_NAME = "admin";

// 認証が必要なページパス
export const PROTECTED_PATHS = ["/upload"];
