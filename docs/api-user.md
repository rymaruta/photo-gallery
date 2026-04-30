# 一般ユーザーAPI ドキュメント

## エンドポイント

**Base URL:** `https://9qmc4qb2e4.execute-api.ap-northeast-1.amazonaws.com`  
**Lambda:** `photo-gallery-user-api-prod`  
**認証:** Cognito JWT（`user` または `admin` グループ）

## エンドポイント一覧

### 写真アップロード

管理者APIと同じ2ステップフロー。

**Step 1: Presigned URL取得**
```
POST /upload/presigned-url
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "fileName": "photo.jpg",
  "fileType": "image/jpeg",
  "fileSize": 1048576
}
```

レスポンス:
```json
{
  "presignedUrl": "https://...",
  "key": "uploads/{uuid}.jpg",
  "publicUrl": "https://d1s3dwwzgxf5ni.cloudfront.net/uploads/{uuid}.jpg",
  "photoId": "{uuid}"
}
```

**Step 2: S3へ直接PUT**（管理者APIと同じ）

**Step 3: メタデータ保存**
```
POST /upload/save
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "key": "uploads/{uuid}.jpg",
  "publicUrl": "...",
  "photoId": "{uuid}",
  "title": { "ja": "タイトル", "en": "Title" },
  "description": { "ja": ["説明"] },
  "location": "場所",
  "category": "カテゴリ",
  "tags": ["tag1"]
}
```

## 管理者APIとの違い

| 操作 | 管理者API | 一般ユーザーAPI |
|------|----------|----------------|
| 写真一覧取得 | ✅ | ❌（公開APIを使用） |
| 写真アップロード | ✅ | ✅ |
| 写真更新 | ✅ | ❌ |
| 写真削除 | ✅ | ❌ |
| ファイルサイズ上限 | 10MB | 50MB |

## デプロイ手順

```bash
cd api-user/
npm install --ignore-scripts

# ビルド
node_modules/.bin/esbuild src/index.ts \
  --bundle --platform=node --target=node22 --minify \
  --outfile=dist/index.js --external:"@aws-sdk/*"

# ZIPパッケージ作成
cd dist && zip -q ../user-api.zip index.js && cd ..

# Lambda更新
aws lambda update-function-code \
  --function-name photo-gallery-user-api-prod \
  --zip-file fileb://user-api.zip \
  --region ap-northeast-1

# ハンドラ設定確認
aws lambda update-function-configuration \
  --function-name photo-gallery-user-api-prod \
  --handler index.handler \
  --region ap-northeast-1
```

## 初回デプロイ（AWS CLIで作成する場合）

```bash
# Lambda作成
aws lambda create-function \
  --function-name photo-gallery-user-api-prod \
  --runtime nodejs22.x \
  --role arn:aws:iam::463470976368:role/photo-gallery-api-prod-ap-northeast-1-lambdaRole \
  --handler index.handler \
  --zip-file fileb://user-api.zip \
  --region ap-northeast-1 \
  --environment "Variables={
    PHOTOS_BUCKET=prod-journey-photo.com,
    PHOTOS_KEY=app/data/photos.json,
    UPLOAD_BUCKET=prod-journey-photo-upload,
    CLOUDFRONT_URL=https://d1s3dwwzgxf5ni.cloudfront.net
  }"

# API Gateway: prod-photo-gallery-user-api (9qmc4qb2e4)
# Cognitoオーソライザー設定済み
# ルート: POST /upload/presigned-url, POST /upload/save
```
