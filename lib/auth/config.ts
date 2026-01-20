// AWS Cognito設定
export const cognitoConfig = {
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
    clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
    clientSecret: process.env.NEXT_PUBLIC_COGNITO_CLIENT_SECRET || "", // シークレットありのクライアントの場合に設定
    region: process.env.NEXT_PUBLIC_AWS_REGION || "ap-northeast-1",
};

// 管理者グループ名
export const ADMIN_GROUP_NAME = "admin";

// 認証が必要なページパス
export const PROTECTED_PATHS = ["/upload"];
