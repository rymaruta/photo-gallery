# 本番環境セットアップガイド

このガイドでは、本番環境（S3+CloudFront静的配信 + API Gateway+Lambda）でのデプロイ手順を説明します。

## 📋 このガイドの対象者

- ✅ **本番環境にデプロイしたい人**
- ✅ **AWSの基本操作ができる人**

## 📚 初心者の方はこちら

- **[クイックスタートガイド](./QUICK_START.md)** - 5分で始める
- **[初めてのセットアップ](./LOCAL_SETUP.md)** - ローカル開発環境の設定（初心者向け）

## ⚠️ 重要: ローカル開発環境の設定を先に完了してください

本番環境にデプロイする前に、**ローカル開発環境で動作確認**することを強く推奨します。

1. まず [初めてのセットアップ](./LOCAL_SETUP.md) でローカル環境を設定
2. ローカルでアップロード機能が動作することを確認
3. その後、このガイドで本番環境をセットアップ

---

## 目次

1. [本番環境の概要](#本番環境の概要)
2. [AWSリソースの準備](#awsリソースの準備)
3. [IAMロールの作成（Lambda用）](#iamロールの作成lambda用)
4. [API Gateway + Lambda の設定](#api-gateway--lambda-の設定)
5. [CloudFrontの設定](#cloudfrontの設定)
6. [ビルド前の確認](#ビルド前の確認)
7. [静的サイトのデプロイ](#静的サイトのデプロイ)
8. [動作確認](#動作確認)
9. [トラブルシューティング](#トラブルシューティング)

---

## 本番環境の概要

本番環境は以下の構成です：

- **静的サイト**: S3バケット `journey-photo.com` + CloudFront（Next.jsの静的エクスポート）
- **画像アップロード**: S3バケット `prod-journey-photo-upload`（`uploads/` プレフィックス）
- **メタデータ**: S3バケット `journey-photo.com` 内の `app/data/photos.json`（Lambdaが更新）
- **API**: API Gateway (HTTP API) + Lambda（管理API）
- **認証**: Cognito JWT（`Authorization: Bearer <JWT>`）
- **IAMロール**: Lambda実行ロール（Secrets Manager、S3へのアクセス権限）

---

## AWSリソースの準備

### 1. AWS Cognito User Pool

**必要な値:**
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_AWS_REGION`

**Cognito App Clientの設定:**
- **認証フロー**: `ALLOW_USER_PASSWORD_AUTH` を有効化
- **シークレット**: 生成しない（シークレットなしのクライアント）

### 2. AWS S3 バケット

#### 2.1 静的サイト用バケット（`journey-photo.com`）

1. AWSコンソールで「S3」を開く
2. 「バケットを作成」をクリック
3. 以下の設定を入力：
   - **バケット名**: `journey-photo.com`（⚠️ 世界中で一意である必要があります）
   - **AWSリージョン**: `ap-northeast-1`（東京）
   - **オブジェクト所有権**: **ACL無効（推奨）** を選択
   - **このバケットのブロックパブリックアクセス設定**: **すべてONのまま**（CloudFront経由でアクセス）
4. 「バケットを作成」をクリック

**バケットポリシー（CloudFront経由のみアクセス可能）:**

後述の「CloudFrontの設定」でOrigin Access Control (OAC)を設定後、以下のポリシーを適用します。

#### 2.2 画像アップロード用バケット（`prod-journey-photo-upload`）

1. 「バケットを作成」をクリック
2. 以下の設定を入力：
   - **バケット名**: `prod-journey-photo-upload`
   - **AWSリージョン**: `ap-northeast-1`
   - **オブジェクト所有権**: **ACL無効（推奨）** を選択
   - **このバケットのブロックパブリックアクセス設定**: **すべてONのまま**（CloudFront経由でアクセス）
3. 「バケットを作成」をクリック

**CORS設定:**

1. 「アクセス許可」タブの「クロスオリジンリソース共有 (CORS)」の「編集」をクリック
2. 以下のJSONを貼り付け（`journey-photo.com`を実際のドメインに置き換える）：

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
    "AllowedOrigins": [
      "https://journey-photo.com",
      "https://www.journey-photo.com"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

3. 「変更の保存」をクリック

---

### 3. AWS Secrets Manager のシークレット作成

#### 3.1 シークレットの作成

1. AWSコンソールで「Secrets Manager」を開く
2. 「新しいシークレットを保存する」をクリック
3. 以下の設定を選択：
   - **シークレットのタイプ**: 「その他のシークレット」を選択
   - **キー/値のペア**: JSON形式で直接入力

**JSON形式で直接入力:**

```json
{
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "prod-journey-photo-upload",
  "AWS_S3_SITE_BUCKET_NAME": "journey-photo.com",
  "CLOUDFRONT_URL": "https://d1234567890abc.cloudfront.net"
}
```

**説明:**
- `AWS_S3_BUCKET_NAME`: 画像アップロード用バケット名
- `AWS_S3_SITE_BUCKET_NAME`: 静的サイト用バケット名（`photos.json`の保存先）
- `CLOUDFRONT_URL`: CloudFront URL（後で設定）

4. 「次へ」をクリック
5. **シークレットの名前**: `prod-journey-photo-upload`（または任意の名前）
   - ⚠️ この名前をメモしてください（Lambdaの環境変数に設定します）
6. 「次へ」をクリック
7. **自動ローテーション**: 必要に応じて設定（オプション）
8. 「次へ」をクリック
9. 確認して「保存」をクリック

---

## IAMロールの作成（Lambda用）

Lambda関数がAWSリソースにアクセスするためのIAMロールを作成します。

### 1. IAMポリシーの作成

まず、Lambda関数に必要な権限を定義するIAMポリシーを作成します。

#### 1.1 ポリシーの作成

1. AWSコンソールで「IAM」を開く
2. 左メニューから「ポリシー」を選択
3. 「ポリシーを作成」をクリック
4. **JSON**タブを選択
5. 以下のJSONを貼り付け（`YOUR_ACCOUNT_ID`を実際のAWSアカウントIDに置き換える）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-1:*:*"
    },
    {
      "Sid": "ReadSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-1:YOUR_ACCOUNT_ID:secret:prod-journey-photo-upload-*"
    },
    {
      "Sid": "UploadsBucketRW",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::prod-journey-photo-upload/uploads/*"
    },
    {
      "Sid": "SiteBucketPhotosJsonRW",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::journey-photo.com/app/data/photos.json"
    },
    {
      "Sid": "ListBuckets",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::prod-journey-photo-upload",
        "arn:aws:s3:::journey-photo.com"
      ]
    }
  ]
}
```

**AWSアカウントIDの確認方法:**
- AWSコンソール右上のユーザー名をクリック
- アカウントIDが表示されます

6. 「次へ」をクリック
7. **ポリシー名**: `PhotoGalleryLambdaPolicy`（任意の名前）
8. **説明**: `Photo Gallery Lambda関数用ポリシー`（任意）
9. 「ポリシーを作成」をクリック

### 2. IAMロールの作成

作成したポリシーをアタッチしたIAMロールを作成します。

#### 2.1 ロールの作成

1. AWSコンソールで「IAM」を開く
2. 左メニューから「ロール」を選択
3. 「ロールを作成」をクリック
4. **信頼されたエンティティタイプ**: 「AWS のサービス」を選択
5. **ユースケース**: 「Lambda」を選択
6. 「次へ」をクリック

#### 2.2 権限ポリシーのアタッチ

1. **許可ポリシーを追加**: 検索ボックスに `PhotoGalleryLambdaPolicy` を入力
2. 上記で作成した `PhotoGalleryLambdaPolicy` を選択
3. 「次へ」をクリック

#### 2.3 ロール名の設定

1. **ロール名**: `PhotoGalleryLambdaRole`（任意の名前）
2. **説明**: `Photo Gallery Lambda実行ロール`（任意）
3. 「ロールを作成」をクリック

#### 2.4 ロールARNの取得

1. 作成したロールを選択
2. 「ARN」をコピー
3. 形式: `arn:aws:iam::YOUR_ACCOUNT_ID:role/PhotoGalleryLambdaRole`
4. 例: `arn:aws:iam::123456789012:role/PhotoGalleryLambdaRole`
5. ⚠️ この値をメモしてください（Lambda関数の設定で使用します）

---

## API Gateway + Lambda の設定

### 1. Lambda関数の作成

#### 1.1 関数の作成

1. AWSコンソールで「Lambda」を開く
2. 「関数の作成」をクリック
3. 以下の設定を入力：
   - **関数名**: `photo-gallery-api`（任意の名前）
   - **ランタイム**: `Node.js 20.x`（または最新のLTS）
   - **アーキテクチャ**: `x86_64`
   - **実行ロール**: 「既存のロールを使用する」を選択
   - **既存のロール**: 上記で作成した `PhotoGalleryLambdaRole` を選択
4. 「関数の作成」をクリック

#### 1.2 環境変数の設定

1. 作成したLambda関数を選択
2. 「設定」タブ > 「環境変数」を開く
3. 「編集」をクリック
4. 以下の環境変数を追加：

| 環境変数名 | 値（例） | 説明 |
|-----------|---------|------|
| `AWS_SECRET_NAME` | `prod-journey-photo-upload` | Secrets Managerのシークレット名 |
| `COGNITO_USER_POOL_ID` | `ap-northeast-1_12345678` | Cognito User Pool ID |

5. 「保存」をクリック

#### 1.3 Lambda関数コード

**⚠️ 重要**: Lambda関数のコードは既に`api/handler.js`に実装されています。  
Serverless Frameworkを使用してデプロイするため、手動でコードをコピーする必要はありません。

**実装されているエンドポイント:**

- `GET /photos` - 写真一覧取得（公開）
- `GET /photos/{id}` - 写真詳細取得（公開）
- `POST /upload/presigned-url` - Presigned URL生成（認証必須）
- `POST /upload/save` - 写真メタデータ保存（認証必須）
- `PUT /photos/{id}` - 写真メタデータ更新（認証必須）
- `DELETE /photos/{id}` - 写真削除（認証必須）

**デプロイ方法:**

Serverless Frameworkを使用してデプロイします（手順は後述の「API Gateway + Lambda の設定」セクションを参照）。

**参考: 実装のポイント**

1. **JWT検証**: `jwks-rsa`を使用してCognitoの公開鍵を取得し、JWTを検証
2. **エラーハンドリング**: すべてのエラーをキャッチし、適切なHTTPステータスコードとエラーメッセージを返す
3. **ログ出力**: 構造化ログ（JSON形式）でリクエスト、エラー、重要な操作を記録
4. **リクエストバリデーション**: 各エンドポイントでリクエストボディを検証
5. **S3操作**: `photos.json`の読み書きをS3で実行
6. **管理者権限チェック**: JWTトークンに`admin`グループが含まれているか確認

**詳細な実装コードは`api/handler.js`を参照してください。**

// ログ出力用ヘルパー
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data,
  };
  console.log(JSON.stringify(logEntry));
}

// シークレット取得（キャッシュ付き）
let configCache = null;

async function getConfig() {
  if (configCache) return configCache;
  
  try {
    const secretsClient = new SecretsManagerClient({ 
      region: process.env.AWS_REGION || 'ap-northeast-1' 
    });
    const secret = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: process.env.AWS_SECRET_NAME })
    );
    
    configCache = JSON.parse(secret.SecretString);
    log('info', 'Config loaded from Secrets Manager', { 
      secretName: process.env.AWS_SECRET_NAME 
    });
    return configCache;
  } catch (error) {
    log('error', 'Failed to load config from Secrets Manager', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

// Cognito JWT検証（jwks-rsaを使用）
let jwksClientInstance = null;

function getJwksClient(userPoolId) {
  if (!jwksClientInstance) {
    const region = process.env.AWS_REGION || 'ap-northeast-1';
    const jwksUri = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
    
    jwksClientInstance = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 86400000, // 24時間
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return jwksClientInstance;
}

function getKey(header, callback) {
  const client = getJwksClient(process.env.COGNITO_USER_POOL_ID);
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

async function verifyToken(token, userPoolId) {
  try {
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, {
        algorithms: ['RS256'],
        issuer: `https://cognito-idp.${process.env.AWS_REGION || 'ap-northeast-1'}.amazonaws.com/${userPoolId}`,
      }, (err, decoded) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(decoded);
      });
    });
    
    log('info', 'JWT token verified', { 
      username: decoded['cognito:username'],
      groups: decoded['cognito:groups'] || []
    });
    
    return { valid: true, decoded };
  } catch (error) {
    log('warn', 'JWT token verification failed', { 
      error: error.message 
    });
    return { valid: false, error: error.message };
  }
}

// リクエストバリデーション
function validatePresignedUrlRequest(body) {
  const errors = [];
  
  if (!body.fileName || typeof body.fileName !== 'string') {
    errors.push('fileName is required and must be a string');
  }
  
  if (!body.fileType || typeof body.fileType !== 'string') {
    errors.push('fileType is required and must be a string');
  }
  
  if (!body.fileType.startsWith('image/')) {
    errors.push('fileType must be an image');
  }
  
  if (body.fileSize && body.fileSize > 10 * 1024 * 1024) {
    errors.push('fileSize must be less than 10MB');
  }
  
  return errors;
}

function validateSaveRequest(body) {
  const errors = [];
  
  if (!body.key || typeof body.key !== 'string') {
    errors.push('key is required and must be a string');
  }
  
  if (!body.publicUrl || typeof body.publicUrl !== 'string') {
    errors.push('publicUrl is required and must be a string');
  }
  
  if (!body.photoId || typeof body.photoId !== 'string') {
    errors.push('photoId is required and must be a string');
  }
  
  return errors;
}

function validateUpdateRequest(body) {
  // 更新リクエストは任意のフィールドを更新できる
  // バリデーションは最小限に
  return [];
}

// S3からphotos.jsonを読み込む
async function loadPhotosFromS3(config) {
  try {
    const s3Client = new S3Client({ region: config.AWS_REGION });
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: config.AWS_S3_SITE_BUCKET_NAME,
      Key: 'app/data/photos.json',
    });
    
    try {
      const response = await s3Client.send(getObjectCommand);
      const photosJson = await response.Body.transformToString();
      const photos = JSON.parse(photosJson);
      log('info', 'Photos loaded from S3', { count: photos.length });
      return photos;
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        log('info', 'photos.json not found in S3, returning empty array');
        return [];
      }
      throw error;
    }
  } catch (error) {
    log('error', 'Failed to load photos from S3', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

// S3にphotos.jsonを保存
async function savePhotosToS3(config, photos) {
  try {
    const s3Client = new S3Client({ region: config.AWS_REGION });
    
    const putObjectCommand = new PutObjectCommand({
      Bucket: config.AWS_S3_SITE_BUCKET_NAME,
      Key: 'app/data/photos.json',
      Body: JSON.stringify(photos, null, 2),
      ContentType: 'application/json',
    });
    
    await s3Client.send(putObjectCommand);
    log('info', 'Photos saved to S3', { count: photos.length });
  } catch (error) {
    log('error', 'Failed to save photos to S3', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

// Lambdaハンドラー
exports.handler = async (event) => {
  const requestId = event.requestContext?.requestId || 'unknown';
  const { httpMethod, path, pathParameters, headers, body: rawBody } = event;
  
  log('info', 'Request received', {
    requestId,
    httpMethod,
    path,
    pathParameters,
  });
  
  // CORSヘッダー
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
  
  // OPTIONSリクエスト（CORSプリフライト）
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }
  
  // 認証が必要なエンドポイントのチェック
  const requiresAuth = ['POST', 'PUT', 'DELETE'].includes(httpMethod) && 
                       (path.startsWith('/upload') || path.startsWith('/photos'));
  
  let authResult = null;
  if (requiresAuth) {
    const authHeader = headers.Authorization || headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log('warn', 'Missing or invalid Authorization header', { path });
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: '認証が必要です' }),
      };
    }
    
    const token = authHeader.substring(7);
    authResult = await verifyToken(token, process.env.COGNITO_USER_POOL_ID);
    
    if (!authResult.valid) {
      log('warn', 'JWT verification failed', { 
        path,
        error: authResult.error 
      });
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: '認証に失敗しました' }),
      };
    }
    
    // 管理者グループのチェック（必要に応じて）
    const groups = authResult.decoded['cognito:groups'] || [];
    if (!groups.includes('admin')) {
      log('warn', 'User is not in admin group', { 
        username: authResult.decoded['cognito:username'],
        groups 
      });
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: '管理者権限が必要です' }),
      };
    }
  }
  
  // エンドポイント別の処理
  try {
    // GET /photos - 写真一覧取得
    if (httpMethod === 'GET' && path === '/photos') {
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      return {
        statusCode: 200,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
        body: JSON.stringify(photos),
      };
    }
    
    // GET /photos/{id} - 写真詳細取得
    if (httpMethod === 'GET' && path.startsWith('/photos/')) {
      const photoId = pathParameters?.id || path.split('/').pop();
      
      if (!photoId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真IDが必要です' }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      const photo = photos.find(p => p.id === photoId);
      
      if (!photo) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真が見つかりません' }),
        };
      }
      
      return {
        statusCode: 200,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
        body: JSON.stringify(photo),
      };
    }
    
    // POST /upload/presigned-url - Presigned URL生成
    if (httpMethod === 'POST' && path === '/upload/presigned-url') {
      let body;
      try {
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (error) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }
      
      const validationErrors = validatePresignedUrlRequest(body);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: validationErrors.join(', ') }),
        };
      }
      
      const config = await getConfig();
      const s3Client = new S3Client({ region: config.AWS_REGION });
      
      const fileExtension = body.fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const photoId = uuidv4();
      const safeFileName = `${photoId}.${fileExtension}`;
      const key = `uploads/${safeFileName}`;
      
      const command = new PutObjectCommand({
        Bucket: config.AWS_S3_BUCKET_NAME,
        Key: key,
        ContentType: body.fileType,
        CacheControl: 'max-age=31536000',
      });
      
      const presignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 900, // 15分
      });
      
      const publicUrl = config.CLOUDFRONT_URL
        ? `${config.CLOUDFRONT_URL}/${key}`
        : `https://${config.AWS_S3_BUCKET_NAME}.s3.${config.AWS_REGION}.amazonaws.com/${key}`;
      
      log('info', 'Presigned URL generated', { photoId, key });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presignedUrl,
          key,
          publicUrl,
          photoId,
        }),
      };
    }
    
    // POST /upload/save - 写真メタデータ保存
    if (httpMethod === 'POST' && path === '/upload/save') {
      let body;
      try {
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (error) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }
      
      const validationErrors = validateSaveRequest(body);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: validationErrors.join(', ') }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      const photoData = {
        id: body.photoId,
        src: body.publicUrl,
        title: body.title || { ja: '無題', en: 'Untitled' },
        description: body.description
          ? typeof body.description === 'string'
            ? { ja: [body.description], en: [] }
            : body.description
          : undefined,
        location: body.location || undefined,
        category: body.category || undefined,
        tags: body.tags && Array.isArray(body.tags) ? body.tags : [],
        exif: body.exif || undefined,
        published: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      photos.push(photoData);
      await savePhotosToS3(config, photos);
      
      log('info', 'Photo saved', { photoId: body.photoId });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          photo: photoData,
        }),
      };
    }
    
    // PUT /photos/{id} - 写真メタデータ更新
    if (httpMethod === 'PUT' && path.startsWith('/photos/')) {
      const photoId = pathParameters?.id || path.split('/').pop();
      
      if (!photoId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真IDが必要です' }),
        };
      }
      
      let body;
      try {
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (error) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }
      
      const validationErrors = validateUpdateRequest(body);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: validationErrors.join(', ') }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      const photoIndex = photos.findIndex(p => p.id === photoId);
      if (photoIndex === -1) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真が見つかりません' }),
        };
      }
      
      const updatedPhoto = {
        ...photos[photoIndex],
        ...body,
        id: photoId, // IDは変更不可
        updatedAt: new Date().toISOString(),
      };
      
      photos[photoIndex] = updatedPhoto;
      await savePhotosToS3(config, photos);
      
      log('info', 'Photo updated', { photoId });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          photo: updatedPhoto,
        }),
      };
    }
    
    // DELETE /photos/{id} - 写真削除
    if (httpMethod === 'DELETE' && path.startsWith('/photos/')) {
      const photoId = pathParameters?.id || path.split('/').pop();
      
      if (!photoId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真IDが必要です' }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      const photoIndex = photos.findIndex(p => p.id === photoId);
      if (photoIndex === -1) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真が見つかりません' }),
        };
      }
      
      const photo = photos[photoIndex];
      
      // S3から画像を削除（srcがS3のURLの場合）
      if (photo.src && photo.src.startsWith('http')) {
        try {
          const s3Client = new S3Client({ region: config.AWS_REGION });
          
          // URLからキーを抽出
          let key;
          try {
            const url = new URL(photo.src);
            key = url.pathname.substring(1); // 先頭の/を削除
          } catch (urlError) {
            log('warn', 'Failed to parse photo URL', { 
              photoId,
              photoSrc: photo.src 
            });
            throw new Error(`無効なURL形式: ${photo.src}`);
          }
          
          if (!key || !key.trim()) {
            throw new Error(`キーが抽出できませんでした: ${photo.src}`);
          }
          
          const deleteCommand = new DeleteObjectCommand({
            Bucket: config.AWS_S3_BUCKET_NAME,
            Key: key,
          });
          
          await s3Client.send(deleteCommand);
          log('info', 'Photo deleted from S3', { photoId, key });
        } catch (s3Error) {
          log('error', 'Failed to delete photo from S3', { 
            photoId,
            error: s3Error.message,
            stack: s3Error.stack 
          });
          // S3削除に失敗した場合は、エラーをスローしてphotos.jsonからの削除も中止
          throw new Error(`S3からの画像削除に失敗しました: ${s3Error.message}`);
        }
      }
      
      // photos.jsonから削除
      photos.splice(photoIndex, 1);
      await savePhotosToS3(config, photos);
      
      log('info', 'Photo deleted', { photoId });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
        }),
      };
    }
    
    // 404 Not Found
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not Found' }),
    };
  } catch (error) {
    log('error', 'Lambda handler error', {
      requestId,
      httpMethod,
      path,
      error: error.message,
      stack: error.stack,
    });
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: error.message || 'Internal Server Error',
        requestId,
      }),
    };
  }
};
```

**必要なnpmパッケージ:**

Lambda関数の依存関係は`api/package.json`に定義されています。  
Serverless Frameworkが自動的にインストールしてデプロイします。

#### 1.4 Lambda関数のデプロイ

**⚠️ 重要**: このプロジェクトでは**Serverless Framework**を使用してデプロイします。

手動でコードをコピーする必要はありません。以下のコマンドでデプロイできます：

```bash
# 開発環境にデプロイ
npm run api:deploy:dev

