# 開発用 API Gateway + Lambda のデプロイ（本番と同じ定義で dev/prod を切り替え）

`api/` 配下の Serverless 定義を使い、**本番と同じ API の形**を **開発用（dev）と本番（prod）に `--stage` でデプロイ**します。  
「本番のものを自動で開発に移す」は、**同じ `serverless.yml` と `handler.js` を `--stage dev` または `--stage prod` でデプロイする**ことで実現します。

---

## 1. 前提

### 1.1 開発用（dev）の事前準備

**初回だけ**、以下のリソースを AWS に作成してください。

| リソース | 名前（例） | 用途 |
|----------|------------|------|
| **S3 バケット** | `dev-journey-photo.com` | 静的サイト用。`app/data/photos.json` の保存先。本番の `journey-photo.com` の開発版。 |
| **S3 バケット** | `dev-journey-photo-upload` | 画像アップロード用。本番の `prod-journey-photo-upload` の開発版。 |
| **Secrets Manager** | `dev-journey-photo-upload` | 開発用の設定。本番の `prod-journey-photo-upload` と同じキー構成。 |

**Secrets Manager の「キー」と「値」:**

- **キー（項目名）は dev / prod で同じ**にします。`handler.js` が `config.AWS_S3_BUCKET_NAME` などを参照するためです。
- **値は環境ごとに変えます**。開発用シークレットには開発用のバケット名などを入れ、本番用シークレットには本番用を入れます。

| キー | 開発用（`dev-journey-photo-upload`）の値 | 本番用（`prod-journey-photo-upload`）の値 |
|------|------------------------------------------|-------------------------------------------|
| `AWS_REGION` | `ap-northeast-1`（共通でよい） | `ap-northeast-1` |
| `AWS_S3_BUCKET_NAME` | `dev-journey-photo-upload`（アップロード用） | `prod-journey-photo-upload` |
| `AWS_S3_SITE_BUCKET_NAME` | `dev-journey-photo.com`（`photos.json` の置き場） | `journey-photo.com` |
| `CLOUDFRONT_URL` | 開発用 CloudFront の URL、または `""` | 本番 CloudFront の URL |
| `COGNITO_USER_POOL_ID` | 開発用 Cognito User Pool ID（例: `ap-northeast-1_XXXXXXXX`） | 本番用 Cognito User Pool ID |

**開発用シークレット（`dev-journey-photo-upload`）の JSON 例:**

```json
{
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "dev-journey-photo-upload",
  "AWS_S3_SITE_BUCKET_NAME": "dev-journey-photo.com",
  "CLOUDFRONT_URL": "",
  "COGNITO_USER_POOL_ID": "ap-northeast-1_XXXXXXXX"
}
```

**⚠️ 重要:** `COGNITO_USER_POOL_ID` は Secrets Manager に保存してください。環境変数からは取得しません。

- `CLOUDFRONT_URL`: 開発用 CloudFront があればその URL、なければ `""` で可。
- 本番用シークレット（`prod-journey-photo-upload`）は、上表の「本番用の値」で同じキー構成にします。**中身の値だけが dev と prod で違う**形にしてください。

### 1.2 本番（prod）をすでに手動で作っている場合

- 本番用 S3・Secrets Manager（`prod-journey-photo-upload` など）は、`PRODUCTION_SETUP.md` のとおり既にある前提です。
- Serverless で **`--stage prod` を実行すると、新しく API Gateway + Lambda が 1 セット作られます**。  
  - 既存の「手動の Lambda + API Gateway」とは別リソースになります。
  - 切り替える場合: CloudFront の「API 用オリジン・ビヘイビア」の向き先を、この新しい API Gateway の URL に変更し、古い API / Lambda は削除 or 無効化します。

---

## 2. デプロイの流れ

### 2.1 Secrets Manager の設定

**⚠️ 重要: `COGNITO_USER_POOL_ID` は Secrets Manager に保存してください。**  
環境変数からは取得しません。dev/prod で同じ User Pool を使うか、別々かは任意です。  
フロントの `NEXT_PUBLIC_COGNITO_USER_POOL_ID` と同一の User Pool を指定してください。

**デプロイスクリプトが自動的に検証します**（Secrets Manager に `COGNITO_USER_POOL_ID` が含まれていない場合はデプロイを中止）。

Secrets Manager に `COGNITO_USER_POOL_ID` を追加する例:

