import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "../../../../lib/aws/secrets";

// Presigned URLを生成
export async function POST(request: NextRequest) {
    try {
        // 設定を取得（ローカルは.env、本番はSecrets Manager）
        const config = await getConfig();

        // 認証チェック
        const apiKey = request.headers.get("x-api-key");
        if (apiKey !== config.uploadApiKey) {
            return NextResponse.json(
                { error: "認証に失敗しました" },
                { status: 401 }
            );
        }

        // S3クライアントの初期化
        // IAMロールを使用する場合（credentialsが空の場合）、AWS SDKが自動的にIAMロールを使用
        const s3ClientConfig: {
            region: string;
            credentials?: {
                accessKeyId: string;
                secretAccessKey: string;
            };
        } = {
            region: config.awsRegion,
        };

        // アクセスキーとシークレットキーが設定されている場合のみcredentialsを指定
        // 設定されていない場合は、AWS SDKが自動的にIAMロールまたはデフォルト認証情報チェーンを使用
        if (config.awsAccessKeyId && config.awsSecretAccessKey) {
            s3ClientConfig.credentials = {
                accessKeyId: config.awsAccessKeyId,
                secretAccessKey: config.awsSecretAccessKey,
            };
        }

        const s3Client = new S3Client(s3ClientConfig);

        const body = await request.json();
        const { fileName, fileType, fileSize } = body;

        if (!fileName || !fileType) {
            return NextResponse.json(
                { error: "ファイル名とファイルタイプが必要です" },
                { status: 400 }
            );
        }

        // ファイルサイズチェック（10MB制限）
        if (fileSize > 10 * 1024 * 1024) {
            return NextResponse.json(
                { error: "ファイルサイズが大きすぎます（最大10MB）" },
                { status: 400 }
            );
        }

        // 画像ファイルかチェック
        if (!fileType.startsWith("image/")) {
            return NextResponse.json(
                { error: "画像ファイルを選択してください" },
                { status: 400 }
            );
        }

        // ファイル名を生成（セキュアに）
        // 写真IDとS3のファイル名を一致させるため、ここでUUIDを生成して返す
        const fileExtension = fileName.split(".").pop()?.toLowerCase() || "jpg";
        const photoId = uuidv4(); // 写真IDとして使用するUUID
        const safeFileName = `${photoId}.${fileExtension}`;
        const key = `uploads/${safeFileName}`;

        // Presigned URLを生成（15分間有効）
        const command = new PutObjectCommand({
            Bucket: config.awsS3BucketName,
            Key: key,
            ContentType: fileType,
            CacheControl: "max-age=31536000",
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 900, // 15分
        });

        // CloudFront URLがある場合はそれを使用
        const publicUrl = config.cloudfrontUrl
            ? `${config.cloudfrontUrl}/${key}`
            : `https://${config.awsS3BucketName}.s3.${config.awsRegion}.amazonaws.com/${key}`;

        return NextResponse.json({
            presignedUrl,
            key,
            publicUrl,
            photoId, // 写真IDを返す（S3のファイル名と一致）
        });
    } catch (error: any) {
        console.error("Presigned URL生成エラー:", error);
        return NextResponse.json(
            { error: error.message || "Presigned URLの生成に失敗しました" },
            { status: 500 }
        );
    }
}
