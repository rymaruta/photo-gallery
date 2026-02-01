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
    const region = process.env.AWS_REGION || "ap-northeast-1";
    if (!process.env.AWS_REGION) {
        console.warn("⚠️  AWS_REGION not set, using default fallback:", region);
    }
    return new SecretsManagerClient({ region });
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
            const region = secret.AWS_REGION || process.env.AWS_REGION || "ap-northeast-1";
            if (!secret.AWS_REGION && !process.env.AWS_REGION) {
                console.warn("⚠️  AWS_REGION not set in secret or env, using default fallback:", region);
            }
            config = {
                awsRegion: region,
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
        const region = process.env.AWS_REGION || "ap-northeast-1";
        if (!process.env.AWS_REGION) {
            console.warn("⚠️  AWS_REGION not set, using default fallback:", region);
        }
        config = {
            awsRegion: region,
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