```bash
# 既存のシークレットを取得
aws secretsmanager get-secret-value --secret-id dev-journey-photo-upload --query SecretString --output text > secret.json

# secret.json を編集して COGNITO_USER_POOL_ID を追加
# {
#   "AWS_REGION": "ap-northeast-1",
#   "AWS_S3_BUCKET_NAME": "dev-journey-photo-upload",
#   "AWS_S3_SITE_BUCKET_NAME": "dev-journey-photo.com",
#   "CLOUDFRONT_URL": "",
#   "COGNITO_USER_POOL_ID": "ap-northeast-1_XXXXXXXX"
# }

# 更新
aws secretsmanager put-secret-value --secret-id dev-journey-photo-upload --secret-string file://secret.json
```

**注意:** Secrets Manager に `COGNITO_USER_POOL_ID` が含まれていない場合、`npm run api:deploy:dev` または `npm run api:deploy:prod` はエラーで停止します。

### 2.2 開発用（dev）へデプロイ

```bash
# リポジトリルートで
npm run api:deploy:dev
```

または:

```bash
cd api
npm install
npx serverless deploy --stage dev
```

- `AWS_SECRET_NAME` は自動で `dev-journey-photo-upload` になります。
- デプロイ完了時に **HTTP API の URL** が表示されます。例:  
  `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com`

### 2.3 本番（prod）へデプロイ

```bash
npm run api:deploy:prod
```

または:

```bash
cd api
npx serverless deploy --stage prod
```

- `AWS_SECRET_NAME` は `prod-journey-photo-upload` になります。
- 本番用 S3・Secrets Manager が既に `PRODUCTION_SETUP` どおりなら、そのまま参照されます。

### 2.4 デプロイ結果の確認

```bash
npm run api:info:dev    # 開発用
npm run api:info:prod   # 本番用
```

- 出力の **endpoints** などに API の URL が出ます。

### 2.5 デプロイ用バケット（deploymentBucket）の名前

`serverless.yml` ではデプロイ用 S3 バケットを **意味のある名前**で指定しています:

- **dev**: `photo-gallery-api-deploy-dev-<AWS_ACCOUNT_ID>`
- **prod**: `photo-gallery-api-deploy-prod-<AWS_ACCOUNT_ID>`

S3 バケット名はグローバルで一意である必要があるため、`aws:accountId` を含めています。

**既存の dev スタックで、もともと Serverless の自動生成名（例: `photo-gallery-api-dev-serverlessdeploymentbucket-xxxxx`）を使っている場合**  
→ `deploymentBucket.name` を追加・変更すると、CloudFormation のリソース置き換えになることがあります。確実に反映させるには、いったん削除してから再デプロイしてください:

```bash
cd api
npx serverless remove --stage dev
npx serverless deploy --stage dev
```

本番（prod）をまだデプロイしていない場合は、そのまま `api:deploy:prod` で新バケット名が使われます。

---

## 3. フロントから開発用 API を向ける

