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

**プランの選択:**

1. **「Pay as you go」** を選択（推奨）
   - 使用量に応じて支払う従量課金プラン
   - トラフィック量が予測困難な場合に適しています

2. または、**固定プラン**を選択（月間リクエスト数が予測可能な場合）
   - **Pro**: `$15/month` - 月間1000万リクエスト以内
   - **Business**: `$200/month` - 月間1億2500万リクエスト以内
   - **Premium**: `$1000/month` - 月間5億リクエスト以内
   - ⚠️ **Freeプランは本番環境では使用しないでください**（使用量制限が少なすぎます）

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

ディストリビューションの基本情報を設定します。

**設定項目:**

1. **Distribution name（必須）**: 本番環境であることが分かる名前を入力（例: `photo-gallery-production`）

2. **Description（任意）**: 説明を入力（例: `Photo Gallery Production Distribution`）

3. **Distribution type**: `Single website or app` を選択（デフォルトで選択済み）

4. **Route 53 managed domain（任意）**: 
   - カスタムドメインを使用しない場合: 空欄のまま
   - カスタムドメインを使用する場合: Route 53で登録済みのドメインを入力（例: `journey-photo.com`）
     - ⚠️ `https://` や `http://` は含めない
     - 「Check domain」ボタンで確認

5. **Tags（任意）**: リソース管理用のタグを追加（例: `Environment: Production`, `Project: PhotoGallery`）

設定完了後、「Next」ボタンをクリックして次へ進みます。

#### 1.1 静的サイト用オリジン（Specify origin）

静的サイトをホストしているS3バケットをオリジンとして設定します。

**設定項目:**

1. **Origin type**: `Amazon S3` を選択

2. **S3 origin**: S3バケットのドメイン名を入力
   - 例: `journey-photo.com.s3.ap-northeast-1.amazonaws.com`
   - ⚠️ `https://` は含めない
   - または「Browse S3」ボタンでバケットを選択

3. **Origin path**: 空欄のまま（ルートディレクトリにコンテンツがある場合）

4. **Allow private S3 bucket access to CloudFront**: ✅ チェック（推奨）
   - CloudFrontが自動的にS3バケットポリシーを更新します

5. **Origin settings**: `Use recommended origin settings`（デフォルト）

6. **Cache settings**: `Use recommended cache settings tailored to serving S3 content`（デフォルト）

設定完了後、「Next」ボタンをクリックして次へ進みます。

#### 1.1.1 セキュリティの有効化（Enable security）

1. **「セキュリティ保護を有効にする」** を選択（デフォルトで有効）
2. **「Use monitor mode」** は**オフ**のまま（本番環境では実際にブロック）
3. **「Next」** ボタンをクリック

#### 1.1.2 TLS証明書の取得（Get TLS certificate）

- **カスタムドメインを使用しない場合**: `Use CloudFront default certificate` を選択（デフォルト）
- **カスタムドメインを使用する場合**: 利用可能な証明書から選択、または新規作成
  - ⚠️ CloudFrontで使用する証明書は**`us-east-1`リージョン**で発行されている必要があります

**「Next」** ボタンをクリックして次へ進みます。

#### 1.1.3 確認と作成（Review and create）

1. 設定内容を確認
2. **「Create distribution」** ボタンをクリック
3. ステータスが **「Deployed」** になるまで待つ（通常5-10分）

**⚠️ 重要**: 
- ディストリビューション作成後、**Distribution ID** と **Domain Name** をメモしてください
- API Gateway用のオリジンとビヘイビアは、ディストリビューション作成後に追加します（手順1.2以降）

#### 1.2 API Gateway用オリジンの追加

**設定手順:**

1. CloudFrontディストリビューション → 「Origins」タブ → **「Create origin」**
2. 以下の設定を入力：
   - **Origin domain**: API Gatewayのエンドポイント（例: `xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`）
     - ⚠️ `https://` は含めないでください
   - **プロトコル**: `HTTPS のみ`
   - **名前**: `API-Gateway`
3. **「Create」** ボタンをクリック

