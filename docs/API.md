# API とデプロイ（Lambda / API Gateway）

PhotoGallery の API 仕様と、API（Lambda + API Gateway）の dev/prod デプロイ手順をまとめています。

---

## 📋 目次

1. [API エンドポイント一覧](#api-エンドポイント一覧)
2. [認証](#認証)
3. [デプロイ手順（dev / prod）](#デプロイ手順dev--prod)
4. [参照](#参照)

---

## API エンドポイント一覧

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/api/photos` | 写真一覧を取得 | 不要 |
| GET | `/api/photos/[id]` | 特定の写真を取得 | 不要 |
| PUT | `/api/photos/[id]` | 写真を更新 | 必要（Cognito JWT） |
| DELETE | `/api/photos/[id]` | 写真を削除 | 必要 |
| POST | `/api/upload/presigned-url` | S3 アップロード用 Presigned URL 取得 | 必要 |
| POST | `/api/upload/save` | アップロード写真のメタデータ保存 | 必要 |

- 編集・削除・アップロード関連は **Cognito JWT**（Authorization ヘッダー）で認証。
- 写真一覧・個別取得は **認証不要**。

---

## 認証

- **Cognito JWT**: ログイン後にフロントが `Authorization: Bearer <idToken>` を付与。
- Lambda は Secrets Manager の **COGNITO_USER_POOL_ID** で JWT を検証し、**admin グループ** のユーザーのみ編集・アップロードを許可。

---

## デプロイ手順（dev / prod）

### 前提

- **Secrets Manager** に dev 用は `dev-journey-photo-upload`、本番用は `prod-journey-photo-upload` を作成し、**COGNITO_USER_POOL_ID**, **AWS_REGION**, **AWS_S3_BUCKET_NAME**, **AWS_S3_SITE_BUCKET_NAME**, **CLOUDFRONT_URL**（本番は必須）を設定。
- **COGNITO_USER_POOL_ID** は Secrets Manager に必須。環境変数からは取得しない。

### コマンド

| 環境 | コマンド | 説明 |
|------|----------|------|
| **開発** | `npm run api:deploy:dev` | リポジトリルートで実行。dev 用 Lambda + API Gateway をデプロイ。 |
| **本番** | `npm run api:deploy:prod` | 同上。prod 用をデプロイ。 |
| **情報確認** | `npm run api:info:dev` / `npm run api:info:prod` | エンドポイント URL などを表示。 |

### デプロイ用 S3 バケット（Serverless 用）

初回デプロイ時に「デプロイ用バケットが無い」と出た場合:

```bash
node scripts/create-deployment-bucket.js prod   # 本番用
node scripts/create-deployment-bucket.js dev    # 開発用
```

詳細は [DEPLOYMENT_BUCKET_SETUP.md](./DEPLOYMENT_BUCKET_SETUP.md) を参照。

---

## 参照

- **[API 実装ドキュメント（詳細仕様）](./API_DOCUMENTATION.md)** — 各エンドポイントのリクエスト/レスポンス詳細
- **[環境設定の整理](./ENVIRONMENT_CONFIG.md)** — 環境変数・Secrets Manager のキー一覧
- **[本番デプロイ](./DEPLOY.md)** — 本番 URL・CloudFront・Route 53・トラブル対処