1. 上記で得た **開発用 API の URL** をコピーする。
2. `.env.local` に書く（必要な値は [3.1](#31-envlocal-に必要な値) を参照）。
3. `npm run dev` で起動。  
   - `getApiBaseUrl()` が `NEXT_PUBLIC_API_BASE_URL` を読み、`/photos` などはすべて開発用 API Gateway + Lambda に向きます。
   - **ローカル確認のために CloudFront は不要**です。API Gateway のエンドポイントを直接指定してください。
   - `app/api` は使いません（`NEXT_PUBLIC_API_BASE_URL` が優先される想定）。

### 3.1 .env.local に必要な値

**開発用 API (API Gateway + Lambda) を向ける場合**

| 変数 | 必須 | 説明・取得元 |
|------|------|--------------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | ○ | Cognito のユーザープール ID（例: `ap-northeast-1_XXXXXXXX`） |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | ○ | Cognito のアプリクライアント ID |
| `NEXT_PUBLIC_AWS_REGION` | ○ | リージョン（例: `ap-northeast-1`） |
| `NEXT_PUBLIC_API_BASE_URL` | ○ | 開発用 API の URL（例: `https://xxxxxx.execute-api.ap-northeast-1.amazonaws.com`） |

開発用 API は **JWT のみ**で認証するため、`NEXT_PUBLIC_UPLOAD_API_KEY` や `AWS_SECRET_NAME` は不要です。

**ローカルで app/api を使う場合**（`NEXT_PUBLIC_API_BASE_URL` を未設定）

| 変数 | 必須 | 説明 |
|------|------|------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | ○ | 上記と同じ |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | ○ | 上記と同じ |
| `NEXT_PUBLIC_AWS_REGION` | ○ | 上記と同じ |
| `AWS_SECRET_NAME` | ○ | Secrets Manager のシークレット名（app/api の getConfig 用） |
| `NEXT_PUBLIC_UPLOAD_API_KEY` | △ | app/api の `/upload/presigned-url` 等で x-api-key を使う場合。開発用 API を向けるときは不要。 |

**任意（共通）**

| 変数 | 説明 |
|------|------|
| `NEXT_PUBLIC_SITE_URL` | サイトの URL（SEO 用）。未設定時は `https://your-domain.com` |
| `NEXT_PUBLIC_COGNITO_CLIENT_SECRET` | シークレット付きアプリクライアントなら |

**開発用 API 向け .env.local の例**

```env
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_XXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_BASE_URL=https://vr9sellzx4.execute-api.ap-northeast-1.amazonaws.com
```

### 3.2 dev-journey-photo.com へアップロードしてローカルで確認する

開発用 API で画像付きのギャラリーを表示するには、**photos.json** と **画像ファイル** を dev 用 S3 に置く必要があります。

| 送り先 | 対象 |
|--------|------|
| `dev-journey-photo.com` | `app/data/photos.json`（キー: `app/data/photos.json`） |
| `dev-journey-photo-upload` | 画像（キー: `uploads/<id>.<ext>`） |

**手順 1: アップロード**

`app/data/photos.json` の各項目は、`public/images` のファイルと **タイトル(ja)** で `BASE_PHOTOS` と照合されます。対応するローカル画像があるものだけ `dev-journey-photo-upload` へアップロードされます。

```bash
# AWS の認証情報（~/.aws/credentials など）を用意したうえで
npm run dev:upload
```

- `photos.json` → `s3://dev-journey-photo.com/app/data/photos.json`
- 画像 → `s3://dev-journey-photo-upload/uploads/<id>.<ext>`

**手順 2: 画像の参照について**

`photos.json` の `src` は `https://dev-journey-photo-upload.s3.ap-northeast-1.amazonaws.com/uploads/...` のような S3 の URL です。  
画像を表示するには、`dev-journey-photo-upload` の `uploads/*` に **パブリック読み取り** を許可するバケットポリシーなどを設定してください（開発用のみで可）。

**⚠️ 注意:** `app/data/photos.json` の `src` フィールドは現在開発用のS3 URL（`dev-journey-photo-upload`）が固定されています。  
本番環境では、CloudFront URL を使用するか、環境に応じたURL生成ロジックを実装することを推奨します。

**手順 3: ローカルで確認**

1. `.env.local` に `NEXT_PUBLIC_API_BASE_URL` を開発用 API の URL に設定（[3.1](#31-envlocal-に必要な値) 参照）。
2. `npm run dev` で起動し、ギャラリーや個別写真ページで表示を確認。

```bash
npm run dev
```

- `/gallery` で一覧、`/photo/<id>` で詳細が、開発用 Lambda の `/photos` と S3 の画像を参照して表示されます。

### 3.3 アップロード時の「認証に失敗しました」

**開発用 API（Lambda）を向けている場合**（`NEXT_PUBLIC_API_BASE_URL` 設定済み）

Lambda は **JWT** で認証します。「認証に失敗しました」は JWT の検証に失敗したときのメッセージです。

1. **Secrets Manager に `COGNITO_USER_POOL_ID` が含まれているか**  
   Lambda 関数は Secrets Manager から `COGNITO_USER_POOL_ID` を取得します。**含まれていないと JWT 検証に失敗します。**  
   - Secrets Manager のシークレット（`dev-journey-photo-upload` または `prod-journey-photo-upload`）に `COGNITO_USER_POOL_ID` を追加してください
   - フロントの `NEXT_PUBLIC_COGNITO_USER_POOL_ID` と **同じ User Pool ID** にしてください
   - デプロイスクリプト（`npm run api:deploy:dev` など）が自動的に検証します

2. **再ログイン**  
   JWT の有効期限切れの可能性があります。一度ログアウトしてからログインし直し、アップロードを試してください。

3. **管理者グループ**  
   Lambda は `admin` グループだけアップロードを許可しています。Cognito で該当ユーザーが `admin` に入っているか確認してください（入っていないときは 403「管理者権限が必要です」になります）。

**ローカル app/api を向けている場合**（`NEXT_PUBLIC_API_BASE_URL` 未設定）

app/api は **x-api-key** で認証します。`authenticatedFetch` は `NEXT_PUBLIC_UPLOAD_API_KEY` を x-api-key に付けます。

- `.env.local` に **`NEXT_PUBLIC_UPLOAD_API_KEY`** を、Secrets Manager の `UPLOAD_API_KEY`（または `UPLOAD_API_KEY` 環境変数）と **同じ値**で設定してください。

### 3.4 アップロード用バケットの CORS（[2/3] で失敗する場合）

ブラウザから `/upload` で画像をアップロードすると、Presigned URL 取得 **[1/3]** のあと、**S3 へ PUT [2/3]** で直接 `dev-journey-photo-upload` に送ります。この PUT が CORS でブロックされると **[2/3] S3への接続に失敗** になります。

**対処:** `dev-journey-photo-upload` に CORS を設定してください。

1. `scripts/s3-cors-dev-upload.json` の `AllowedOrigins` に、利用するオリジン（例: `http://localhost:3000`、本番ドメイン）を入れる。必要なら `https://your-domain.com` を実ドメインに置き換える。
2. 以下を実行:

```bash
aws s3api put-bucket-cors --bucket dev-journey-photo-upload --cors-configuration file://scripts/s3-cors-dev-upload.json
```

- `AllowedMethods` に **PUT**、`AllowedHeaders` に **\*** または **Content-Type** が含まれていることを確認。

---

## 4. 「本番のものを自動で開発に移す」の意味

| やること | 説明 |
|----------|------|
| **同じ定義** | `api/serverless.yml` と `api/handler.js` を dev も prod も共有。 |
| **stage で切り替え** | `--stage dev` で dev 用、`--stage prod` で prod 用のスタックがデプロイされる。 |
| **参照先の切り替え** | `AWS_SECRET_NAME` が `dev-journey-photo-upload` / `prod-journey-photo-upload` に変わるだけで、**Lambda のコードは同じ**。 |
| **手動コピペの排除** | 従来の「PRODUCTION_SETUP の Lambda をコンソールにコピペ」は不要。`api/` から一式デプロイ。 |

- **ロジックの変更**  
  - `api/handler.js` を編集 → `api:deploy:dev` で dev に反映 → 動作確認 → `api:deploy:prod` で prod に反映。  
- **ルートの追加・変更**  
  - `api/serverless.yml` の `functions.api.events` を編集し、同じく `api:deploy:dev` / `api:deploy:prod` で反映。

---

## 5. フォルダ構成（api/）

```
api/
├── serverless.yml   # API Gateway (HTTP API) + Lambda の定義。stage で dev/prod を切り替え。
├── handler.js       # Lambda の実装（PRODUCTION_SETUP の内容と同等。HTTP API のイベントにも対応）
└── package.json     # Lambda の依存関係 + Serverless CLI
```

- `handler.js` は、API Gateway **HTTP API (v2)** のイベント形式にも対応しています（`requestContext.http` などを中で正規化）。

---

## 6. 他ドキュメントとの関係

- **本番の全体フロー**: `docs/PRODUCTION_SETUP.md`
- **ローカルと本番の揃え方**: `docs/LOCAL_PROD_PARITY.md`
- **Secrets Manager の本番の形**: `docs/PRODUCTION_SETUP.md` の「Secrets Manager」および `docs/UPLOAD_SETUP.md`  
  - 開発用は、同じキー（`AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_SITE_BUCKET_NAME`, `CLOUDFRONT_URL`）で `dev-journey-photo-upload` を作成即可。

---

## 7. 本番シークレット名が `prod-journey-photo-upload` でない場合

`serverless.yml` の `provider.environment.AWS_SECRET_NAME` は `${opt:stage, 'dev'}-journey-photo-upload` なので、

- **prod** のとき `prod-journey-photo-upload` を参照します。
- 既存の本番シークレットが別名（例: `journey-photo-upload`）の場合は、  
  - 同じ内容で `prod-journey-photo-upload` を新規作成するか、  
  - `api/serverless.yml` の `AWS_SECRET_NAME` を `stage` に応じて変える形に編集してください。
