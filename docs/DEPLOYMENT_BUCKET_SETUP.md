# デプロイ用S3バケットの作成

Serverless FrameworkがLambda関数をデプロイする際に使用するS3バケットを作成します。

## 問題

デプロイ時に以下のエラーが発生する場合：

```
Error: Could not locate deployment bucket: "journey-photo-api-deploy-prod-463470976368". 
Error: The specified bucket does not exist
```

これは、Serverless Frameworkがデプロイ用のS3バケットを見つけられないことを示しています。

## 解決方法

### 方法1: スクリプトを使用（推奨）

```bash
# 本番環境用のデプロイバケットを作成
node scripts/create-deployment-bucket.js prod

# 開発環境用のデプロイバケットを作成
node scripts/create-deployment-bucket.js dev
```

### 方法2: AWS CLIで手動作成

```bash
# アカウントIDを取得
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# 本番環境用のバケット名
BUCKET_NAME="journey-photo-api-deploy-prod-${ACCOUNT_ID}"

# バケットを作成（ap-northeast-1リージョンの場合）
aws s3api create-bucket \
  --bucket "${BUCKET_NAME}" \
  --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1

# バージョニングを有効化（推奨）
aws s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled
```

### 方法3: AWSコンソールで作成

1. AWSコンソールでS3を開く
2. 「バケットを作成」をクリック
3. バケット名を入力: `journey-photo-api-deploy-prod-<YOUR_ACCOUNT_ID>`
   - `<YOUR_ACCOUNT_ID>`は、AWSアカウントID（12桁の数字）に置き換えてください
   - 例: `journey-photo-api-deploy-prod-463470976368`
4. リージョンを選択: `ap-northeast-1`
5. 「バケットを作成」をクリック
6. バケットの詳細ページで「バージョニング」を有効化（推奨）

## バケット名の確認

Serverless Frameworkが使用するバケット名は、`api/serverless.yml`で定義されています：

```yaml
deploymentBucket:
  name: journey-photo-api-deploy-${opt:stage, 'dev'}-${aws:accountId}
```

- 開発環境（dev）: `journey-photo-api-deploy-dev-<ACCOUNT_ID>`
- 本番環境（prod）: `journey-photo-api-deploy-prod-<ACCOUNT_ID>`

## アカウントIDの確認方法

```bash
aws sts get-caller-identity --query Account --output text
```

または、AWSコンソールの右上に表示されているアカウントIDを確認してください。

## デプロイバケット作成後の確認

バケットが正しく作成されたか確認：

```bash
# 本番環境用
aws s3 ls | grep journey-photo-api-deploy-prod

# 開発環境用
aws s3 ls | grep journey-photo-api-deploy-dev
```

## デプロイの再実行

バケット作成後、デプロイを再実行：

```bash
# 本番環境へのデプロイ
npm run api:deploy:prod

# または、API + 静的サイトをまとめてデプロイ
npm run deploy:prod
```

## トラブルシューティング

### バケットが既に存在するエラー

バケットが既に存在する場合は、そのままデプロイを続行できます。エラーは無視して問題ありません。

### 権限エラー

S3バケットを作成する権限がない場合は、IAMユーザーに以下の権限を付与してください：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutBucketVersioning",
        "s3:GetBucketVersioning"
      ],
      "Resource": "arn:aws:s3:::journey-photo-api-deploy-*"
    }
  ]
}
```

### バケット名がグローバルに一意でない

S3バケット名はグローバルに一意である必要があります。アカウントIDを含めることで、この問題を回避しています。それでもエラーが発生する場合は、バケット名に追加の識別子（例: タイムスタンプ）を含めることを検討してください。
