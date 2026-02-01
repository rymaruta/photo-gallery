# API とデプロイ（Lambda / API Gateway）

PhotoGallery の API 仕様と、API（Lambda + API Gateway）の dev/prod デプロイ手順をまとめています。実装の全体像は [DESIGN.md](./DESIGN.md) を参照してください。

---

## 📋 目次

1. [API エンドポイント一覧](#api-エンドポイント一覧)
2. [認証](#認証)
3. [デプロイ手順（dev / prod）](#デプロイ手順dev--prod)
4. [デプロイ用 S3 バケット](#デプロイ用-s3-バケット)
5. [開発/本番 API デプロイ詳細](#開発本番-api-デプロイ詳細)
6. [参照](#参照)

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

または AWS CLI で手動作成（バケット名は `api/serverless.yml` の `deploymentBucket.name` を参照）:

- **dev**: `journey-photo-api-deploy-dev-<ACCOUNT_ID>`
- **prod**: `journey-photo-api-deploy-prod-<ACCOUNT_ID>`

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3api create-bucket --bucket "journey-photo-api-deploy-prod-${ACCOUNT_ID}" --region ap-northeast-1 --create-bucket-configuration LocationConstraint=ap-northeast-1
aws s3api put-bucket-versioning --bucket "journey-photo-api-deploy-prod-${ACCOUNT_ID}" --versioning-configuration Status=Enabled
```

---

## デプロイ用 S3 バケット

Serverless Framework が Lambda をデプロイする際に使う S3 バケットです。エラー「The specified bucket does not exist」が出た場合:

1. **推奨**: `node scripts/create-deployment-bucket.js prod`（本番）または `dev`（開発）
2. **手動**: 上記のバケット名で ap-northeast-1 にバケットを作成し、バージョニングを有効化
3. 作成後、`npm run api:deploy:prod` または `api:deploy:dev` を再実行

---

## 開発/本番 API デプロイ詳細

### 前提（初回のみ）

| リソース | 開発用（例） | 本番用（例） |
|----------|--------------|--------------|
| S3 サイト用 | `dev-journey-photo.com` | `journey-photo.com` 等 |
| S3 画像用 | `dev-journey-photo-upload` | `prod-journey-photo-upload` |
| Secrets Manager | `dev-journey-photo-upload` | `prod-journey-photo-upload` |

Secrets Manager の**キー**は dev/prod で同じ（`AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_SITE_BUCKET_NAME`, `CLOUDFRONT_URL`, **COGNITO_USER_POOL_ID**）。**値**だけ環境ごとに変える。**COGNITO_USER_POOL_ID** は Secrets Manager に必須（未設定だとデプロイ時に検証で止まる）。

Secrets Manager に `COGNITO_USER_POOL_ID` を追加する例:

```bash
aws secretsmanager get-secret-value --secret-id dev-journey-photo-upload --query SecretString --output text > secret.json
# secret.json に "COGNITO_USER_POOL_ID": "ap-northeast-1_XXXXXXXX" を追加
aws secretsmanager put-secret-value --secret-id dev-journey-photo-upload --secret-string file://secret.json
```

### デプロイの流れ

- **開発**: `npm run api:deploy:dev`（リポジトリルート）。または `cd api && npx serverless deploy --stage dev`。完了時に HTTP API の URL が表示される。
- **本番**: `npm run api:deploy:prod`。または `cd api && npx serverless deploy --stage prod`。
- **確認**: `npm run api:info:dev` / `npm run api:info:prod` でエンドポイントなどを表示。

### フロントから開発用 API を向ける

1. `npm run api:info:dev` で表示された URL をコピー
2. `.env.local` に `NEXT_PUBLIC_API_BASE_URL=https://xxxxxx.execute-api.ap-northeast-1.amazonaws.com` を設定（Cognito 関連も設定済みであること）
3. `npm run dev` で起動。管理画面・アップロードは開発用 Lambda に向く。ローカル用に CloudFront は不要。

### 開発用 S3 に写真データを置いて確認する

`npm run dev:upload` で `app/data/photos.json` と対応画像を `dev-journey-photo.com` / `dev-journey-photo-upload` にアップロードできる。その後 `.env.local` の `NEXT_PUBLIC_API_BASE_URL` を開発用 API にし、`npm run dev` でギャラリー表示を確認。

### 同じ定義で dev/prod を切り替える

- `api/serverless.yml` と `api/handler.js` を dev も prod も共有。`--stage dev` / `--stage prod` で参照する Secrets Manager とデプロイ先が切り替わる。
- ローカルと本番の構成を揃える方針は [LOCAL_ENVIRONMENT_OPTIONS.md](./LOCAL_ENVIRONMENT_OPTIONS.md) を参照。

---

## 参照

- **[設計・構成図](./DESIGN.md)** — 全体アーキテクチャ・データフロー・API 一覧
- **[環境設定の整理](./ENVIRONMENT_CONFIG.md)** — 環境変数・Secrets Manager のキー一覧
- **[本番デプロイ](./DEPLOY.md)** — 本番 URL・CloudFront・Route 53・トラブル対処