# 本番環境にデプロイ
npm run api:deploy:prod
```

**詳細な手順は後述の「API Gateway + Lambda の設定」セクションを参照してください。**

### 2. API Gateway + Lambda の設定（Serverless Frameworkを使用）

**⚠️ 重要**: このプロジェクトでは**Serverless Framework**を使用してAPI GatewayとLambdaを自動的にデプロイします。

手動でAWSコンソールから設定する必要はありません。以下のコマンドでデプロイできます：

```bash
# 本番環境にデプロイ
npm run api:deploy:prod
```

**デプロイされる内容:**

- API Gateway (HTTP API) の作成
- Lambda関数の作成とデプロイ
- ルートの設定（`GET /photos`, `POST /upload/presigned-url` など）
- CORS設定
- 環境変数の設定

**詳細な手順:**

Serverless Frameworkの設定は`api/serverless.yml`に定義されています。  
デプロイコマンドを実行すると、自動的に以下のリソースが作成されます：

- **API Gateway**: HTTP APIが作成され、エンドポイントURLが表示されます
- **Lambda関数**: `photo-gallery-api-prod-api` が作成されます
- **IAMロール**: Lambda実行用のロールが自動的に作成されます

**デプロイ後の確認:**

```bash
# デプロイされたAPIの情報を確認
npm run api:info:prod
```

**APIエンドポイントURLの取得:**

デプロイ後、以下のコマンドでエンドポイントURLを確認できます：

```bash
npm run api:info:prod
```

または、AWSコンソールで「API Gateway」→ 作成されたAPI → 「ステージ」→ `$default` を確認してください。

**⚠️ 手動設定が必要な場合:**

Serverless Frameworkを使用しない場合は、以下の手順を参照してください：
- AWSコンソールから手動でAPI GatewayとLambdaを設定する方法（上級者向け）

ただし、**Serverless Frameworkを使用することを強く推奨します**（設定が簡単で、再現性が高いため）。

---

## CloudFrontの設定

**⚠️ 重要: このセクションは本番環境（Production）の設定手順です。**

### 📋 簡易手順（初心者向け）

CloudFrontの設定は複雑ですが、以下の手順で進めます：

1. **プラン選択**: 「Pay as you go」を選択（推奨）
2. **オリジン設定**: S3バケット（`journey-photo.com`）をオリジンとして設定
3. **セキュリティ設定**: WAFを有効化（モニターモードはオフ）
4. **TLS証明書**: CloudFrontのデフォルト証明書を使用（カスタムドメインを使用しない場合）
5. **API Gateway用オリジンの追加**: `/api/*` パスをAPI Gatewayに転送
6. **キャッシュビヘイビア**: 静的サイト用（`CachingOptimized`）とAPI用（`CachingDisabled`）を設定

**詳細な手順は以下を参照してください。**

---

### 詳細手順

**本番環境で使用するリソース:**
- S3バケット: `journey-photo.com`（静的サイト用）
- S3バケット: `prod-journey-photo-upload`（画像アップロード用）
- API Gateway: 既に作成済みのHTTP API
- CloudFront: 新規作成するディストリビューション

**⚠️ 本番環境での注意事項:**
- 設定を変更する前に、必ず設定内容を確認してください
- ディストリビューションの作成後、ステータスが「Deployed」になるまで待ってから使用してください
- 本番環境では、モニターモードをオフにして、WAFが実際にブロックするように設定してください

### 1. CloudFrontディストリビューションの作成（本番環境）

CloudFrontディストリビューションの作成方法には、**新しいウィザード形式**と**従来の形式**があります。ここでは、新しいウィザード形式での設定手順を説明します。

**ウィザードのステップ:**
1. Choose a plan（プラン選択）
2. Get started（開始）
3. Specify origin（オリジンの指定）
4. Enable security（セキュリティの有効化）
5. Get TLS certificate（TLS証明書の取得）
6. Review and create（確認と作成）

#### 1.0 プラン選択（Choose a plan）

このステップでは、CloudFrontの料金プランを選択します。

**⚠️ 本番環境での推奨:**
- 本番環境では、**「Pay as you go」** または **「Business」** プランを推奨します
- トラフィック量が予測可能で、月間1億2500万リクエスト以内の場合は、「Business」プランがコスト効率が良い場合があります
- トラフィック量が予測困難な場合や、月間1億2500万リクエストを超える可能性がある場合は、「Pay as you go」プランを推奨します

**画面の確認:**
- 画面の上部に「Choose a plan」というタイトルが表示されています
- 左側のサイドバーで「ステップ1 Choose a plan」がハイライト表示されています
- 画面の上部に青いバナーが表示されています（「Everything you need for a simple monthly price」）

**プランの選択:**

本番環境では、**「Pay as you go」** を選択することを推奨します。
- 使用量に応じて支払う従量課金プラン
- トラフィック量が予測困難な場合に適しています
- 固定プラン（Business、Premium）も選択可能ですが、月間リクエスト数が予測可能な場合のみ推奨

**設定手順:**

1. AWSコンソールで「CloudFront」を開く
   - AWSコンソールの検索バーで「CloudFront」を検索
   - または、サービス一覧から「CloudFront」を選択
   - ⚠️ **本番環境のAWSアカウントにログインしていることを確認してください**

2. 「ディストリビューションを作成」または「Create distribution」ボタンをクリック
   - CloudFrontのダッシュボード画面の右上に表示されています

3. **「Choose a plan」** 画面で、以下のいずれかを選択：

   **本番環境推奨: 「Pay as you go」を選択**
   - ラジオボタンをクリックして選択します
   - 説明文: "Pay only for what you use based on traffic and enabled features related to this distribution in CloudFront, AWS WAF, Route 53, S3, and CloudWatch Logs. Choose this option if you serve more than 50TB or 500M requests per month, need control over feature selection (including features not available in pricing plans), or want to use your custom rates."
   - 使用量に応じて支払う従量課金プランです
   - 月間50TBまたは5億リクエストを超える場合、または機能を個別に選択したい場合に適しています
   - **本番環境では、このオプションを推奨します**
   - トラフィック量が予測困難な場合や、将来的にスケールする可能性がある場合に適しています

   **または、固定プランを選択（本番環境で使用する場合）:**
   - 4つのプランカードが横並びに表示されています
   - 各プランカードには、ラジオボタン、料金、説明、使用量制限、含まれる機能が表示されています
   - ⚠️ **本番環境では、Freeプランは使用しないでください**（使用量制限が少なすぎます）
   
   **Free:**
   - 料金: `$0/month`
   - 説明: "For hobbyists, learners, and developers getting started."
   - 使用量制限: "1M requests / 100GB per month"
   - 含まれる機能: Always-on DDoS protection、AWS WAF、IP-based rate limiting、Geographic traffic blocking、Serverless edge compute、Smart routing、Global CDN、DNS、Free TLS certificate、Tiered caching、Default caching rules、Fast cache invalidations、5GB S3 storage included
   - ⚠️ **本番環境では使用しないでください**（開発・テスト用のみ）

   **Pro:**
   - 料金: `$15/month`
   - 説明: "Launch and grow small websites, blogs, and applications."
   - 使用量制限: "10M requests / 50TB per month"
   - 含まれる機能: Freeプランのすべての機能に加えて、Protections for WordPress, PHP, and SQL databases、Header-based threat filtering、Edge key-value store、Logging、50GB S3 storage included
   - ⚠️ **本番環境で使用する場合**: 小規模なサイトで、月間1000万リクエスト以内の場合に適しています

   **Business:**
   - 料金: `$200/month`
   - 説明: "Protect and accelerate business applications."
   - 使用量制限: "125M requests / 50TB per month"
   - 含まれる機能: Proプランのすべての機能に加えて、Advanced DDoS protection、Bot management and analytics、Regex-based threat filtering、JavaScript challenge、Custom caching rules、Private origins within VPC、Uptime SLA、1TB S3 storage included
   - ⚠️ **本番環境で使用する場合**: 中規模のサイトで、月間1億2500万リクエスト以内の場合に適しています
   - Layer 7 DDoS保護が含まれています

   **Premium:**
   - 料金: `$1000/month`
   - 説明: "Scale and protect business and mission-critical applications."
   - 使用量制限: "500M requests / 50TB per month"
   - 含まれる機能: Businessプランのすべての機能に加えて、High-speed origin routing、Origin load reduction、Automatic origin failover、Mutual TLS (mTLS)、5TB S3 storage included
   - ⚠️ **本番環境で使用する場合**: 大規模なサイトで、月間5億リクエスト以内の場合に適しています

4. 画面下部のナビゲーションボタンで、**「Next」** ボタン（オレンジ色）をクリック
   - 「キャンセル（Cancel）」ボタンで設定をキャンセルすることもできます

**設定例（本番環境）:**

- **選択するプラン**: `Pay as you go`（推奨）
  - または、トラフィック量が予測可能な場合は `Business` プラン

**確認ポイント:**
- ✅ 希望するプランのラジオボタンが選択されている
- ✅ プランの料金と使用量制限を確認している
- ✅ 本番環境のAWSアカウントにログインしている

**本番環境での注意事項:**
- プランは後で変更可能ですが、本番環境では慎重に選択してください
- 「Pay as you go」を選択した場合、使用量に応じて課金されます
- 固定プランを選択した場合、月額料金がかかりますが、使用量制限内であれば追加料金はかかりません
- 使用量制限を超えた場合、追加料金が発生する可能性があります
- 本番環境では、Freeプランは使用しないでください（使用量制限が少なすぎます）

#### 1.0.1 開始（Get started）

このステップでは、ディストリビューションの基本情報を設定します。

**⚠️ 本番環境での注意事項:**
- Distribution nameは、本番環境であることが分かる名前にしてください（例: `photo-gallery-production`）
- カスタムドメインを使用する場合は、事前にRoute 53でドメインを登録しておく必要があります
- 本番環境では、カスタムドメインを使用することを推奨します（例: `journey-photo.com`）

**画面の確認:**
- 画面の上部に「Get started」というタイトルが表示されています
- 左側のサイドバーで「ステップ2 Get started」がハイライト表示されています
- 画面の説明文: "Connect your websites, apps, files, video streams, and other content to CloudFront. We optimize the performance, reliability, and security for your web traffic."

**設定手順:**

1. **「Distribution options（ディストリビューションオプション）」** セクション：
   
   - セクションタイトルの横に**「情報」**リンク（青いテキスト）が表示されています
   - 「情報」リンクをクリックすると、このセクションに関する詳細情報が表示されます
   - ⚠️ **本番環境では、各設定項目の意味を理解してから設定してください**
   
   **Distribution name（ディストリビューション名）:**
   - ラベルの横に**「情報」**リンク（青いテキスト）が表示されています
   - 「情報」リンクをクリックすると、このフィールドに関する詳細情報が表示されます
   - フィールドの下に、ヘルパーテキストが表示されています: **"Name will be stored as a tag on the resource. You can change the name, or more tags, later."**
     - この名前は、リソースにタグとして保存されます
     - 後で変更可能ですが、本番環境では慎重に設定してください
   - テキスト入力フィールドに、**本番環境であることが分かる名前**を入力します
   - **本番環境での入力例**: `photo-gallery-production` または `journey-photo-production`
     - ⚠️ **重要**: 本番環境であることが分かる名前にしてください
     - 開発環境やステージング環境と区別できるようにしてください
     - 画像の例では、`PhotoGalleryProduction` が入力されています
   - ⚠️ **必須項目**です（空欄にすると、入力フィールドの下に赤いエラーメッセージが表示されます）
     - エラーメッセージ: **"このフィールドを空白にすることはできません。"**（This field cannot be left blank.）
     - エラーが表示されている場合は、Distribution nameを入力してから「Next」ボタンをクリックしてください
   - 入力フィールドは、テキストを入力すると自動的に検証されます

   **Description - optional（説明 - オプション）:**
   - ラベル: **"Description - optional"**
   - テキスト入力フィールドに、任意の説明を入力します
   - **入力例**: `Photo Gallery Production Distribution` など、分かりやすい説明
   - ⚠️ **任意項目**（空欄でも可、必須ではありません）
   - 本番環境では、このディストリビューションの目的や用途を記載することを推奨します
   - 例: `Production distribution for photo gallery application`、`Static site and API distribution for journey-photo.com` など

   **Distribution type（ディストリビューションタイプ）:**
   - 2つのラジオボタンオプションが表示されています：
     - **「Single website or app」**: このオプションが**選択されています**（デフォルト）
       - ラジオボタンが**青く塗りつぶされて**います（選択状態）
       - オプションの周りに**青い枠**が表示されています（選択されていることを示す視覚的なインジケーター）
       - 説明文: **"Choose if each website or application will have a unique configuration."**
       - 各ウェブサイトやアプリケーションに固有の設定が必要な場合に選択します
       - ⚠️ **本番環境では、通常このオプションを選択します**
       - このプロジェクトでは、このオプションを選択します
     - **「Multi-tenant architecture - New」**: このオプションは**グレーアウト（無効）**になっています
       - ラジオボタンが**グレーアウト**されています（選択できない状態）
       - オプションの周りに**グレーの枠**が表示されています（無効状態を示す視覚的なインジケーター）
       - 説明文: **"Choose when you have multiple domains that need to share configurations. This is a common architecture for SaaS providers."**
       - 複数のドメインで設定を共有する必要がある場合に選択します（SaaSプロバイダー向け）
       - ⚠️ **このプロジェクトでは使用しません**（通常のWebサイトやアプリケーションでは不要）
       - このオプションは、将来的に複数のドメインで同じ設定を共有する必要がある場合に使用します

2. **「Domain（ドメイン）」** セクション：
   
   - セクションタイトルの横に**「情報」**リンク（青いテキスト）が表示されています
   - 「情報」リンクをクリックすると、このセクションに関する詳細情報が表示されます
   
   **Route 53 managed domain - optional（Route 53で管理されているドメイン - オプション）:**
   - ラベルの下に、詳細なヘルパーテキストが表示されています: **"Enter a domain that's already registered with Route 53 in your AWS account. CloudFront will provision a TLS certificate for you. If you have a domain from a different DNS provider, skip this step and configure your domain later."**
     - Route 53で登録済みのドメインを入力すると、CloudFrontが自動的にTLS証明書をプロビジョニングします
     - 他のDNSプロバイダー（Route 53以外）を使用している場合は、このステップをスキップして、後でドメインを設定できます
   - テキスト入力フィールドが表示されています
   - **カスタムドメインを使用しない場合:**
     - **空欄のまま**にしてください（変更不要）
     - このプロジェクトでは、カスタムドメインを使用しない場合を想定しています
     - 空欄のままでも、次のステップに進むことができます
   - **カスタムドメインを使用する場合:**
     - Route 53で登録済みのドメインを入力します（例: `journey-photo.com`）
       - ⚠️ **重要**: `https://` や `http://` は含めないでください（ドメイン名のみ）
       - 例: `journey-photo.com`（正しい）、`https://journey-photo.com`（間違い）
     - **「Check domain」** ボタンが表示されています
       - ドメインを入力すると、ボタンが**有効**になります（グレーアウトが解除されます）
       - ドメインが空欄の場合は、ボタンが**グレーアウト（無効）**になっています
       - **「Check domain」** ボタンをクリックして、ドメインが正しく登録されているか確認します
       - ドメインが正しく登録されている場合、成功メッセージが表示されます
       - ドメインが登録されていない場合、エラーメッセージが表示されます
     - CloudFrontが自動的にTLS証明書をプロビジョニングします
     - 証明書の取得には数分かかる場合があります
     - 他のDNSプロバイダー（Route 53以外）を使用している場合は、このステップをスキップして、後でドメインを設定できます
     - **「Domains to serve（配信するドメイン）」** セクションが表示されます
       - タイトル: **"Domains to serve"**
       - 説明文: **"CloudFront will serve these domains. They must all be covered by the above hosted zone. You can add more later."**
         - CloudFrontが配信するドメインの一覧が表示されます
         - すべてのドメインは、上記のホストゾーン（Route 53）で管理されている必要があります
         - 後で追加することもできます
       - **プライマリドメイン**: 入力したドメイン（例: `journey-photo.com`）が表示されます
         - このドメインは、Route 53で登録されているドメインです
         - 静的テキストとして表示され、削除できません
       - **サブドメインの追加:**
         - サブドメイン（例: `www`）を追加する場合は、入力フィールドにサブドメイン名を入力します
         - 入力例: `www`（`www.journey-photo.com` を作成する場合）
         - 入力フィールドの右側に、完全なドメイン名が表示されます（例: `.journey-photo.com`）
         - 完全なドメイン名の右側に、**「削除」**ボタン（青いボタン）が表示されます
         - 「削除」ボタンをクリックすると、そのサブドメインを削除できます
         - **「Add a subdomain」** ボタン（青いボタン）をクリックすると、追加のサブドメインを追加できます
         - 例: `www.journey-photo.com`、`api.journey-photo.com` など
       - ⚠️ **本番環境での注意事項:**
         - プライマリドメイン（例: `journey-photo.com`）は必須です
         - サブドメイン（例: `www.journey-photo.com`）は任意ですが、一般的に `www` サブドメインを追加することを推奨します
         - すべてのドメインは、Route 53で管理されている必要があります
         - 後でドメインを追加することもできますが、本番環境では事前に必要なドメインをすべて設定することを推奨します

3. **「Tags - optional（タグ - オプション）」** セクション：
   - セクションタイトルの左側に**右向きの三角形アイコン（►）**が表示されています
   - このアイコンは、セクションが**折りたたまれている**ことを示しています
   - セクションタイトルをクリックすると、セクションが展開され、タグの追加フォームが表示されます
   - ⚠️ **任意項目**（空欄でも可、必須ではありません）
   - **タグの追加方法:**
     - セクションを展開すると、「Key」と「Value」の入力フィールドが表示されます
     - 「Key」にタグのキーを入力します（例: `Environment`）
     - 「Value」にタグの値を入力します（例: `Production`）
     - 「Add tag」ボタンをクリックして、タグを追加します
     - 複数のタグを追加する場合は、上記の手順を繰り返します
   - **本番環境での推奨タグ:**
     - `Environment: Production`（環境を識別）
     - `Project: PhotoGallery`（プロジェクト名）
     - `ManagedBy: CloudFormation`（管理方法、使用している場合）
     - `CostCenter: Engineering`（コストセンター、使用している場合）
   - タグは、リソースの管理、コスト追跡、アクセス制御などに使用されます
   - 本番環境では、適切なタグを設定することで、リソースの管理が容易になります

4. 画面下部のナビゲーションボタンで、**「Next」** ボタン（オレンジ色）をクリック
   - 「キャンセル（Cancel）」ボタンで設定をキャンセルすることもできます

**設定例（本番環境）:**

- **Distribution name**: `photo-gallery-production` または `journey-photo-production`
- **Description**: `Photo Gallery Production Distribution`（任意）
- **Distribution type**: `Single website or app`（選択済み、デフォルト）
- **Route 53 managed domain**: （空欄 - カスタムドメインを使用しない場合）
  - または、`journey-photo.com`（カスタムドメインを使用する場合）
- **Tags**: （空欄 - 任意）
  - または、`Environment: Production`, `Project: PhotoGallery`（タグを追加する場合）

**確認ポイント（本番環境）:**
- ✅ Distribution nameが入力されている（空欄ではない）
- ✅ Distribution nameが本番環境であることが分かる名前になっている
- ✅ Distribution typeが「Single website or app」になっている（ラジオボタンが青く選択されている）
- ✅ Route 53 managed domainが空欄になっている（カスタムドメインを使用しない場合）
- ✅ カスタムドメインを使用する場合は、「Check domain」ボタンで確認済み

**エラーが表示された場合:**
- **Distribution nameが空欄の場合:**
  - 入力フィールドの下に赤いエラーメッセージが表示されます
  - エラーメッセージ: **"このフィールドを空白にすることはできません。"**（This field cannot be left blank.）
  - エラーメッセージが表示されている場合は、Distribution nameを入力してから「Next」ボタンをクリックしてください
- **Route 53 managed domainでエラーが表示された場合:**
  - 「Check domain」ボタンをクリックした際に、ドメインが登録されていない場合はエラーメッセージが表示されます
  - Route 53でドメインを登録するか、このフィールドを空欄のままにしてください

**本番環境での注意事項:**
- Distribution nameは、後で変更可能ですが、本番環境では慎重に設定してください
- カスタムドメインを使用する場合は、事前にRoute 53でドメインを登録しておく必要があります
- タグは、リソースの管理に役立ちますが、必須ではありません

#### 1.1 静的サイト用オリジン（Specify origin）

このステップでは、静的サイトをホストしているS3バケットをオリジンとして設定します。

**画面の確認:**
- 画面の上部に「Specify origin」というタイトルが表示されています
- 左側のサイドバーで「ステップ3 Specify origin」がハイライト表示されています

**設定手順:**

1. **「Origin type（オリジンタイプ）」** セクション：
   - このセクションには、6つのオリジンタイプのオプションが表示されています
   - **「Amazon S3」** のラジオボタンを選択（クリック）
     - 説明文: "Deliver static assets like files and images, statically generated websites or single page applications (SPA)."
     - 静的アセット（ファイルや画像）、静的生成されたウェブサイト、シングルページアプリケーション（SPA）を配信する場合に選択します
     - ⚠️ このオプションを選択すると、ラジオボタンが青くなり、ボックスに青い枠が表示されます

2. **「Origin（オリジン）」** セクション：
   
   **S3 origin:**
   - 説明文: "Choose an AWS origin, or enter your origin's domain name. Learn more [リンクアイコン]"
   - テキスト入力フィールドに、S3バケットのドメイン名を入力します
   - **入力例**: `journey-photo.com.s3.ap-northeast-1.amazonaws.com`
     - ⚠️ **重要**: `https://` は含めないでください（ドメイン名のみ）
     - 形式: `{バケット名}.s3.{リージョン}.amazonaws.com`
     - リージョンは `ap-northeast-1` です
   - または、**「Browse S3」** ボタンをクリックして、S3バケット一覧から選択することもできます
     - 「Browse S3」をクリックすると、S3バケット一覧が表示されます
     - `journey-photo.com` を選択してクリック
     - 自動的にドメイン名が入力されます

   **Origin path - optional:**
   - 説明文: "The directory path within your origin where your content is stored. Learn more [リンクアイコン]"
   - **空欄のまま**（変更不要）
   - コンテンツがS3バケットのルートディレクトリにある場合、パスは不要です
   - 例: コンテンツが `s3://journey-photo.com/` にある場合、Origin pathは空欄のまま
   - 例: コンテンツが `s3://journey-photo.com/static/` にある場合、Origin pathに `/static` を入力

3. **「Settings（設定）」** セクション：
   
   **Allow private S3 bucket access to CloudFront:**
   - 説明文: "CloudFront will update your S3 bucket policy to allow CloudFront to access your S3 bucket. The policy allows CloudFront to access the bucket only when the request is on behalf of the CloudFront distribution that contains the S3 origin."
   - **チェックボックスをオンにする**（推奨）
     - ラベル: "Allow private S3 bucket access to CloudFront - Recommended"
     - ⚠️ **重要**: このオプションを有効にすると、CloudFrontが自動的にS3バケットポリシーを更新し、CloudFrontからのアクセスを許可します
     - セキュリティのため、このオプションを有効にすることを強く推奨します
     - このオプションを有効にしない場合、S3バケットを公開する必要があり、セキュリティリスクが高まります

   **オリジン設定（Origin settings）:**
   - 説明文: "Origin settings control how CloudFront connects to the specified origin."
   - **「Use recommended origin settings」** を選択（デフォルト、ラジオボタン）
     - S3オリジンに最適化された推奨設定が自動的に適用されます
     - 通常、このオプションを選択することを推奨します
   - 「Customize origin settings」を選択する場合:
     - 詳細なオリジン設定をカスタマイズできます
     - 通常は不要です

   **Cache settings:**
   - 説明文: "Cache settings determine when CloudFront serves cached content and when it fetches new content from the origin."
   - **「Use recommended cache settings tailored to serving S3 content」** を選択（デフォルト、ラジオボタン）
     - S3コンテンツの配信に最適化されたキャッシュ設定が自動的に適用されます
     - 静的コンテンツに適したキャッシュポリシー（`CachingOptimized`）が設定されます
   - 「Customize cache settings」を選択する場合:
     - 詳細なキャッシュ設定をカスタマイズできます
     - 通常は不要です

4. 画面下部のナビゲーションボタンで、**「Next」** ボタン（オレンジ色）をクリック
   - 「戻る（Back）」ボタンで前のステップに戻ることもできます
   - 「キャンセル（Cancel）」ボタンで設定をキャンセルすることもできます

**設定例:**

- **Origin type**: `Amazon S3`（選択済み）
- **S3 origin**: `journey-photo.com.s3.ap-northeast-1.amazonaws.com`
- **Origin path**: （空欄）
- **Allow private S3 bucket access to CloudFront**: ✅ チェック済み
- **Origin settings**: `Use recommended origin settings`（選択済み）
- **Cache settings**: `Use recommended cache settings tailored to serving S3 content`（選択済み）

**確認ポイント:**
- ✅ 「Amazon S3」が選択されている（ラジオボタンが青い）
- ✅ S3バケットのドメイン名が正しく入力されている
- ✅ 「Allow private S3 bucket access to CloudFront」のチェックボックスがオンになっている
- ✅ 推奨設定が選択されている

**注意事項:**
- S3バケットのドメイン名は、S3コンソールのバケット詳細ページで確認できます
- 「Browse S3」ボタンを使用すると、ドメイン名を手動で入力する必要がなくなります
- 「Allow private S3 bucket access to CloudFront」を有効にすると、後でS3バケットポリシーを手動で更新する必要がなくなります（CloudFrontが自動的に更新します）

#### 1.1.1 セキュリティの有効化（Enable security）

このステップでは、Web Application Firewall (WAF) の設定を行います。

**画面の確認:**
- 画面の上部に「Enable security」というタイトルが表示されています
- 左側のサイドバーで「ステップ4 Enable security」がハイライト表示されています

**設定手順:**

1. **「Web Application Firewall (WAF)」** セクション：
   - セクションタイトルの横に**「情報」**リンクが表示されています
   - 「情報」リンクをクリックすると、WAFに関する詳細情報が表示されます
   - 説明文: **"Security protections from WAF are included in your plan at no additional charge."**
   - WAFのセキュリティ保護機能は、選択したプランに含まれています（追加料金なし）
   - 基本的なWAF保護が自動的に有効になります
   
   **「セキュリティ保護を有効にする（Enable security protection）」オプション:**
   - 青い円形のラジオボタンまたはトグルスイッチが表示されています
   - ラジオボタンが**選択されている**（青く塗りつぶされている）場合、セキュリティ保護が有効になっています
   - タイトル: **"セキュリティ保護を有効にする"**（Enable security protection）
   - 説明文:
     - **"AWS WAF を使用して、最も一般的なウェブの脅威やセキュリティの脆弱性からアプリケーションを保護します。"**
       - AWS WAFを使用して、最も一般的なWebの脅威やセキュリティの脆弱性からアプリケーションを保護します
     - **"ブロックされたリクエストは、ウェブサーバーに到達する前に停止されます。"**
       - ブロックされたリクエストは、Webサーバーに到達する前に停止されます
       - 本番環境では、この機能により、悪意のあるリクエストがオリジンサーバーに到達する前にブロックされます
   - ⚠️ **本番環境では、このオプションを有効にすることを強く推奨します**（通常、デフォルトで有効になっています）
   - このオプションを無効にすると、WAFの保護が無効になり、セキュリティリスクが高まります

   **セキュリティ保護機能が含まれています（展開可能なセクション）:**
   - 「▼ セキュリティ保護機能が含まれています」という見出しをクリックすると、詳細が表示されます
   - 以下の3つの機能が含まれています：
     - "Web アプリケーションに見られる最も一般的な脆弱性から保護します。"（Protects against the most common vulnerabilities found in web applications.）
     - "悪意のある攻撃者がアプリケーションの脆弱性を発見することを阻止します。"（Prevents malicious attackers from discovering application vulnerabilities.）
     - "Amazon 内部の脅威インテリジェンスに基づいて IP アドレスを潜在的な脅威からブロック"（Blocks IP addresses from potential threats based on Amazon's internal threat intelligence.）

   **Use monitor mode（モニターモードを使用）:**
   - チェックボックスが表示されています
   - 説明文: "Count how many of your requests would be blocked by this WAF configuration. When ready, you can disable monitor mode to begin blocking requests."
   - **チェックボックスはオフのまま**（変更不要）
   - モニターモードを有効にすると、ブロックされるリクエストの数をカウントするだけで、実際にはブロックしません
   - 本番環境では、モニターモードをオフにして、実際にブロックすることを推奨します
   - 開発・テスト段階では、モニターモードを有効にして、ブロックされるリクエストの数を確認することもできます

   **Protection against Layer 7 DDoS attacks（レイヤー7 DDoS攻撃に対する保護）:**
   - ラジオボタンまたはトグルスイッチが表示されていますが、**グレーアウト（無効）**になっています
   - ラベル: "Protection against Layer 7 DDoS attacks"
   - 右側に灰色のピル型ラベル: "Available with the Business plan."
   - 説明文: "Stops DDoS attacks within seconds. AWS learns your unique application patterns within minutes of activation, accurately distinguishing between attacks and natural traffic surges."
   - **Businessプラン以上で利用可能**です
   - FreeまたはProプランを使用している場合は、このオプションは選択できません（グレーアウト表示）
   - 必要に応じて、**「Change plan」** リンク（青いテキスト）をクリックしてプランを変更できます
   - このプロジェクトでは、通常このオプションは不要です

2. 画面下部のナビゲーションボタンで、**「Next」** ボタン（オレンジ色）をクリック
   - 「戻る（Back）」ボタンで前のステップに戻ることもできます
   - 「キャンセル（Cancel）」ボタンで設定をキャンセルすることもできます

**設定例:**

- **Use monitor mode**: ❌ チェックなし（オフ）
- **Protection against Layer 7 DDoS attacks**: （利用不可 - Businessプラン以上が必要）

**確認ポイント（本番環境）:**
- ✅ 「セキュリティ保護を有効にする」オプションが選択されている（ラジオボタンが青く選択されている）
- ✅ WAFのセキュリティ保護機能が有効になっている（プランに含まれている）
- ✅ Use monitor modeがオフになっている（本番環境の場合）

**注意事項:**
- 「セキュリティ保護を有効にする」オプションは、通常デフォルトで有効になっています
- 本番環境では、このオプションを無効にしないでください（セキュリティリスクが高まります）
- WAFの保護機能は、選択したプランに自動的に含まれています（追加料金なし）
- モニターモードは、WAFの設定をテストする際に有効にすることができます
- Layer 7 DDoS保護は、Businessプラン以上で利用可能です

#### 1.1.2 TLS証明書の取得（Get TLS certificate）

このステップでは、TLS証明書の設定を行います。

**⚠️ 本番環境での重要事項:**
- TLS証明書は、HTTPS通信を暗号化するために必要です
- カスタムドメインを使用する場合は、AWS Certificate Manager (ACM) で証明書を取得する必要があります
- CloudFrontは、ACMで発行された証明書のみを使用できます（他の証明書プロバイダーの証明書は使用できません）

**画面の確認:**
- 画面の上部に「Get TLS certificate」というタイトルが表示されています
- 左側のサイドバーで「ステップ5 Get TLS certificate」がハイライト表示されています

**設定手順:**

1. **「TLS certificate」** セクション：
   - セクションタイトルの横に**「情報」**リンク（青いテキスト）が表示されています
   - 「情報」リンクをクリックすると、TLS証明書に関する詳細情報が表示されます
   - 説明文: **"Transport layer security (TLS) encrypts communication to and from your domain. You must have a TLS certificate with AWS Certificate Manager (ACM) to use CloudFront."**
     - TLSは、ドメインとの通信を暗号化します
     - CloudFrontを使用するには、AWS Certificate Manager (ACM) でTLS証明書が必要です
   - 右上に**「Refresh certificates」**ボタン（青い枠のボタン）が表示されています
     - このボタンをクリックすると、利用可能な証明書のリストが再読み込みされます
     - 証明書を新規作成した後などに、このボタンを使用してリストを更新します

2. **「Available certificates（利用可能な証明書）」** サブセクション：
   - サブタイトルの横に**「情報」**リンク（青いテキスト）が表示されています
   - 「情報」リンクをクリックすると、利用可能な証明書に関する詳細情報が表示されます
   - 説明文: **"These certificates cover the domains that will be served by this distribution."**
     - これらの証明書は、このディストリビューションによって提供されるドメインをカバーしています
   
   **カスタムドメインを使用しない場合:**
   - **「Use CloudFront default certificate」** のラジオボタンを選択（デフォルトで選択されている場合があります）
     - CloudFrontが提供するデフォルトのSSL証明書を使用します
     - 証明書のドメイン名は、CloudFrontディストリビューションのデフォルトドメイン名になります
     - 例: `d1234567890abc.cloudfront.net`
   - このオプションを選択した状態で、画面下部の**「Next」** ボタン（オレンジ色）をクリック
   - ⚠️ **カスタムドメインを使用しない場合は、このオプションを選択します**

   **カスタムドメインを使用する場合（既存の証明書を選択）:**
   - 利用可能な証明書のリストから、使用する証明書を選択します
   - ラジオボタンが**青く選択されている**証明書が、現在選択されている証明書です
   - 証明書の表示形式: **`{ドメイン名} ({証明書ID})`**
     - 例: `journey-photo.com (d440814c-9af0-4cb1-a467-4be4f18ceeac)`
     - 括弧内は証明書のID（ARNの一部）です
   - ⚠️ **本番環境では、使用するドメインをカバーする証明書を選択してください**
   - 証明書が表示されない場合は、「Refresh certificates」ボタンをクリックしてリストを更新してください

   **カスタムドメインを使用する場合（新しい証明書を作成）:**
   - **「Create a new certificate」** のラジオボタンを選択
   - このオプションを選択すると、新しいTLS証明書をリクエストするプロセスに進みます
   - Route 53で管理されているドメインの場合:
     - CloudFrontが自動的にTLS証明書をプロビジョニングします
     - 証明書の取得には数分かかる場合があります
   - 他のDNSプロバイダーを使用している場合:
     - このステップをスキップして、後で手動で設定する必要があります
     - ACM（AWS Certificate Manager）で証明書を取得し、CloudFrontディストリビューションに設定する必要があります

3. **「Certificate details（証明書の詳細）」** セクション：
   - 証明書を選択すると、このセクションに証明書の詳細情報が表示されます
   - 右上に**「View in AWS Certificate Manager」**ボタン（青い枠のボタン、外部リンクアイコン付き）が表示されています
     - このボタンをクリックすると、AWS Certificate Managerコンソールでこの証明書の詳細を確認できます
   - **ARN（Amazon Resource Name）:**
     - 選択されたTLS証明書のARNが表示されます
     - 例: `arn:aws:acm:us-east-1:463470976368:certificate/d440814c-9af0-4cb1-a467-4be4f18ceeac`
     - ⚠️ **重要**: CloudFrontで使用する証明書は、**`us-east-1`（バージニア北部）リージョン**で発行されている必要があります
     - 他のリージョンで発行された証明書は、CloudFrontで使用できません
   - **Covered domains（カバーされているドメイン）:**
     - この証明書がカバーしているドメインの一覧が表示されます
     - 例:
       - `journey-photo.com`（ルートドメイン）
       - `*.journey-photo.com`（すべてのサブドメイン）
     - ⚠️ **本番環境では、使用するすべてのドメインが証明書でカバーされていることを確認してください**
   - **Source（ソース）:**
     - 証明書の発行元が表示されます
     - 通常、**「Amazon」**と表示されます（AWS Certificate Manager経由で発行された証明書）

4. 画面下部のナビゲーションボタンで、**「Next」** ボタン（オレンジ色）をクリック
   - 「戻る（Back）」ボタンで前のステップに戻ることもできます
   - 「キャンセル（Cancel）」ボタンで設定をキャンセルすることもできます

**設定例（本番環境）:**

- **カスタムドメインを使用しない場合:**
  - **TLS証明書**: `Use CloudFront default certificate`（選択済み）

- **カスタムドメインを使用する場合:**
  - **TLS証明書**: `journey-photo.com (d440814c-9af0-4cb1-a467-4be4f18ceeac)`（選択済み）
  - **Covered domains**: `journey-photo.com`, `*.journey-photo.com`
  - **Source**: `Amazon`

**確認ポイント（本番環境）:**
- ✅ カスタムドメインを使用しない場合は、「Use CloudFront default certificate」が選択されている
- ✅ カスタムドメインを使用する場合は、使用するドメインをカバーする証明書が選択されている
- ✅ 証明書のARNが `us-east-1` リージョンで発行されていることを確認（CloudFrontで使用可能）
- ✅ Covered domainsに、使用するすべてのドメインが含まれていることを確認

**注意事項:**
- CloudFrontのデフォルト証明書を使用する場合、ディストリビューションのデフォルトドメイン名（例: `d1234567890abc.cloudfront.net`）でアクセスできます
- カスタムドメインを使用する場合は、事前にRoute 53でドメインを登録しておく必要があります
- カスタムドメインを使用する場合、DNS設定（CNAMEレコード）も必要です
- ⚠️ **重要**: CloudFrontで使用する証明書は、必ず**`us-east-1`（バージニア北部）リージョン**で発行されている必要があります
  - 他のリージョン（例: `ap-northeast-1`）で発行された証明書は、CloudFrontで使用できません
  - 証明書を新規作成する場合は、必ず `us-east-1` リージョンを選択してください

#### 1.1.3 確認と作成（Review and create）

このステップでは、設定内容を確認してから、CloudFrontディストリビューションを作成します。

**画面の確認:**
- 画面の上部に「Review and create」というタイトルが表示されています
- 左側のサイドバーで「ステップ6 Review and create」がハイライト表示されています

**設定手順:**

1. **設定内容の確認:**
   - 画面に、これまでに設定した内容の要約が表示されます
   - 以下の項目を確認してください：
     - **Distribution name**: 入力した名前（例: `photo-gallery-distribution`）
     - **Origin（オリジン）**: 設定したS3バケット（例: `journey-photo.com.s3.ap-northeast-1.amazonaws.com`）
     - **Security settings（セキュリティ設定）**: WAFの設定
     - **TLS certificate（TLS証明書）**: 選択した証明書（例: `Use CloudFront default certificate`）

2. **設定内容の変更が必要な場合:**
   - 各セクションの横に「編集」リンクが表示されている場合があります
   - 「編集」リンクをクリックすると、該当するステップに戻って設定を変更できます
   - または、「戻る（Back）」ボタンで前のステップに戻ることもできます

3. **ディストリビューションの作成:**
   - 設定内容に問題がなければ、画面下部の**「Create distribution」** ボタン（オレンジ色）をクリック
   - 「キャンセル（Cancel）」ボタンで設定をキャンセルすることもできます

4. **ディストリビューションの作成が開始されます:**
   - 作成が開始されると、CloudFrontディストリビューション一覧ページにリダイレクトされます
   - または、作成中のメッセージが表示されます

5. **デプロイの完了を待つ:**
   - CloudFrontディストリビューション一覧ページで、作成したディストリビューションのステータスを確認します
   - ステータスが **「Deployed（デプロイ済み）」** になるまで待ちます
   - 通常、5-10分かかります
   - ステータスは、ディストリビューション一覧の「Status」列で確認できます
   - ステータスが「Deployed」になるまで、ディストリビューションは使用できません

**確認ポイント:**
- ✅ Distribution nameが正しく設定されている
- ✅ Origin（S3バケット）が正しく設定されている
- ✅ Security settingsが適切に設定されている
- ✅ TLS certificateが選択されている

**注意事項:**
- ⚠️ **重要**: この時点では、静的サイト用のS3オリジンのみが設定されています
- API Gateway用のオリジンとビヘイビアは、ディストリビューション作成後に追加する必要があります（以下の手順1.2以降を参照）
- ディストリビューションの作成後、**Distribution ID** をメモしておいてください（S3バケットポリシーの設定で使用します）
- ディストリビューションの作成後、**Domain Name**（例: `d1234567890abc.cloudfront.net`）をメモしておいてください（環境変数の設定で使用します）

**Distribution IDとDomain Nameの確認方法:**
1. CloudFrontディストリビューション一覧で、作成したディストリビューションをクリック
2. 「一般」タブで、以下の情報を確認：
   - **Distribution ID**: 例: `E1234567890ABC`
   - **Domain Name**: 例: `d1234567890abc.cloudfront.net`

#### 1.2 API Gateway用オリジンの追加

ディストリビューション作成後、API Gateway用のオリジンを追加します。

1. CloudFrontディストリビューション一覧で、作成したディストリビューションを選択
2. 「Origins（オリジン）」タブを開く
3. **「Create origin」** ボタンをクリック
4. **Origin 2（API Gateway）** を追加：
   - 「オリジンを追加」または「Create origin」ボタンをクリック

2. **設定（Settings）** セクションで以下を入力：

   **Origin domain:**
   - API Gatewayのエンドポイントを入力
   - 形式: `xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`
   - 例: `hyd9bpdhuf.execute-api.ap-northeast-1.amazonaws.com`
   - ⚠️ `https://` は含めないでください（ドメイン名のみ）
   - この値は、API Gatewayのステージ詳細ページで確認できます

   **プロトコル（Protocol）:**
   - **「HTTPS のみ（HTTPS only）」** を選択（推奨）
   - API GatewayはHTTPSのみをサポートしているため、この設定が適切です

   **HTTPS port:**
   - `443` のまま（変更不要）
   - デフォルトのHTTPSポートです

   **Minimum Origin SSL protocol:**
   - **「TLSv1.2」** を選択（推奨）
   - セキュリティのため、TLS 1.2以上を要求します

   **Origin path - optional:**
   - **空欄のまま**（変更不要）
   - API Gatewayのエンドポイントにはパスを追加する必要がありません

   **名前（Name）:**
   - `API-Gateway` を入力（任意の名前、分かりやすい名前を推奨）
   - または、Origin domainと同じ値でも問題ありません
   - この名前は、後でキャッシュビヘイビアで参照する際に使用します

   **カスタムヘッダーを追加 - オプション（Add custom headers - optional）:**
   - **追加不要**（空欄のまま）
   - 通常、API Gateway用オリジンにはカスタムヘッダーは不要です

   **Enable Origin Shield:**
   - **「いいえ（No）」** を選択（デフォルト）
   - API Gatewayはグローバルに分散されているため、Origin Shieldは通常不要です

3. 「作成（Create）」ボタンをクリック

**設定例:**

- **Origin domain**: `hyd9bpdhuf.execute-api.ap-northeast-1.amazonaws.com`
- **プロトコル**: `HTTPS のみ`
- **HTTPS port**: `443`
- **Minimum Origin SSL protocol**: `TLSv1.2`
- **Origin path**: （空欄）
- **名前**: `API-Gateway`
- **カスタムヘッダー**: （追加なし）
- **Enable Origin Shield**: `いいえ`

**注意事項:**
- Origin domainには `https://` プレフィックスを含めないでください
- API Gatewayのエンドポイントは、リージョンごとに異なります（例: `ap-northeast-1`）
- プロトコルは必ず「HTTPS のみ」を選択してください（API GatewayはHTTPSのみをサポート）

#### 1.3 デフォルトのキャッシュビヘイビア（静的サイト用）

デフォルトのキャッシュビヘイビアは、静的サイト（S3）用に設定します。このビヘイビアは、他のビヘイビアにマッチしないすべてのリクエスト（`Default (*)`）に適用されます。

**設定手順:**

1. CloudFrontディストリビューション作成画面で、**「Default Cache Behavior」** セクションを確認

2. **設定（Settings）** セクション：
   - **Path pattern（パスパターン）**: `Default (*)` のまま（変更不要）
     - これは、他のビヘイビアにマッチしないすべてのリクエストに適用されます
   - **Origin and Origin Group（オリジンとオリジングループ）**: `S3-journey-photo.com` を選択
     - 静的サイト用のS3オリジンを選択します
   - **Automatically compress objects（オブジェクトを自動的に圧縮）**: **「はい（Yes）」** を選択（推奨）
     - GzipやBrotli圧縮により、転送サイズを削減できます

3. **ビューワー（Viewer）** セクション：
   - **Viewer Protocol Policy（ビューワープロトコルポリシー）**: **「Redirect HTTP to HTTPS」** を選択（推奨）
     - HTTPリクエストをHTTPSにリダイレクトします
   - **Allowed HTTP Methods（許可された HTTP メソッド）**: **「GET, HEAD, OPTIONS」** を選択
     - 静的サイトには読み取り専用のメソッドのみが必要です
   - **Cache HTTP Methods（HTTP メソッドをキャッシュ）**: **チェックボックスはオフのまま**（変更不要）
     - 説明文: "GET メソッドと HEAD メソッドはデフォルトでキャッシュされます。"
     - このオプションは、選択したHTTPメソッドに基づいてキャッシュを制御する追加設定です
     - デフォルトの動作（GET/HEADは自動的にキャッシュ）で十分なため、チェックを入れる必要はありません
   - **Allow gRPC requests over HTTP/2（HTTP/2 経由の gRPC リクエストを許可する）**: **チェックボックスはオフのまま**（変更不要）
     - このプロジェクトではREST API（HTTP/1.1）を使用しており、gRPCは使用していません
     - gRPC over HTTP/2を有効にする必要はありません
   - **Restrict Viewer Access（ビューワーのアクセスを制限する）**: **「いいえ（No）」** を選択
     - 公開サイトのため、アクセス制限は不要です

4. **キャッシュキーとオリジンリクエスト（Cache Key and Origin Requests）** セクション：
   - **Cache policy and origin request policy (recommended)** を選択（ラジオボタン）
   - **Cache Policy（キャッシュポリシー）**: **「CachingOptimized」** を選択
     - 説明: "Policy with caching enabled. Supports Gzip and Brotli compression."
     - 推奨: "Recommended for S3"
     - 静的コンテンツに最適化されたキャッシュポリシーです
   - **Origin Request Policy（オリジンリクエストポリシー）**: **選択しない**（空欄のまま）
     - 静的サイトには通常不要です
   - **Response Headers Policy（レスポンスヘッダーポリシー）**: **選択しない**（空欄のまま）
     - 必要に応じて後で追加できます

5. **関数の関連付け（Function Associations）** セクション：
   - すべて **「関連付けなし（None associated）」** のまま（変更不要）
   - Lambda@Edge関数は通常不要です

**設定例（デフォルトビヘイビア）:**

- **Path pattern**: `Default (*)`
- **Origin**: `S3-journey-photo.com`
- **Automatically compress objects**: `はい`
- **Viewer Protocol Policy**: `Redirect HTTP to HTTPS`
- **Allowed HTTP Methods**: `GET, HEAD, OPTIONS`
- **Cache Policy**: `CachingOptimized`
- **Origin Request Policy**: （選択なし）
- **Response Headers Policy**: （選択なし）

#### 1.4 キャッシュビヘイビアの追加（API用）

API Gateway用の新しいキャッシュビヘイビアを作成します。このビヘイビアは、`/api/*` パスにマッチするリクエストをAPI Gatewayに転送します。

**設定手順:**

1. CloudFrontディストリビューション作成画面で、**「Behaviors」** タブを開く
   - または、既存のディストリビューションを編集する場合は、「Behaviors」タブから「Create behavior」をクリック

2. **設定（Settings）** セクション：
   - **Path pattern（パスパターン）**: `/api/*` を入力
     - ⚠️ 先頭の `/` を含めてください
     - `*` はワイルドカードで、`/api/` で始まるすべてのパスにマッチします
     - 例: `/api/photos`, `/api/upload/presigned-url` など
   - **Origin and Origin Group（オリジンとオリジングループ）**: **「API-Gateway」** を選択
     - 上記で作成したAPI Gateway用オリジンを選択します
   - **Automatically compress objects（オブジェクトを自動的に圧縮）**: **「はい（Yes）」** を選択（推奨）
     - APIレスポンスも圧縮することで、転送サイズを削減できます

3. **ビューワー（Viewer）** セクション：
   - **Viewer Protocol Policy（ビューワープロトコルポリシー）**: **「Redirect HTTP to HTTPS」** を選択（推奨）
     - APIリクエストもHTTPSを強制します
   - **Allowed HTTP Methods（許可された HTTP メソッド）**: **「GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE」** を選択
     - ⚠️ **重要**: API Gatewayでは、`POST`（アップロード）、`PUT`（更新）、`DELETE`（削除）が必要です
     - デフォルトの `GET, HEAD, OPTIONS` だけでは不十分です
   - **Cache HTTP Methods（HTTP メソッドをキャッシュ）**: **チェックボックスはオフのまま**（変更不要）
     - 説明文: "GET メソッドと HEAD メソッドはデフォルトでキャッシュされます。"
     - ⚠️ **重要**: API用のビヘイビアでは、このオプションは**オフのまま**にしてください
     - APIレスポンスは動的なため、キャッシュポリシーで `CachingDisabled` を選択しているため、このオプションを有効にする必要はありません
     - このオプションは、選択したHTTPメソッドに基づいてキャッシュを制御する追加設定ですが、API用には不要です
   - **Allow gRPC requests over HTTP/2（HTTP/2 経由の gRPC リクエストを許可する）**: **チェックボックスはオフのまま**（変更不要）
     - このプロジェクトではREST API（HTTP/1.1）を使用しており、gRPCは使用していません
     - API GatewayはREST APIとして動作するため、gRPC over HTTP/2を有効にする必要はありません
   - **Restrict Viewer Access（ビューワーのアクセスを制限する）**: **「いいえ（No）」** を選択
     - API Gateway側でCognito JWT認証を行っているため、CloudFront側でのアクセス制限は不要です

4. **キャッシュキーとオリジンリクエスト（Cache Key and Origin Requests）** セクション：
   - **Cache policy and origin request policy (recommended)** を選択（ラジオボタン）
   - **Cache Policy（キャッシュポリシー）**: **「CachingDisabled」** を選択
     - ⚠️ **重要**: APIレスポンスは動的なため、キャッシュを無効化する必要があります
     - `CachingOptimized` を選択すると、APIレスポンスがキャッシュされ、最新データが取得できなくなります
   - **Origin Request Policy（オリジンリクエストポリシー）**: **選択しない**（空欄のまま）
     - 通常、API Gatewayには追加のリクエストヘッダーは不要です
   - **Response Headers Policy（レスポンスヘッダーポリシー）**: **選択しない**（空欄のまま）
     - CORSヘッダーはAPI Gateway側で設定されているため、通常不要です

5. **関数の関連付け（Function Associations）** セクション：
   - すべて **「関連付けなし（None associated）」** のまま（変更不要）
   - Lambda@Edge関数は通常不要です

6. **「Create behavior」** または **「Save changes」** ボタンをクリック

**設定例（API用ビヘイビア）:**

- **Path pattern**: `/api/*`
- **Origin**: `API-Gateway`
- **Automatically compress objects**: `はい`
- **Viewer Protocol Policy**: `Redirect HTTP to HTTPS`
- **Allowed HTTP Methods**: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`
- **Cache Policy**: `CachingDisabled`
- **Origin Request Policy**: （選択なし）
- **Response Headers Policy**: （選択なし）

#### 1.4.1 ビヘイビア一覧の確認

ビヘイビアを作成した後、CloudFrontディストリビューションの「Behaviors（ビヘイビア）」タブで、設定したビヘイビアが正しく表示されていることを確認します。

**確認手順:**

1. CloudFrontディストリビューションの詳細ページで、「Behaviors（ビヘイビア）」タブを開く

2. ビヘイビア一覧に、以下の2つのビヘイビアが表示されていることを確認：

   **ビヘイビア1（API用）:**
   - **優先順位（Priority）**: `0`（最優先）
   - **パスパターン（Path Pattern）**: `/api/*`
   - **オリジン（Origin）**: `APIGateway` または `API-Gateway`
   - **ビューワープロトコル（Viewer Protocol）**: `HTTP を HTTPS...`（HTTP to HTTPS リダイレクト）
   - **キャッシュポリシー（Cache Policy）**: `Managed-CachingDisa`（CachingDisabled）
   - **オリジン（Origin）**: `-`（ハイフン）

   **ビヘイビア2（デフォルト - 静的サイト用）:**
   - **優先順位（Priority）**: `1`（2番目の優先順位）
   - **パスパターン（Path Pattern）**: `デフォルト(*)` または `Default (*)`
   - **オリジン（Origin）**: `S3-journey-photo.com` または `S3-journey-phot...`
   - **ビューワープロトコル（Viewer Protocol）**: `HTTP を HTTPS...`（HTTP to HTTPS リダイレクト）
   - **キャッシュポリシー（Cache Policy）**: `Managed-CachingOpt`（CachingOptimized）
   - **オリジン（Origin）**: `-`（ハイフン）

**優先順位の重要性:**

- **優先順位0（`/api/*`）**: より具体的なパターンで、**先に評価**されます
  - `/api/photos`、`/api/upload/presigned-url` などのリクエストは、このビヘイビアにマッチします
  - API Gatewayに転送され、キャッシュは無効化されます

- **優先順位1（`Default (*)`）**: デフォルトのビヘイビアで、**最後に評価**されます
  - `/api/*` にマッチしないすべてのリクエスト（例: `/`, `/gallery`, `/about` など）は、このビヘイビアにマッチします
  - S3バケット（静的サイト）に転送され、キャッシュが最適化されます

**確認ポイント:**

- ✅ API用のビヘイビア（`/api/*`）が優先順位0になっている
- ✅ デフォルトのビヘイビア（`Default (*)`）が優先順位1になっている
- ✅ API用のビヘイビアのキャッシュポリシーが `CachingDisabled` になっている
- ✅ デフォルトのビヘイビアのキャッシュポリシーが `CachingOptimized` になっている

**優先順位の変更方法:**

必要に応じて、「上へ移動」または「下へ移動」ボタンを使用して優先順位を変更できます。ただし、通常は以下の順序が正しいです：

1. より具体的なパターン（例: `/api/*`）→ 優先順位0
2. デフォルトパターン（`Default (*)`）→ 優先順位1（最後）

**注意事項:**
- **Path pattern の優先順位**: より具体的なパターン（例: `/api/photos`）が、より一般的なパターン（例: `/api/*`）より優先されます
- **Allowed HTTP Methods**: API Gateway用のビヘイビアでは、必ず `POST`, `PUT`, `DELETE` を含めてください
- **Cache Policy**: API用のビヘイビアでは、必ず `CachingDisabled` を選択してください。`CachingOptimized` を選択すると、APIレスポンスがキャッシュされ、最新データが取得できなくなります
- **優先順位の順序**: API用のビヘイビア（`/api/*`）がデフォルトのビヘイビア（`Default (*)`）より**先に評価される**必要があります。順序が逆になっている場合は、「上へ移動」ボタンで修正してください

#### 1.5 ディストリビューションの作成（Review and create）

このステップでは、これまでに設定したすべての内容を確認してから、CloudFrontディストリビューションを作成します。

**⚠️ 本番環境での注意事項:**
- このステップは、ディストリビューションを作成する**最後のステップ**です
- 設定内容を慎重に確認してから、作成ボタンをクリックしてください
- 本番環境では、すべての設定が正しいことを確認することが重要です
- ディストリビューションの作成後、ステータスが「Deployed」になるまで待ってから使用してください

**画面の確認:**
- 画面の上部に「Review and create」というタイトルが表示されています
- 左側のサイドバーで「ステップ6 Review and create」がハイライト表示されています
- 画面には、これまでに設定した内容の要約が表示されます

**設定手順:**

1. **設定内容の確認:**

   画面に表示される各セクションの設定内容を確認します。以下の項目が表示されます：

   **1.1 Distribution name（ディストリビューション名）:**
   - 入力した名前が表示されます（例: `photo-gallery-production`）
   - 本番環境であることが分かる名前になっているか確認してください
   - 必要に応じて、「編集」リンクをクリックして変更できます

   **1.2 Origin（オリジン）:**
   - 設定したオリジンが表示されます
   - **静的サイト用S3オリジン**: `journey-photo.com.s3.ap-northeast-1.amazonaws.com`
   - ⚠️ **重要**: この時点では、静的サイト用のS3オリジンのみが表示されています
   - API Gateway用のオリジンは、ディストリビューション作成後に追加する必要があります（手順1.2を参照）
   - 必要に応じて、「編集」リンクをクリックして変更できます

   **1.3 Security settings（セキュリティ設定）:**
   - WAFの設定が表示されます
   - **Use monitor mode**: `オフ`（本番環境では推奨）
   - **Protection against Layer 7 DDoS attacks**: `利用不可` または `利用可能`（プランによって異なります）
   - 必要に応じて、「編集」リンクをクリックして変更できます

   **1.4 TLS certificate（TLS証明書）:**
   - 選択した証明書が表示されます
   - **カスタムドメインを使用しない場合**: `Use CloudFront default certificate`
   - **カスタムドメインを使用する場合**: 取得した証明書のドメイン名が表示されます
   - 必要に応じて、「編集」リンクをクリックして変更できます

2. **追加のディストリビューション設定（Distribution Settings）:**

   画面の下部または右側に、「Distribution Settings（ディストリビューション設定）」セクションが表示されている場合があります。このセクションで、以下の追加設定を行います：

   **Price Class（価格クラス）:**
   - ドロップダウンメニューから選択します
   - **本番環境での推奨設定:**
     - **「Use only North America and Europe」** を選択（推奨）
       - 北米とヨーロッパのエッジロケーションのみを使用し、コストを削減します
       - 日本からのアクセスも十分に高速です
       - 本番環境でコストを最適化したい場合に適しています
     - または、**「Use all edge locations」** を選択
       - すべてのエッジロケーションを使用し、グローバルなパフォーマンスを最大化します
       - アジア太平洋地域からのアクセスが多い場合に適しています
       - コストが高くなります
   - ⚠️ **本番環境では、コストとパフォーマンスのバランスを考慮して選択してください**

   **Alternate Domain Names (CNAMEs)（代替ドメイン名）:**
   - カスタムドメインを使用する場合のみ設定します
   - テキスト入力フィールドに、カスタムドメイン名を入力します
   - **入力例**: `journey-photo.com`, `www.journey-photo.com`
   - ⚠️ **カスタムドメインを使用しない場合は、空欄のまま**にしてください
   - ⚠️ **カスタムドメインを使用する場合の前提条件:**
     - 事前にACM（AWS Certificate Manager）でSSL証明書を取得しておく必要があります
     - Route 53でドメインを登録しておく必要があります
     - DNS設定（CNAMEレコード）を設定する必要があります
   - 複数のドメインを使用する場合は、カンマ区切りで入力します

   **SSL Certificate（SSL証明書）:**
   - ドロップダウンメニューから選択します
   - **カスタムドメインを使用しない場合:**
     - **「Default CloudFront Certificate」** を選択（デフォルト）
     - CloudFrontが提供するデフォルトのSSL証明書を使用します
     - ディストリビューションのデフォルトドメイン名（例: `d1234567890abc.cloudfront.net`）でアクセスできます
     - ⚠️ **本番環境でカスタムドメインを使用しない場合は、この設定のままにしてください**
   - **カスタムドメインを使用する場合:**
     - **「Request or Import a Certificate with ACM」** を選択
       - または、既に取得済みの証明書がある場合は、ドロップダウンから選択します
     - ACMで取得した証明書のドメイン名が表示されます
     - ⚠️ **カスタムドメインを使用する場合は、必ず対応するSSL証明書を選択してください**

   **Default Root Object（デフォルトルートオブジェクト）:**
   - テキスト入力フィールドに、デフォルトのルートオブジェクトを入力します
   - **デフォルト値**: `index.html`
   - ⚠️ **本番環境では、通常 `index.html` のまま**（変更不要）
   - 静的サイトのルートパス（`/`）にアクセスした際に返されるファイルです
   - Next.jsの静的エクスポートでは、`index.html` が生成されるため、この設定が適切です

   **Comment（コメント）:**
   - テキスト入力フィールドに、任意のコメントを入力します
   - **入力例**: `Photo Gallery Production Distribution` など、分かりやすい名前
   - ⚠️ **任意項目**（空欄でも可）
   - 本番環境であることが分かるコメントを入力することを推奨します
   - このコメントは、ディストリビューション一覧で表示されます

   **Web Application Firewall (WAF):**
   - ドロップダウンメニューから選択します
   - **「Do not enable」** を選択（デフォルト）
     - ⚠️ **本番環境では、通常この設定のまま**（変更不要）
     - WAFの設定は、手順1.1.1（Enable security）で既に行っています
     - このセクションでは、追加のWAF設定を有効化する場合に使用します
   - 必要に応じて、後で有効化できます

3. **設定内容の変更が必要な場合:**

   - 各セクションの横に「編集」リンクが表示されている場合があります
   - 「編集」リンクをクリックすると、該当するステップに戻って設定を変更できます
   - または、画面下部の「戻る（Back）」ボタンで前のステップに戻ることもできます
   - ⚠️ **本番環境では、すべての設定を慎重に確認してから、次のステップに進んでください**

4. **ディストリビューションの作成:**

   - 設定内容に問題がなければ、画面下部の**「Create distribution」** ボタン（オレンジ色）をクリックします
   - 「キャンセル（Cancel）」ボタンで設定をキャンセルすることもできます
   - ⚠️ **本番環境では、作成ボタンをクリックする前に、すべての設定を再度確認してください**

5. **ディストリビューションの作成が開始されます:**

   - 作成が開始されると、CloudFrontディストリビューション一覧ページにリダイレクトされます
   - または、作成中のメッセージが表示されます
   - 画面に「Creating distribution...」などのメッセージが表示される場合があります

6. **デプロイの完了を待つ:**

   - CloudFrontディストリビューション一覧ページで、作成したディストリビューションのステータスを確認します
   - ステータスが **「Deployed（デプロイ済み）」** になるまで待ちます
   - ⚠️ **重要**: ステータスが「Deployed」になるまで、ディストリビューションは使用できません
   - **通常、5-10分かかります**（本番環境では、より長くかかる場合があります）
   - ステータスは、ディストリビューション一覧の「Status」列で確認できます
   - ステータスが「In Progress」の間は、設定を変更しないでください

**設定例（本番環境）:**

- **Distribution name**: `photo-gallery-production`
- **Origin**: `journey-photo.com.s3.ap-northeast-1.amazonaws.com`（静的サイト用S3オリジンのみ）
- **Security settings**: `Use monitor mode: オフ`
- **TLS certificate**: `Use CloudFront default certificate`（カスタムドメインを使用しない場合）
- **Price Class**: `Use only North America and Europe`
- **Alternate Domain Names (CNAMEs)**: （空欄 - カスタムドメインを使用しない場合）
- **SSL Certificate**: `Default CloudFront Certificate`（カスタムドメインを使用しない場合）
- **Default Root Object**: `index.html`
- **Comment**: `Photo Gallery Production Distribution`（任意）
- **Web Application Firewall (WAF)**: `Do not enable`

**確認ポイント（本番環境）:**

- ✅ Distribution nameが本番環境であることが分かる名前になっている
- ✅ Origin（S3バケット）が正しく設定されている（`journey-photo.com`）
- ✅ Security settingsが適切に設定されている（Use monitor mode: オフ）
- ✅ TLS certificateが選択されている
- ✅ Price Classが適切に選択されている（コストとパフォーマンスのバランスを考慮）
- ✅ Alternate Domain Names (CNAMEs)が正しく設定されている（カスタムドメインを使用する場合）
- ✅ SSL Certificateが正しく選択されている（カスタムドメインを使用する場合は対応する証明書）
- ✅ Default Root Objectが `index.html` になっている
- ✅ Commentが本番環境であることが分かる内容になっている（任意）

**本番環境での注意事項:**

- ⚠️ **重要**: この時点では、静的サイト用のS3オリジンのみが設定されています
- API Gateway用のオリジンとビヘイビアは、ディストリビューション作成後に追加する必要があります（手順1.2以降を参照）
- ディストリビューションの作成後、**Distribution ID** をメモしておいてください（S3バケットポリシーの設定で使用します）
- ディストリビューションの作成後、**Domain Name**（例: `d1234567890abc.cloudfront.net`）をメモしておいてください（環境変数の設定で使用します）
- ディストリビューションの作成後、ステータスが「Deployed」になるまで待ってから、次のステップ（API Gateway用オリジンの追加）に進んでください

**Distribution IDとDomain Nameの確認方法:**

1. CloudFrontディストリビューション一覧で、作成したディストリビューションをクリック
2. 「一般」タブで、以下の情報を確認：
   - **Distribution ID**: 例: `E1234567890ABC`
     - このIDは、S3バケットポリシーの設定で使用します
   - **Domain Name**: 例: `d1234567890abc.cloudfront.net`
     - このドメイン名は、環境変数 `NEXT_PUBLIC_API_BASE_URL` の設定で使用します
     - CloudFront経由でAPIにアクセスする場合は、`https://d1234567890abc.cloudfront.net/api` に設定します

**エラーが表示された場合:**

- 設定に問題がある場合、エラーメッセージが表示されます
- エラーメッセージを確認して、該当する設定を修正してください
- よくあるエラー:
  - **Distribution nameが空欄**: Distribution nameを入力してください
  - **Originが設定されていない**: Originを設定してください（手順1.1を参照）
  - **SSL証明書が見つからない**: カスタムドメインを使用する場合は、ACMで証明書を取得してください

**注意事項:**
- カスタムドメインを使用する場合は、事前にACMでSSL証明書を取得し、DNS設定（Route 53など）でCNAMEレコードを設定する必要があります
- ディストリビューションの作成後、**Distribution ID** をメモしておいてください（S3バケットポリシーの設定で使用します）
- ディストリビューションの作成後、**Domain Name**（例: `d1234567890abc.cloudfront.net`）をメモしておいてください（環境変数の設定で使用します）

### 2. S3バケットポリシーの更新

#### 2.1 静的サイト用バケット（`journey-photo.com`）

1. S3バケット `journey-photo.com` を選択
2. 「アクセス許可」タブを開く
3. 「バケットポリシー」の「編集」をクリック
4. 以下のJSONを貼り付け（`YOUR_ACCOUNT_ID`と`DISTRIBUTION_ID`を実際の値に置き換える）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::journey-photo.com/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/DISTRIBUTION_ID"
        }
      }
    }
  ]
}
```

**DISTRIBUTION_IDの確認方法:**
- CloudFrontディストリビューションの詳細ページで確認

5. 「変更の保存」をクリック

#### 2.2 画像アップロード用バケット（`prod-journey-photo-upload`）

同様に、CloudFront経由でアクセスする場合は、Origin Access Controlを設定してバケットポリシーを更新します。

### 3. Secrets Managerのシークレットを更新

CloudFrontディストリビューションを作成した後、Secrets Managerのシークレットに `CLOUDFRONT_URL` を追加または更新する必要があります。

**⚠️ 本番環境での重要事項:**
- `CLOUDFRONT_URL` は、Lambda関数が画像の公開URLを生成する際に使用されます
- この値が正しく設定されていないと、アップロードした画像にアクセスできなくなります
- ディストリビューションのステータスが「Deployed」になるまで待ってから、この値を設定してください

**設定手順:**

1. **Secrets Managerでシークレットを選択**
   - AWSコンソールで「Secrets Manager」を開く
   - シークレット名 `prod-journey-photo-upload` を選択
   - ⚠️ **本番環境のAWSアカウントにログインしていることを確認してください**

2. **「シークレットの値を取得」をクリック**
   - シークレットの詳細ページで、「シークレットの値を取得」ボタンをクリック
   - 現在のシークレットの値が表示されます

3. **「編集」をクリック**
   - シークレットの値を編集するために、「編集」ボタンをクリック
   - または、「シークレットの値を編集」ボタンをクリック

4. **`CLOUDFRONT_URL` を追加または更新**

   **⚠️ `CLOUDFRONT_URL` の取得方法:**
   
   `CLOUDFRONT_URL` は、CloudFrontディストリビューションの**Domain Name**から取得します。
   
   **取得手順:**
   
   1. AWSコンソールで「CloudFront」を開く
   2. 作成したディストリビューションを選択
   3. 「一般」タブを開く
   4. **「Domain Name」** の値を確認
      - 例: `d1234567890abc.cloudfront.net`
      - ⚠️ **重要**: この値は、ディストリビューションごとに異なります
   5. `https://` を付けて、`CLOUDFRONT_URL` として使用
      - 例: `https://d1234567890abc.cloudfront.net`
      - ⚠️ **重要**: `https://` を必ず含めてください
   
   **注意事項:**
   - Domain Nameは、ディストリビューションを作成した直後は表示されない場合があります
   - ディストリビューションのステータスが「Deployed」になるまで待ってから確認してください
   - Domain Nameは、ディストリビューションを作成した後は変更されません
   - カスタムドメインを使用する場合でも、CloudFrontのDomain Nameは引き続き使用できます
   - Domain Nameは、ディストリビューションを削除しない限り変更されません

   **シークレットの更新:**
   
   既存のシークレットのJSONに、`CLOUDFRONT_URL` を追加または更新します：

```json
{
  "AWS_REGION": "ap-northeast-1",
     "AWS_S3_BUCKET_NAME": "prod-journey-photo-upload",
     "AWS_S3_SITE_BUCKET_NAME": "journey-photo.com",
  "CLOUDFRONT_URL": "https://d1234567890abc.cloudfront.net"
}
```

   ⚠️ **重要**: `d1234567890abc.cloudfront.net` の部分を、**実際のCloudFrontディストリビューションのDomain Name**に置き換えてください。
   
   **各フィールドの説明:**
   - `AWS_REGION`: AWSリージョン（例: `ap-northeast-1`）
   - `AWS_S3_BUCKET_NAME`: 画像アップロード用S3バケット名（例: `prod-journey-photo-upload`）
   - `AWS_S3_SITE_BUCKET_NAME`: 静的サイト用S3バケット名（例: `journey-photo.com`）
   - `CLOUDFRONT_URL`: CloudFrontディストリビューションのURL（例: `https://d1234567890abc.cloudfront.net`）
     - ⚠️ **重要**: `https://` を含めてください
     - ⚠️ **重要**: 末尾に `/` は含めないでください

5. **「保存」をクリック**
   - 編集内容を保存するために、「保存」ボタンをクリック
   - または、「シークレットの値を保存」ボタンをクリック
   - シークレットが更新されると、Lambda関数が新しい値を自動的に使用します

**確認ポイント（本番環境）:**
- ✅ `CLOUDFRONT_URL` が `https://` で始まっている
- ✅ `CLOUDFRONT_URL` が実際のCloudFrontディストリビューションのDomain Nameと一致している
- ✅ `CLOUDFRONT_URL` の末尾に `/` が含まれていない
- ✅ すべてのフィールドが正しく設定されている

**エラーが発生した場合:**
- JSONの形式が正しいか確認してください（カンマ、引用符、波括弧など）
- Domain Nameが正しいか確認してください（CloudFrontコンソールで再確認）
- ディストリビューションのステータスが「Deployed」になっているか確認してください

---

## ビルド前の確認

**📋 このセクションの使い方:**
- 各ステップを**上から順番に**実行してください
- 各ステップの「✅ 完了したら、次のステップに進んでください」まで完了してから次に進んでください
- エラーが発生した場合は、そのステップでエラーを解決してから次に進んでください

**⚠️ 本番環境での重要事項:**
- `NEXT_PUBLIC_` プレフィックスがついた環境変数は、ビルド時にクライアント側のJavaScriptコードに埋め込まれます
- これらの環境変数は、ビルド後に変更することはできません
- ビルド前に、すべての環境変数を正しく設定してください

本番環境でNext.jsアプリケーションをビルドする前に、以下の手順を**上から順番に**実行してください。

---

## ステップ1: 依存関係のインストール

**最初に依存関係をインストールします。** 依存関係がインストールされていないと、以降の手順を実行できません。

```bash
# 依存関係のインストール
npm install

# または、クリーンインストール（推奨）
rm -rf node_modules package-lock.json
npm install
```

**確認:**
- ✅ `node_modules/` ディレクトリが存在すること
- ✅ `package-lock.json` が最新であること
- ✅ インストールエラーがないこと

**✅ 確認できたら、次のステップ2に進んでください。**

---

## ステップ2: 設定ファイルの確認

依存関係のインストール後、設定ファイルを確認します。

**`next.config.ts` の確認:**
- ✅ `output: 'export'` が設定されている（静的エクスポート用）
- ✅ その他の設定が正しいことを確認

**`package.json` の確認:**
- ✅ `build` スクリプトが定義されている
- ✅ 必要な依存関係がすべて含まれている

**✅ 確認できたら、次のステップ3に進んでください。**

---

## ステップ3: 型エラーの確認

依存関係と設定ファイルの確認後、TypeScriptの型エラーを確認します。

```bash
# TypeScriptの型チェック
npm run type-check

# または、tscを直接実行
npx tsc --noEmit
```

**確認:**
- ✅ 型エラーが0件であること
- ✅ 警告があっても、ビルドに影響しないことを確認

**❌ 型エラーがある場合:**
- エラーメッセージを確認して、型エラーを修正してください
- 型エラーが0件になるまで修正を続けてください

**✅ 型エラーが0件になったら、次のステップ4に進んでください。**

---

## ステップ4: リンターエラーの確認と修正

型エラーの確認後、コードの品質を確認するため、リンターを実行します。

### 4.1 lintエラーの確認

```bash
# ESLintの実行
npm run lint

# または、ESLintを直接実行
npx eslint .
```

**確認:**
- ✅ 重大なエラーがないこと
- ✅ 警告があっても、ビルドに影響しないことを確認

### 4.2 lintエラーの修正

**⚠️ 重要: lintエラーを無視してビルドを実行することは推奨しません。**

以下のリスクがあります：
- 型安全性の問題
- パフォーマンスの問題
- コードの品質の問題
- 本番環境での予期しない動作

**修正手順:**

**手順1: 自動修正可能なエラーを修正する**

```bash
# 自動修正可能なエラーを修正
npm run lint -- --fix
```

このコマンドで、以下のようなエラーが自動的に修正されます：
- `prefer-const`: `let` を `const` に変更
- その他の自動修正可能なフォーマットエラー

**手順2: 残りのエラーを手動で修正する**

自動修正できないエラーは、手動で修正してください。特に以下の重大なエラーは必ず修正してください：
- `@typescript-eslint/no-explicit-any`: `any` 型の使用（型安全性の問題）
- `react-hooks/set-state-in-effect`: useEffect内でのsetState（パフォーマンスの問題）
- `@next/next/no-html-link-for-pages`: Next.jsの`<Link>`コンポーネントの使用推奨

**手順3: lintエラーが0件になったことを確認する**

```bash
# lintエラーが0件になったことを確認
npm run lint
```

**確認:**
- ✅ エラーが0件であること
- ✅ 警告があっても、ビルドに影響しないことを確認

**❌ lintエラーが残っている場合:**
- エラーを修正してから、再度 `npm run lint` を実行してください
- エラーが0件になるまで修正を続けてください

**✅ lintエラーが0件になったら、次のステップ5に進んでください。**

**⚠️ 重要: lintエラーを修正せずにビルドを実行しないでください**

lintエラーが残っている状態でビルドを実行すると、以下のリスクがあります：
- 型安全性の問題
- パフォーマンスの問題
- コードの品質の問題
- 本番環境での予期しない動作

**必ず、lintエラーが0件になってからビルドを実行してください。**

**補足: ビルドに影響しない警告について**

以下のような警告は、ビルドに影響しないため、一時的に無視しても問題ありません：
- `@typescript-eslint/no-unused-vars`: 未使用の変数（将来使用する可能性がある場合）
- `react-hooks/exhaustive-deps`: 依存配列の警告（意図的に省略している場合）

ただし、可能な限りすべてのエラーと警告を修正することを推奨します。

---

## ステップ5: AWSリソースの確認

ビルド前に、以下のAWSリソースが作成されていることを確認します。

- ✅ **Cognito User Pool** が作成されている
- ✅ **Cognito App Client** が作成されている
- ✅ **API Gateway (HTTP API)** が作成されている
- ✅ **CloudFrontディストリビューション** が作成されている（CloudFront経由でAPIにアクセスする場合）
- ✅ **CloudFrontディストリビューションのステータス** が「Deployed」になっている（CloudFront経由でAPIにアクセスする場合）

**確認方法:**
1. AWSコンソールで各サービスを開く
2. 作成したリソースが存在することを確認
3. 必要な設定（Cognito Authorizer、キャッシュビヘイビアなど）が完了していることを確認

**❌ AWSリソースが作成されていない場合:**
- このドキュメントの「AWSリソースの準備」セクションを参照して、必要なリソースを作成してください
- すべてのリソースが作成されるまで、ビルドを実行しないでください

**✅ すべてのAWSリソースが作成されていることを確認できたら、次のステップ6に進んでください。**

---

## ステップ6: 環境変数の設定

すべての必須環境変数を設定します。

**必要な環境変数:**
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`: Cognito User Pool ID
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`: Cognito App Client ID
- `NEXT_PUBLIC_AWS_REGION`: AWSリージョン（例: `ap-northeast-1`）
- `NEXT_PUBLIC_API_BASE_URL`: API GatewayのエンドポイントURL

**設定方法（選択してください）:**

**方法1: `.env.production` ファイルを使用（ローカルビルドの場合）**

プロジェクトのルートディレクトリに `.env.production` ファイルを作成し、以下の内容を記述します：

```bash
# .env.production
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_12345678
NEXT_PUBLIC_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_BASE_URL=https://d1234567890abc.cloudfront.net/api
```

**重要:**
- `.env.production` ファイルは `.gitignore` に含まれているため、Gitにコミットされません
- 実際の値に置き換えてください
- このファイルはローカルマシンにのみ保存し、共有しないでください

**方法2: CI/CDパイプラインで環境変数を設定（推奨）**

GitHub Actions、GitLab CI、CircleCIなどのCI/CDパイプラインを使用する場合、環境変数をCI/CDの設定で定義します。

**詳細な設定方法は、後述の「環境変数の設定方法（詳細）」セクションを参照してください。**

**`NEXT_PUBLIC_API_BASE_URL` の取得方法:**

**CloudFront経由でAPIにアクセスする場合（推奨）:**
1. AWSコンソールで「CloudFront」を開く
2. 作成したディストリビューションを選択
3. 「一般」タブを開く
4. **「Domain Name」** の値を確認（例: `d1234567890abc.cloudfront.net`）
5. `https://` を付けて、`/api` を追加（例: `https://d1234567890abc.cloudfront.net/api`）

**API Gatewayに直接アクセスする場合:**
1. AWSコンソールで「API Gateway」を開く
2. 作成したHTTP APIを選択
3. 「ステージ」タブを開く
4. ステージ（例: `$default`）を選択
5. **「API エンドポイント」** の値を確認（例: `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`）

**✅ 環境変数を設定したら、次のステップ7に進んでください。**

---

## ステップ7: 環境変数の確認

すべての必須環境変数が正しく設定されているか確認します。

```bash
# 環境変数の確認方法（例）

# .env.production ファイルを使用している場合
cat .env.production

# または、環境変数を直接確認
echo $NEXT_PUBLIC_COGNITO_USER_POOL_ID
echo $NEXT_PUBLIC_COGNITO_CLIENT_ID
echo $NEXT_PUBLIC_AWS_REGION
echo $NEXT_PUBLIC_API_BASE_URL
```

**確認ポイント:**
- ✅ `NEXT_PUBLIC_COGNITO_USER_POOL_ID` が設定されている
  - 形式: `ap-northeast-1_XXXXXXXX`（リージョン_UserPoolID）
  - 空欄でないことを確認
- ✅ `NEXT_PUBLIC_COGNITO_CLIENT_ID` が設定されている
  - 形式: 英数字の文字列（例: `1a2b3c4d5e6f7g8h9i0j1k2l3m`）
  - 空欄でないことを確認
- ✅ `NEXT_PUBLIC_AWS_REGION` が設定されている
  - 値: `ap-northeast-1`（東京リージョン）
  - 他のリージョンを使用している場合は、そのリージョン名を確認
- ✅ `NEXT_PUBLIC_API_BASE_URL` が設定されている
  - CloudFront経由の場合: `https://{CloudFront Domain Name}/api`
  - API Gateway直接の場合: `https://{API Gateway Endpoint}`
  - `https://` で始まることを確認
  - 末尾に `/` が含まれていないことを確認（`/api` の場合は `/api` で終わる）

**❌ 環境変数が設定されていない場合:**
- ステップ6の「環境変数の設定方法」セクションを参照して、環境変数を設定してください
- すべての環境変数が設定されるまで、ビルドを実行しないでください

**✅ すべての環境変数が正しく設定されていることを確認できたら、次のステップ8に進んでください。**

---

## ステップ8: ビルドコマンドの実行

**⚠️ 重要: このステップを実行する前に、以下のすべてが完了していることを確認してください：**
- ✅ ステップ1: 依存関係のインストールが完了している
- ✅ ステップ2: 設定ファイルの確認が完了している
- ✅ ステップ3: 型エラーの確認が完了している（型エラーが0件）
- ✅ ステップ4: lintエラーの確認と修正が完了している（lintエラーが0件）
- ✅ ステップ5: AWSリソースの確認が完了している
- ✅ ステップ6: 環境変数の設定が完了している
- ✅ ステップ7: 環境変数の確認が完了している

すべての確認が完了したら、以下のコマンドでNext.jsアプリケーションをビルドします。

```bash
npm run build
```

**ビルドプロセス:**
1. `scripts/prepare-static-build.js` が、`output: "export"` 非対応の `app/api` を一時的に `_api_build_backup` へ退避します
2. Next.jsが環境変数を読み込み、`next build --webpack` を実行します
3. `NEXT_PUBLIC_` プレフィックスがついた環境変数が、クライアント側のコードに埋め込まれます
4. 静的ファイルが `out/` ディレクトリに生成された後、`app/api` が復元されます

**ビルドが成功した場合:**
- ✅ `out/` ディレクトリに静的ファイルが生成されます
- ✅ ビルドログにエラーが表示されません
- ✅ 次のステップ（静的サイトのデプロイ）に進むことができます

**ビルドが失敗した場合:**
- ❌ エラーメッセージを確認してください
- ❌ 環境変数が正しく設定されているか再確認してください（ステップ7に戻る）
- ❌ `next.config.ts` の設定を確認してください（ステップ2に戻る）
- ❌ 型エラーがないか再確認してください（ステップ3に戻る）
- ❌ lintエラーがないか再確認してください（ステップ4に戻る）
- ❌ 依存関係が正しくインストールされているか確認してください（ステップ1に戻る）

**注意事項:**
- ビルド前に、すべての環境変数が正しく設定されていることを確認してください
- ビルド後、`out/` ディレクトリに静的ファイルが生成されます
- 生成されたファイルをS3バケットにアップロードする必要があります（次の「静的サイトのデプロイ」セクションを参照）
- ビルド後、環境変数を変更しても、再ビルドしない限り変更は反映されません

---

#### 参考: 静的エクスポート（output: "export"）と app/api のエラーについて

**原因（なぜエラーになるか）**

- `next.config.ts` で `output: "export"` を指定すると、Next.js は **静的サイト用の HTML/JS/CSS だけ** を `out/` に出力します。サーバー（Node.js）は動かしません。
- `app/api/**/route.ts`（Route Handlers）は **サーバー上で動く API** のため、静的エクスポートでは **そもそも利用できません**。
- それにもかかわらず、ビルド時に Next.js は `app/` 配下の `route.ts` を走査し、「このルートは静的か動的か」を判定します。`output: "export"` のとき、`dynamic` や `revalidate` が未設定だと、  
  **`export const dynamic = "force-static"/export const revalidate not configured on route "/api/photos" with "output: export"`** というエラーになります。
- webpack の `ignore-loader` や `exclude` では防げません。ルートの収集は webpack より前の段階で行われるためです。

**今回の対応（解決策）**

- ビルド時にだけ `app/api` を `app/` の外へ退避し、Next.js のルート収集対象から外すようにしました。
- `npm run build` は `scripts/prepare-static-build.js` を実行し、その中で  
  `app/api` → `_api_build_backup` へ退避 → `next build --webpack` → 終了後に `app/api` を復元、という流れになっています。
- `tsconfig.json` の `exclude` に `_api_build_backup` を追加し、退避中も TypeScript の型チェック対象に含まれないようにしています。

**今後どうするのがよいか**

| 観点 | 推奨 |
|------|------|
| **本番の API** | 本番は **API Gateway + Lambda** などで `/api/*` を実装する想定です。`app/api` は **開発時（`npm run dev`）や、S3 に上げる前の事前検証用** として残して問題ありません。 |
| **`app/api` の変更** | `app/api` を編集したときは、**`npm run build` を必ず一度実行**して、退避・復元後もビルドが通るか確認してください。`_api_build_backup` は `tsconfig` の `exclude` に入っているため、退避中は型チェックされません。 |
| **`prepare-static-build.js` の扱い** | `output: "export"` を使い続ける限り、**削除しないでください**。削除すると、`app/api` が存在する状態で `next build` が走り、同じエラーが再発します。 |
| **`app/api` を廃止する場合** | 開発でも API を使わず、全て API Gateway 等に寄せる場合は、`app/api` ディレクトリ自体を削除し、`prepare-static-build.js` の呼び出しを `package.json` の `build` からやめ、`next build --webpack` に戻せます。 |
| **ローカルと本番の構成を揃えたい場合** | 本番も Next.js にする、共有ハンドラで Lambda と揃える、など選択肢と進め方は `docs/LOCAL_PROD_PARITY.md` を参照してください。 |

**✅ ビルドが成功したら、次の「静的サイトのデプロイ」セクション（下に続きます）に進んでください。**

---

## 静的サイトのデプロイ（コマンドで反映）

本番への反映を **コマンドで一括実行**できます。CloudFront の無効化は任意です。

### 1. S3 へアップロード（必須）

```bash
npm run web:deploy:prod
```

- `scripts/deploy-static-site.js` が `npm run build` → `aws s3 sync` を実行します。
- 既定のバケットは `journey-photo.com` です。

### 2. CloudFront を無効化したい場合（任意）

CloudFront のキャッシュも同時に無効化したい場合は、以下のどちらかを使ってください。

**方法A: 引数で指定**

```bash
node scripts/deploy-static-site.js --bucket journey-photo.com --distribution-id YOUR_DISTRIBUTION_ID
```

**方法B: 環境変数で指定**

```bash
export CLOUDFRONT_DISTRIBUTION_ID="YOUR_DISTRIBUTION_ID"
npm run web:deploy:prod
```

### 3. API + フロントをまとめて反映

API Gateway + Lambda と静的サイトをまとめて更新する場合:

```bash
npm run deploy:prod
```

---

---

## 静的サイトのデプロイ

**📋 このセクションの使い方:**
- このセクションは、「ビルド前の確認」セクションのステップ8で `npm run build` が成功した後に実行してください
- 各ステップを**上から順番に**実行してください
- 各ステップの「✅ 完了したら、次のステップに進んでください」まで完了してから次に進んでください

**前提条件:**
- ✅ 「ビルド前の確認」セクションのステップ8で `npm run build` が成功していること
- ✅ `out/` ディレクトリに静的ファイルが生成されていること

以下の手順を**上から順番に**実行してください。

---

## ステップ1: S3へのアップロード

ビルドが成功したら、生成された静的ファイルをS3バケットにアップロードします。

### 方法1: AWS CLIを使用（推奨）

```bash
aws s3 sync out/ s3://journey-photo.com/ --delete
```

**コマンドの説明:**
- `out/`: アップロードするディレクトリ（Next.jsのビルド出力）
- `s3://journey-photo.com/`: アップロード先のS3バケット
- `--delete`: S3バケット内の不要なファイルを削除（ローカルに存在しないファイル）

**確認:**
- ✅ アップロードが完了したこと
- ✅ エラーメッセージが表示されていないこと

**✅ アップロードが完了したら、次のステップ2に進んでください。**

### 方法2: AWSコンソールから手動でアップロード

1. AWSコンソールで「S3」を開く
2. `journey-photo.com` バケットを選択
3. 「アップロード」をクリック
4. `out/` ディレクトリ内のすべてのファイルを選択してアップロード
5. ⚠️ **注意**: 手動アップロードの場合、既存のファイルを削除する必要がある場合があります

**✅ アップロードが完了したら、次のステップ2に進んでください。**

---

## ステップ2: 初回の `photos.json` の配置

**初回デプロイ時のみ**、`photos.json` をS3バケットに配置します。

**既存の `photos.json` がある場合:**
- S3バケット `journey-photo.com` の `app/data/photos.json` が既に存在する場合は、そのまま使用できます
- このステップをスキップして、次のステップ3に進んでください

**初回デプロイの場合:**

1. ローカルの `app/data/photos.json` をS3バケットにアップロード：

```bash
aws s3 cp app/data/photos.json s3://journey-photo.com/app/data/photos.json
```

2. または、AWSコンソールから手動でアップロード：
   - AWSコンソールで「S3」を開く
   - `journey-photo.com` バケットを選択
   - `app/data/` フォルダを作成（存在しない場合）
   - `app/data/photos.json` をアップロード

**確認:**
- ✅ `s3://journey-photo.com/app/data/photos.json` が存在すること
- ✅ ファイルの内容が正しいこと

**✅ `photos.json` の配置が完了したら、次のステップ3に進んでください。**

---

## ステップ3: CloudFrontのキャッシュ無効化（オプション）

**注意:** このステップは、既存のサイトを更新する場合のみ必要です。初回デプロイの場合はスキップできます。

CloudFrontのキャッシュを無効化して、最新のコンテンツを即座に反映させます。

### 方法1: AWS CLIを使用

```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

**`YOUR_DISTRIBUTION_ID` の取得方法:**
1. AWSコンソールで「CloudFront」を開く
2. 作成したディストリビューションを選択
3. 「一般」タブを開く
4. **「ディストリビューション ID」** をコピー

### 方法2: AWSコンソールから実行

1. AWSコンソールで「CloudFront」を開く
2. 作成したディストリビューションを選択
3. 「無効化」タブを開く
4. 「無効化を作成」をクリック
5. オブジェクトパスに `/*` を入力
6. 「無効化を作成」をクリック

**確認:**
- ✅ 無効化のステータスが「進行中」または「完了」になっていること
- ⚠️ **注意**: キャッシュの無効化には数分かかる場合があります

**✅ キャッシュの無効化が完了したら、デプロイは完了です。次の「動作確認」セクションに進んでください。**

---

## 環境変数の設定方法（詳細）

本番環境で環境変数を設定する方法を詳しく説明します。**ステップ6で環境変数を設定済みの場合は、このセクションをスキップして構いません。**

### 1. ビルド時に必要な環境変数

Next.jsのビルド時に以下の環境変数を設定します。`NEXT_PUBLIC_` プレフィックスがついた環境変数は、ビルド時にクライアント側のJavaScriptコードに埋め込まれるため、**ビルド時に必ず設定する必要があります**。

| 環境変数名 | 値（例） | 説明 |
|-----------|---------|------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `ap-northeast-1_12345678` | Cognito User Pool ID |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | `1a2b3c4d5e6f7g8h9i0j1k2l3m` | Cognito App Client ID |
| `NEXT_PUBLIC_AWS_REGION` | `ap-northeast-1` | AWSリージョン |
| `NEXT_PUBLIC_API_BASE_URL` | `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com` | API GatewayのエンドポイントURL（CloudFront経由の場合はCloudFront URL + `/api`） |

**⚠️ `NEXT_PUBLIC_API_BASE_URL` の設定方法:**

**CloudFront経由でAPIにアクセスする場合（推奨）:**
- `NEXT_PUBLIC_API_BASE_URL` を `https://{CloudFront Domain Name}/api` に設定します
- 例: `https://d1234567890abc.cloudfront.net/api`
- **CloudFront Domain Nameの取得方法:**
  1. AWSコンソールで「CloudFront」を開く
  2. 作成したディストリビューションを選択
  3. 「一般」タブを開く
  4. **「Domain Name」** の値を確認（例: `d1234567890abc.cloudfront.net`）
  5. `https://` を付けて、`/api` を追加（例: `https://d1234567890abc.cloudfront.net/api`）

**API Gatewayに直接アクセスする場合:**
- `NEXT_PUBLIC_API_BASE_URL` を `https://{API Gateway Endpoint}` に設定します
- 例: `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`
- **API Gateway Endpointの取得方法:**
  1. AWSコンソールで「API Gateway」を開く
  2. 作成したHTTP APIを選択
  3. 「ステージ」タブを開く
  4. ステージ（例: `$default`）を選択
  5. **「API エンドポイント」** の値を確認（例: `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`）

**⚠️ 本番環境では、CloudFront経由でAPIにアクセスすることを推奨します**（CDNの恩恵を受けられます）

### 2. 環境変数の設定方法

本番環境で環境変数を設定する方法は、以下のいずれかを使用します：

#### 方法1: `.env.production` ファイルを使用（ローカルビルドの場合）

プロジェクトのルートディレクトリに `.env.production` ファイルを作成し、以下の内容を記述します：

```bash
# .env.production
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_12345678
NEXT_PUBLIC_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_BASE_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com
```

**重要:**
- `.env.production` ファイルは `.gitignore` に含まれているため、Gitにコミットされません
- 実際の値に置き換えてください
- このファイルはローカルマシンにのみ保存し、共有しないでください

**ビルドコマンド:**
```bash
npm run build
```

Next.jsは自動的に `.env.production` ファイルを読み込みます。

#### 方法2: CI/CDパイプラインで環境変数を設定（推奨）

GitHub Actions、GitLab CI、CircleCIなどのCI/CDパイプラインを使用する場合、環境変数をCI/CDの設定で定義します。

**方法2-A: GitHub Secretsを使用（シンプル）**

**GitHub Actions の例（`.github/workflows/deploy.yml`）:**

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
        env:
          NEXT_PUBLIC_COGNITO_USER_POOL_ID: ${{ secrets.NEXT_PUBLIC_COGNITO_USER_POOL_ID }}
          NEXT_PUBLIC_COGNITO_CLIENT_ID: ${{ secrets.NEXT_PUBLIC_COGNITO_CLIENT_ID }}
          NEXT_PUBLIC_AWS_REGION: ${{ secrets.NEXT_PUBLIC_AWS_REGION }}
          NEXT_PUBLIC_API_BASE_URL: ${{ secrets.NEXT_PUBLIC_API_BASE_URL }}
      - run: aws s3 sync out/ s3://journey-photo.com/ --delete
```

**GitHub Secrets の設定方法:**
1. GitHubリポジトリの「Settings」→「Secrets and variables」→「Actions」を開く
2. 「New repository secret」をクリック
3. 各環境変数を個別に追加：
   - `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
   - `NEXT_PUBLIC_COGNITO_CLIENT_ID`
   - `NEXT_PUBLIC_AWS_REGION`
   - `NEXT_PUBLIC_API_BASE_URL`

**方法2-B: AWS Secrets Managerを使用（一元管理）**

AWS Secrets Managerに既にシークレットを保存している場合、CI/CDパイプラインでSecrets Managerから値を取得して環境変数として設定できます。

**前提条件:**
- Secrets Managerに以下のキーを含むJSONシークレットを保存：
  ```json
  {
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID": "ap-northeast-1_12345678",
    "NEXT_PUBLIC_COGNITO_CLIENT_ID": "1a2b3c4d5e6f7g8h9i0j1k2l3m",
    "NEXT_PUBLIC_AWS_REGION": "ap-northeast-1",
    "NEXT_PUBLIC_API_BASE_URL": "https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com"
  }
  ```
- CI/CDパイプラインにAWS認証情報（IAMロールまたはアクセスキー）が設定されている

**GitHub Actions の例（Secrets Managerを使用）:**

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      # AWS認証情報の設定（GitHub Secretsから）
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-1
      
      # Secrets Managerから値を取得して環境変数として設定
      - name: Get secrets from Secrets Manager
        id: get-secrets
        run: |
          SECRET_JSON=$(aws secretsmanager get-secret-value \
            --secret-id prod-journey-photo-upload \
            --query SecretString \
            --output text)
          
          # JSONをパースして環境変数としてエクスポート
          export NEXT_PUBLIC_COGNITO_USER_POOL_ID=$(echo $SECRET_JSON | jq -r '.NEXT_PUBLIC_COGNITO_USER_POOL_ID')
          export NEXT_PUBLIC_COGNITO_CLIENT_ID=$(echo $SECRET_JSON | jq -r '.NEXT_PUBLIC_COGNITO_CLIENT_ID')
          export NEXT_PUBLIC_AWS_REGION=$(echo $SECRET_JSON | jq -r '.NEXT_PUBLIC_AWS_REGION')
          export NEXT_PUBLIC_API_BASE_URL=$(echo $SECRET_JSON | jq -r '.NEXT_PUBLIC_API_BASE_URL')
          
          # 次のステップで使用できるように環境変数を保存
          echo "NEXT_PUBLIC_COGNITO_USER_POOL_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_ID" >> $GITHUB_ENV
          echo "NEXT_PUBLIC_COGNITO_CLIENT_ID=$NEXT_PUBLIC_COGNITO_CLIENT_ID" >> $GITHUB_ENV
          echo "NEXT_PUBLIC_AWS_REGION=$NEXT_PUBLIC_AWS_REGION" >> $GITHUB_ENV
          echo "NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL" >> $GITHUB_ENV
      
      - run: npm ci
      - run: npm run build
      - run: aws s3 sync out/ s3://journey-photo.com/ --delete
```

**必要なGitHub Secrets:**
- `AWS_ACCESS_KEY_ID`: AWSアクセスキーID
- `AWS_SECRET_ACCESS_KEY`: AWSシークレットアクセスキー

**注意事項:**
- Secrets Managerから値を取得するには、CI/CDパイプラインにAWS認証情報が必要です
- IAMロールを使用する場合は、そのロールにSecrets Managerへの読み取り権限が必要です
- `jq` コマンドが必要です（GitHub ActionsのUbuntuランナーには標準でインストールされています）

**メリット:**
- 環境変数を一元管理できる（Lambda関数と同じシークレットを使用可能）
- 値の変更が容易（Secrets Managerで更新するだけで、次回のデプロイ時に反映）
- 複数のCI/CDパイプラインで同じシークレットを共有できる

**デメリット:**
- CI/CDパイプラインにAWS認証情報が必要
- ビルド時間が若干長くなる（Secrets ManagerへのAPI呼び出しが発生）

#### 方法3: ビルドサーバー（Vercel、Netlifyなど）で環境変数を設定

VercelやNetlifyなどのホスティングサービスを使用する場合、ダッシュボードから環境変数を設定できます。

**Vercel の例:**
1. Vercelダッシュボードでプロジェクトを開く
2. 「Settings」→「Environment Variables」を開く
3. 各環境変数を追加（「Production」環境を選択）
4. 「Save」をクリック
5. 再デプロイを実行

**Netlify の例:**
1. Netlifyダッシュボードでサイトを開く
2. 「Site configuration」→「Environment variables」を開く
3. 「Add a variable」をクリックして各環境変数を追加
4. 「Save」をクリック
5. 再デプロイを実行

### 3. 環境変数の確認方法（ビルド後）

ビルド後、生成されたJavaScriptファイルに環境変数が正しく埋め込まれているか確認できます：

**確認手順:**
1. `out/` ディレクトリ内のJavaScriptファイルを開く（例: `out/_next/static/chunks/main-*.js`）
2. 検索機能で `NEXT_PUBLIC_COGNITO_USER_POOL_ID` を検索
3. 実際の値が埋め込まれていることを確認

**確認ポイント:**
- ✅ `NEXT_PUBLIC_COGNITO_USER_POOL_ID` の値が正しく埋め込まれている
- ✅ `NEXT_PUBLIC_COGNITO_CLIENT_ID` の値が正しく埋め込まれている
- ✅ `NEXT_PUBLIC_API_BASE_URL` の値が正しく埋め込まれている（`https://` で始まることを確認）

**注意:** `NEXT_PUBLIC_` プレフィックスがついた環境変数は、クライアント側のコードに含まれるため、機密情報（APIキー、シークレットなど）には使用しないでください。Cognito User Pool IDやClient IDは公開されても問題ありませんが、必要に応じてセキュリティ設定を確認してください。

---

## 動作確認

### 1. 静的サイトの確認

1. CloudFrontのディストリビューションURLにアクセス
2. サイトが正常に表示されることを確認

### 2. ログインの確認

1. ヘッダーメニューから「ログイン」をクリック
2. Cognitoで作成したユーザー名とパスワードを入力
3. ログインが成功することを確認

### 3. 管理者権限の確認

1. ログイン後、「Manage」リンクが表示されることを確認
2. 「Manage」ページにアクセスできることを確認

### 4. API呼び出しの確認

1. ブラウザの開発者ツールでネットワークタブを開く
2. 写真一覧を表示（`GET /photos` が呼ばれることを確認）
3. アップロード機能をテスト（`POST /upload/presigned-url` が `Authorization: Bearer <JWT>` で呼ばれることを確認）

### 5. アップロード機能の確認

1. アップロードページにアクセス
2. 写真をアップロード
3. アップロードが成功し、S3に保存されることを確認
4. アップロードした写真が一覧に表示されることを確認

---

## トラブルシューティング

### デプロイが失敗する場合

1. **ビルドログの確認**
   - ビルドコマンドの出力を確認
   - エラーメッセージを確認

2. **環境変数の確認**
   - すべての必須環境変数が設定されているか確認
   - 環境変数名にタイポがないか確認

### ログインできない場合

1. **環境変数の確認**
   - `NEXT_PUBLIC_COGNITO_USER_POOL_ID`が正しいか確認
   - `NEXT_PUBLIC_COGNITO_CLIENT_ID`が正しいか確認

2. **CORS設定の確認**
   - Cognitoのアプリクライアント設定で、本番ドメインが許可されているか確認

### API呼び出しが失敗する場合

1. **Lambda関数のログ確認**
   - CloudWatch LogsでLambda関数のログを確認
   - エラーメッセージを確認

2. **IAMロールの権限確認**
   - Lambda実行ロールに適切なポリシーがアタッチされているか確認
   - S3とSecrets Managerへのアクセス権限があるか確認

3. **Secrets Managerの確認**
   - シークレットが存在するか確認
   - シークレット名（`AWS_SECRET_NAME`）が正しいか確認
   - シークレット内の値が正しいか確認

4. **JWT認証の確認**
   - ブラウザの開発者ツールで `Authorization` ヘッダーが正しく送信されているか確認
   - Cognito Authorizerの設定が正しいか確認

### CloudFrontが動作しない場合

1. **ディストリビューションのステータス確認**
   - CloudFrontのディストリビューションが「Deployed」状態か確認

2. **Origin Access Controlの確認**
   - S3バケットポリシーが正しく設定されているか確認

3. **キャッシュのクリア**
   - CloudFrontでキャッシュを無効化（必要に応じて）

---

## セキュリティの要点

- **IAMロールの使用**: Lambda実行ロールを使用し、アクセスキーを置かない
- **最小権限**: S3/Secrets Managerに必要な権限だけを付与
- **Cognito JWT認証**: 管理APIはCognito JWTで保護
- **CloudFront**: S3を直接公開しない構成
- **HTTPSの強制**: CloudFrontでHTTPSを強制

---

## 次のステップ

- [ローカル開発環境のセットアップ](./LOCAL_SETUP.md)を参照
- [アップロード機能の詳細](./UPLOAD_SETUP.md)を参照