#### 1.3 デフォルトのキャッシュビヘイビア（静的サイト用）

**設定手順:**

1. **「Default Cache Behavior」** セクションを確認
2. 以下の設定を確認・変更：
   - **Origin**: `S3-journey-photo.com` を選択
   - **Automatically compress objects**: `はい`
   - **Viewer Protocol Policy**: `Redirect HTTP to HTTPS`
   - **Allowed HTTP Methods**: `GET, HEAD, OPTIONS`
   - **Cache Policy**: `CachingOptimized`

#### 1.4 キャッシュビヘイビアの追加（API用）

**設定手順:**

1. **「Behaviors」** タブ → **「Create behavior」**
2. 以下の設定を入力：
   - **Path pattern**: `/api/*`
   - **Origin**: `API-Gateway` を選択
   - **Automatically compress objects**: `はい`
   - **Viewer Protocol Policy**: `Redirect HTTP to HTTPS`
   - **Allowed HTTP Methods**: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE` ⚠️ **重要**: `POST`, `PUT`, `DELETE` を含める
   - **Cache Policy**: `CachingDisabled` ⚠️ **重要**: API用はキャッシュを無効化
3. **「Create behavior」** ボタンをクリック

#### 1.4.1 ビヘイビア一覧の確認

**確認手順:**

1. **「Behaviors」** タブで、以下の2つのビヘイビアが表示されていることを確認：

   **ビヘイビア1（API用）:**
   - **優先順位**: `0`（最優先）
   - **パスパターン**: `/api/*`
   - **オリジン**: `API-Gateway`
   - **キャッシュポリシー**: `CachingDisabled`

   **ビヘイビア2（デフォルト - 静的サイト用）:**
   - **優先順位**: `1`
   - **パスパターン**: `Default (*)`
   - **オリジン**: `S3-journey-photo.com`
   - **キャッシュポリシー**: `CachingOptimized`

**確認ポイント:**
- ✅ API用のビヘイビアが優先順位0になっている（先に評価される）
- ✅ API用のキャッシュポリシーが `CachingDisabled` になっている

#### 1.5 ディストリビューションの作成（Review and create）

**設定手順:**

1. 設定内容を確認
2. **追加設定（オプション）:**
   - **Price Class**: `Use only North America and Europe`（推奨）または `Use all edge locations`
   - **Default Root Object**: `index.html`（デフォルトのまま）
3. **「Create distribution」** ボタンをクリック
4. ステータスが **「Deployed」** になるまで待つ（通常5-10分）

**⚠️ 重要**: 
- ディストリビューション作成後、**Distribution ID** と **Domain Name** をメモしてください
- API Gateway用のオリジンとビヘイビアは、ディストリビューション作成後に追加します（手順1.2以降）

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

CloudFrontディストリビューション作成後、Secrets Managerのシークレットに `CLOUDFRONT_URL` を追加または更新します。

**⚠️ 重要**: ディストリビューションのステータスが「Deployed」になるまで待ってから設定してください。

**設定手順:**

1. Secrets Managerでシークレット `prod-journey-photo-upload` を選択
2. 「シークレットの値を取得」→「編集」をクリック
3. CloudFrontディストリビューションの「Domain Name」を確認（例: `d1234567890abc.cloudfront.net`）
4. シークレットのJSONに `CLOUDFRONT_URL` を追加または更新：

```json
{
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "prod-journey-photo-upload",
  "AWS_S3_SITE_BUCKET_NAME": "journey-photo.com",
  "CLOUDFRONT_URL": "https://d1234567890abc.cloudfront.net"
}
```

⚠️ **重要**: 
- `CLOUDFRONT_URL` は `https://` で始める
- 末尾に `/` は含めない
- `d1234567890abc.cloudfront.net` を実際のDomain Nameに置き換える

5. 「保存」をクリック

**確認ポイント:**
- ✅ `CLOUDFRONT_URL` が `https://` で始まっている
- ✅ 末尾に `/` が含まれていない
- ✅ 実際のDomain Nameと一致している

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
