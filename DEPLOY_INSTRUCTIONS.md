# 本番環境へのデプロイ手順

## ⚠️ 事前確認

### 0. デプロイ用S3バケットの作成（初回のみ）

Serverless Frameworkが使用するデプロイ用S3バケットが存在しない場合、以下のエラーが発生します：

```
Error: Could not locate deployment bucket: "journey-photo-api-deploy-prod-XXXXX"
```

**解決方法:**

```bash
# 本番環境用のデプロイバケットを作成
node scripts/create-deployment-bucket.js prod
```

詳細は [デプロイ用S3バケットの作成](./docs/DEPLOYMENT_BUCKET_SETUP.md) を参照してください。

### 1. 環境変数の確認

`.env.production` をプロジェクトルートに置き、以下を設定してください。  
**`npm run web:deploy:prod` 実行時にこのファイルが自動で読み込まれ、Secrets Manager 用の `AWS_SECRET_NAME` / `AWS_REGION` として使われます。**

```bash
# ビルド・クライアント用
NEXT_PUBLIC_SITE_URL=https://d1s3dwwzgxf5ni.cloudfront.net
NEXT_PUBLIC_API_BASE_URL=https://d1s3dwwzgxf5ni.cloudfront.net/api
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_ZbuhDQsWz
NEXT_PUBLIC_COGNITO_CLIENT_ID=21cs4cd8dkttmg3snloj72u8mu

# デプロイスクリプトが Secrets Manager からバケット名・CloudFront ID を取るために必須
AWS_SECRET_NAME=prod-journey-photo-upload
AWS_REGION=ap-northeast-1
```

### 2. AWS認証情報の確認

AWS CLIが正しく設定されていることを確認：

```bash
aws sts get-caller-identity
```

### 3. S3バケットの確認

本番環境の静的サイト用S3バケット（Secrets Manager の `AWS_S3_SITE_BUCKET_NAME`、例: `prod-journey-photo.com`）にアクセス権限があることを確認してください。

---

## 🚀 デプロイ手順

### 方法1: 一括デプロイ（推奨）

まず、本番用のコードチェックをまとめて実行します：

```bash
npm run predeploy:prod
```

- `eslint` と `tsc --noEmit` を連続実行して、型エラーとlintエラーをまとめて確認します。

問題がなければ、API Gateway + Lambda と静的サイトをまとめてデプロイします：

```bash
npm run deploy:prod
```

このコマンドは以下を実行します：
1. `npm run predeploy:prod` - lint + 型チェック
2. `npm run api:deploy:prod` - API Gateway + Lambda のデプロイ
3. `npm run web:deploy:prod` - 静的サイトのビルドとS3へのアップロード

### 方法2: 静的サイトのみデプロイ

静的サイトのみをデプロイする場合：

```bash
npm run web:deploy:prod
```

このコマンドは以下を実行します：
1. `npm run build` - Next.jsアプリケーションのビルド
2. S3へのアップロード（バケット名は Secrets Manager の `AWS_S3_SITE_BUCKET_NAME` から自動取得。未設定時は `--bucket` または環境変数 `S3_BUCKET_NAME` が必要）

### 方法3: CloudFrontキャッシュ無効化付きデプロイ（自動）

CloudFront のキャッシュ無効化を自動化するには、**Secrets Manager** に `CLOUDFRONT_DISTRIBUTION_ID` を設定します。

1. **一度だけ、Secrets Manager のシークレット（`prod-journey-photo-upload`）に `CLOUDFRONT_DISTRIBUTION_ID` を追加**：

```json
{
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "prod-journey-photo-upload",
  "AWS_S3_SITE_BUCKET_NAME": "prod-journey-photo.com",
  "CLOUDFRONT_URL": "https://d1s3dwwzgxf5ni.cloudfront.net",
  "CLOUDFRONT_DISTRIBUTION_ID": "YOUR_DISTRIBUTION_ID"
}
```

   - CloudFront コンソールのディストリビューション詳細ページで Distribution ID を確認できます

2. その後は、通常どおり次のコマンドを実行するだけで、
   S3アップロード後に **自動で CloudFront のキャッシュ無効化** まで行われます。

```bash
npm run web:deploy:prod
# または
npm run deploy:prod
```

**取得優先順位:**
1. コマンドライン引数（`--distribution-id`）
2. 環境変数（`CLOUDFRONT_DISTRIBUTION_ID`）
3. Secrets Manager（`AWS_SECRET_NAME` で指定したシークレットの `CLOUDFRONT_DISTRIBUTION_ID`）

※ Secrets Managerを使わず、環境変数で直接指定する場合：

```bash
export CLOUDFRONT_DISTRIBUTION_ID="YOUR_DISTRIBUTION_ID"
npm run web:deploy:prod
```

---

## 📋 手動デプロイ手順（トラブルシューティング用）

もし上記のコマンドで問題が発生した場合は、以下の手順を手動で実行してください：

### ステップ1: ビルド

```bash
npm run build
```

ビルドが成功すると、`out/`ディレクトリに静的ファイルが生成されます。

### ステップ2: S3へのアップロード

```bash
# バケット名は本番用（例: prod-journey-photo.com）に置き換えてください
aws s3 sync out/ s3://prod-journey-photo.com/ --delete
```

### ステップ3: CloudFrontキャッシュの無効化（オプション）

```bash
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

---

## ✅ デプロイ後の確認

1. **サイトの確認**: ブラウザでサイトにアクセスし、正常に表示されることを確認
2. **APIの確認**: 写真のアップロード機能などが正常に動作することを確認
3. **SEOの確認**: メタタグや構造化データが正しく設定されていることを確認

---

## 🔧 トラブルシューティング

### ビルドエラーが発生する場合

- 環境変数が正しく設定されているか確認
- `npm install`を実行して依存関係を再インストール
- `out/`ディレクトリを削除してから再ビルド

### S3アップロードエラーが発生する場合

- AWS認証情報が正しく設定されているか確認
- S3バケットへのアクセス権限があるか確認
- バケット名が正しいか確認

### 「Missing bucket name」や Secrets Manager から取得できない場合

- **`.env.production` がプロジェクトルートにあるか**確認してください。`web:deploy:prod` 実行時にこのファイルを読み込み、`AWS_SECRET_NAME` と `AWS_REGION` で Secrets Manager にアクセスします。
- シークレット `prod-journey-photo-upload` に **`AWS_S3_SITE_BUCKET_NAME`**（例: `prod-journey-photo.com`）と、必要なら **`CLOUDFRONT_DISTRIBUTION_ID`** が入っているか確認してください。
- 手動でバケットを指定する場合: `node scripts/deploy-static-site.js --bucket prod-journey-photo.com`

### CloudFrontキャッシュが更新されない場合

- キャッシュ無効化が完了するまで数分かかる場合があります
- ブラウザのキャッシュをクリアして再確認

---

## 📚 参考資料

- [本番環境のセットアップガイド](./docs/PRODUCTION_SETUP.md)
- [環境設定の整理](./docs/ENVIRONMENT_CONFIG.md)
- [本番URLと「何も表示されない」時の確認](./docs/PRODUCTION_URL_AND_TROUBLESHOOTING.md)
- [CloudFront 設定ガイド（どこを見て何を設定するか）](./docs/CLOUDFRONT_SETUP_GUIDE.md)