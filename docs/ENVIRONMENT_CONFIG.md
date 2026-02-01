# 環境構成の整理

このドキュメントでは、開発環境と本番環境の構成を整理しています。

## 📋 目次

1. [環境変数の一覧](#環境変数の一覧)
2. [AWSリソースの構成](#awsリソースの構成)
3. [環境別の設定](#環境別の設定)
4. [設定の整合性チェック](#設定の整合性チェック)
5. [トラブルシューティング](#トラブルシューティング)

---

## 環境変数の一覧

### クライアントサイド（NEXT_PUBLIC_*）

| 環境変数 | 説明 | 開発環境 | 本番環境 |
|---------|------|---------|---------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID（認証用） | `ap-northeast-1_42eTJcBK7` | `ap-northeast-1_ZbuhDQsWz` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Cognito App Client ID | `4vavr6g8rg6e682ivc58ad0892` | `21cs4cd8dkttmg3snloj72u8mu` |
| `NEXT_PUBLIC_AWS_REGION` | AWSリージョン | `ap-northeast-1` | `ap-northeast-1` |
| `NEXT_PUBLIC_API_BASE_URL` | API Gateway のベースURL | `https://vr9sellzx4.execute-api.ap-northeast-1.amazonaws.com` | `https://d1s3dwwzgxf5ni.cloudfront.net/api` |
| `NEXT_PUBLIC_SITE_URL` | サイトのURL（SEO・OGP・構造化データ用） | `http://localhost:3000` | `https://your-domain.com` |

⚠️ **注意**: `NEXT_PUBLIC_*` プレフィックスがついた環境変数は、クライアントサイド（ブラウザ）に公開されます。

### サーバーサイド（NEXT_PUBLIC_なし）

| 環境変数 | 説明 | 開発環境 | 本番環境 |
|---------|------|---------|---------|
| `AWS_SECRET_NAME` | Secrets Manager のシークレット名 | `dev-journey-photo-upload` | `prod-journey-photo-upload` |
| `AWS_REGION` | AWSリージョン（Secrets Manager用） | `ap-northeast-1` | `ap-northeast-1` |

---

## AWSリソースの構成

### 開発環境（dev）

| リソースタイプ | リソース名/ID | 用途 |
|--------------|-------------|------|
| **Cognito User Pool** | `ap-northeast-1_42eTJcBK7` | 開発用認証 |
| **Cognito App Client** | `4vavr6g8rg6e682ivc58ad0892` | 開発用クライアント |
| **API Gateway** | `https://vr9sellzx4.execute-api.ap-northeast-1.amazonaws.com` | 開発用Lambda API |
| **Lambda Function** | `photo-gallery-api-dev-api` | 開発用API処理 |
| **Secrets Manager** | `dev-journey-photo-upload` | 開発用設定（S3、Cognito等） |
| **S3 Bucket（サイト）** | `dev-journey-photo.com` | 開発用静的サイト（オプション） |
| **S3 Bucket（アップロード）** | `dev-journey-photo-upload` | 開発用画像アップロード |

### 本番環境（prod）

| リソースタイプ | リソース名/ID | 用途 |
|--------------|-------------|------|
| **Cognito User Pool** | `ap-northeast-1_ZbuhDQsWz` | 本番用認証 |
| **Cognito App Client** | `21cs4cd8dkttmg3snloj72u8mu` | 本番用クライアント |
| **CloudFront** | `https://d1s3dwwzgxf5ni.cloudfront.net` | 本番用CDN（API経由） |
| **API Gateway** | （CloudFront経由） | 本番用Lambda API |
| **Lambda Function** | `photo-gallery-api-prod-api` | 本番用API処理 |
| **Secrets Manager** | `prod-journey-photo-upload` | 本番用設定（S3、Cognito等） |
| **S3 Bucket（サイト）** | Secrets Manager の `AWS_S3_SITE_BUCKET_NAME`（例: `prod-journey-photo.com` や `journey-photo.com`） | 本番用静的サイト |
| **S3 Bucket（アップロード）** | `prod-journey-photo-upload` | 本番用画像アップロード |

---

## 環境別の設定

### 開発環境（`.env.local`）

```env
# ============================================
# AWS Cognito設定（認証システム）
# ============================================
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_42eTJcBK7
NEXT_PUBLIC_COGNITO_CLIENT_ID=4vavr6g8rg6e682ivc58ad0892
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_BASE_URL=https://vr9sellzx4.execute-api.ap-northeast-1.amazonaws.com

# ============================================
# AWS Secrets Manager設定（開発環境）
# ============================================
AWS_SECRET_NAME=dev-journey-photo-upload

# ============================================
# サーバーサイド用AWS設定（Secrets Managerで使用）
# ============================================
AWS_REGION=ap-northeast-1

# ============================================
# サイト設定
# ============================================
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 本番環境（`.env.production`）

```env
# ============================================
# AWS Cognito設定（認証システム）
# ============================================
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_ZbuhDQsWz
NEXT_PUBLIC_COGNITO_CLIENT_ID=21cs4cd8dkttmg3snloj72u8mu
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_BASE_URL=https://d1s3dwwzgxf5ni.cloudfront.net/api

# ============================================
# AWS Secrets Manager設定（本番環境）
# ============================================
AWS_SECRET_NAME=prod-journey-photo-upload

# ============================================
# サーバーサイド用AWS設定（Secrets Managerで使用）
# ============================================
AWS_REGION=ap-northeast-1

# ============================================
# サイト設定
# ============================================
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

---

## 設定の整合性チェック

### 必須の整合性

1. **Cognito User Pool ID の一致**
   - `.env.local` / `.env.production` の `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
   - Secrets Manager（`dev-journey-photo-upload` / `prod-journey-photo-upload`）の `COGNITO_USER_POOL_ID`
   - これらが一致している必要があります

2. **Secrets Manager の設定**
   - 開発環境: `dev-journey-photo-upload` に `COGNITO_USER_POOL_ID` が設定されているか
   - 本番環境: `prod-journey-photo-upload` に `COGNITO_USER_POOL_ID` が設定されているか

### チェックコマンド

```bash
# 開発環境のSecrets Managerを確認
npm run check:dev-secrets

# 本番環境のSecrets Managerを確認（手動）
aws secretsmanager get-secret-value --secret-id prod-journey-photo-upload
```

---

## Secrets Manager の設定内容

### 開発環境（`dev-journey-photo-upload`）

```json
{
  "COGNITO_USER_POOL_ID": "ap-northeast-1_42eTJcBK7",
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "dev-journey-photo-upload",
  "AWS_S3_SITE_BUCKET_NAME": "dev-journey-photo.com",
  "CLOUDFRONT_URL": "（オプション）"
}
```

### 本番環境（`prod-journey-photo-upload`）

```json
{
  "COGNITO_USER_POOL_ID": "ap-northeast-1_ZbuhDQsWz",
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "prod-journey-photo-upload",
  "AWS_S3_SITE_BUCKET_NAME": "prod-journey-photo.com",
  "CLOUDFRONT_URL": "https://d1s3dwwzgxf5ni.cloudfront.net",
  "CLOUDFRONT_DISTRIBUTION_ID": "EYRLTGCPOS9E4"
}
```

**注意**: `CLOUDFRONT_DISTRIBUTION_ID` を設定すると、`npm run web:deploy:prod` 実行時に自動で CloudFront のキャッシュ無効化が実行されます。

---

## Lambda API の設定

### serverless.yml の設定

- **Stage**: `dev` または `prod`
- **AWS_SECRET_NAME**: `${opt:stage, 'dev'}-journey-photo-upload`
  - `dev` stage → `dev-journey-photo-upload`
  - `prod` stage → `prod-journey-photo-upload`

### デプロイコマンド

```bash
# 開発環境にデプロイ
npm run api:deploy:dev

# 本番環境にデプロイ
npm run api:deploy:prod

# デプロイ情報を確認
npm run api:info:dev
npm run api:info:prod
```

---

## トラブルシューティング

### 認証エラーが発生する場合

1. **Cognito User Pool ID の不一致を確認**
   ```bash
   npm run check:dev-secrets
   ```

2. **ログイン状態を確認**
   - `/login` ページでログインしているか
   - adminグループに属しているか

3. **Lambda側のログを確認**
   ```bash
   # 開発環境
   aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow
   
   # 本番環境
   aws logs tail /aws/lambda/photo-gallery-api-prod-api --follow
   ```

### Secrets Manager の設定を更新する場合

```bash
# 開発環境
aws secretsmanager put-secret-value \
  --secret-id dev-journey-photo-upload \
  --secret-string '{"COGNITO_USER_POOL_ID":"ap-northeast-1_42eTJcBK7",...}'

# 本番環境
aws secretsmanager put-secret-value \
  --secret-id prod-journey-photo-upload \
  --secret-string '{"COGNITO_USER_POOL_ID":"ap-northeast-1_ZbuhDQsWz",...}'
```

---

## 関連ドキュメント

- [初めてのセットアップ（ローカル）](SETUP.md)
- [本番デプロイ](DEPLOY.md) … 本番URL・CloudFront・Route 53・トラブル対処
- [本番環境のデプロイ](PRODUCTION_SETUP.md)
- [API ドキュメント](API.md) … 開発/本番デプロイ含む
- [認証の詳細](AUTH_SETUP.md)
- [アップロードの詳細](UPLOAD_SETUP.md)
- [SEO実装ガイド](SEO.md) … メタタグ・構造化データ・`NEXT_PUBLIC_SITE_URL` の使い方
