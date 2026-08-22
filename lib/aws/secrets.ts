import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// 設定のキャッシュ（サーバーレス環境でのパフォーマンス向上）
let configCache: {
    config: {
        awsRegion: string;
        awsS3BucketName: string;
        awsAccessKeyId: string;
        awsSecretAccessKey: string;
        uploadApiKey: string;
        cloudfrontUrl?: string;
    };
    timestamp: number;
} | null = null;

// キャッシュの有効期限（5分）
const CACHE_TTL = 5 * 60 * 1000;

// Secrets Managerクライアントの初期化
function getSecretsClient() {
    return new SecretsManagerClient({
        region: process.env.AWS_REGION || "ap-northeast-1",
    });
}

// シークレットを取得する関数
export async function getSecret(secretName: string): Promise<Record<string, string> | null> {
    try {
        const client = getSecretsClient();
        const command = new GetSecretValueCommand({
            SecretId: secretName,
        });

        const response = await client.send(command);

        if (response.SecretString) {
            return JSON.parse(response.SecretString);
        }

        return null;
    } catch (error) {
        console.error(`Failed to get secret ${secretName}:`, error);
        return null;
    }
}

// 環境変数を取得する関数（AWS_SECRET_NAMEが設定されている場合はSecrets Managerから取得、それ以外は.envから取得）
// IAMロールを使用する場合、awsAccessKeyIdとawsSecretAccessKeyは空文字列を返す
export async function getConfig(): Promise<{
    awsRegion: string;
    awsS3BucketName: string;
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
    uploadApiKey: string;
    cloudfrontUrl?: string;
    useIamRole: boolean; // IAMロールを使用するかどうか
}> {
    // キャッシュをチェック
    if (configCache && Date.now() - configCache.timestamp < CACHE_TTL) {
        return {
            ...configCache.config,
            useIamRole: !configCache.config.awsAccessKeyId && !configCache.config.awsSecretAccessKey,
        };
    }

    let config: {
        awsRegion: string;
        awsS3BucketName: string;
        awsAccessKeyId: string;
        awsSecretAccessKey: string;
        uploadApiKey: string;
        cloudfrontUrl?: string;
    };

    // AWS_SECRET_NAMEが設定されている場合はSecrets Managerから取得（ローカル・本番共通）
    if (process.env.AWS_SECRET_NAME) {
        const secret = await getSecret(process.env.AWS_SECRET_NAME);

        if (!secret) {
            // Secrets Managerから取得できない場合は、環境変数から取得を試みる（フォールバック）
            console.warn("Failed to retrieve secrets from AWS Secrets Manager, falling back to environment variables");
            config = {
                awsRegion: process.env.AWS_REGION || "ap-northeast-1",
                awsS3BucketName: process.env.AWS_S3_BUCKET_NAME || "",
                // IAMロールを使用する場合、環境変数が設定されていない場合は空文字列
                awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
                awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
                // ローカル環境では、UPLOAD_API_KEYが設定されていない場合はNEXT_PUBLIC_UPLOAD_API_KEYを使用（開発用）
                uploadApiKey: process.env.UPLOAD_API_KEY || process.env.NEXT_PUBLIC_UPLOAD_API_KEY || "",
                cloudfrontUrl: process.env.CLOUDFRONT_URL,
            };
        } else {
            config = {
                awsRegion: secret.AWS_REGION || process.env.AWS_REGION || "ap-northeast-1",
                awsS3BucketName: secret.AWS_S3_BUCKET_NAME || "",
                // Secrets Managerにアクセスキーが含まれていない場合は空文字列（IAMロールを使用）
                awsAccessKeyId: secret.AWS_ACCESS_KEY_ID || "",
                awsSecretAccessKey: secret.AWS_SECRET_ACCESS_KEY || "",
                uploadApiKey: secret.UPLOAD_API_KEY || "",
                cloudfrontUrl: secret.CLOUDFRONT_URL,
            };
        }
    } else {
        // AWS_SECRET_NAMEが設定されていない場合は.envから取得（フォールバック）
        config = {
            awsRegion: process.env.AWS_REGION || "ap-northeast-1",
            awsS3BucketName: process.env.AWS_S3_BUCKET_NAME || "",
            // ローカル環境では、環境変数または~/.aws/credentialsを使用
            awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
            awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
            uploadApiKey: process.env.UPLOAD_API_KEY || "",
            cloudfrontUrl: process.env.CLOUDFRONT_URL,
        };
    }

    // キャッシュに保存
    configCache = {
        config,
        timestamp: Date.now(),
    };

    return {
        ...config,
        useIamRole: !config.awsAccessKeyId && !config.awsSecretAccessKey,
    };
}

/**
 * 開発用APIのキー検査。**設定が空なら誰も通さない。**
 *
 * `apiKey !== config.uploadApiKey` の直接比較だった頃は、UPLOAD_API_KEY が
 * 未設定（= 空文字）のとき、`x-api-key: ""` と**空文字のヘッダを送るだけで
 * `"" !== ""` が偽になり認証を通った**。DELETE /api/photos/<id> まで同じ形
 * だったので、`npm run dev` を上げているマシンの写真を消せた。
 * app/api/** は開発専用（ビルドから退避される）だが、fail-open にはしない。
 * 4つの route が同じ検査をするので、判定はここ1か所に置く。
 */
export function isAuthorizedApiKey(headerValue: string | null, configuredKey: string): boolean {
    if (!configuredKey) return false;   // 鍵を設定していないなら、開いているのではなく閉じている
    return headerValue === configuredKey;
}
