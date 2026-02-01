# ローカル環境を本番に近づける方法

本番環境（S3+CloudFront+API Gateway+Lambda+Cognito）と同じような環境をローカルで構築する方法と、**ローカルと本番で同じような構成にする方針**をまとめています。

---

## Part 1: 方針とおすすめ（ローカルと本番の構成を揃える）

### 現状の整理

| 項目 | ローカル | 本番 |
|------|----------|------|
| **フロント** | `next dev`（Node） | S3 + CloudFront（静的のみ） |
| **API** | Next.js Route Handlers（`app/api/*`） | API Gateway + Lambda |
| **`getApiBaseUrl()`** | 未設定時は `/api`（同一オリジン） | `NEXT_PUBLIC_API_BASE_URL` で API Gateway / CloudFront の `/api` を指定 |

### よくある質問: ローカルも本番の API を使う？

- **本番の API をそのまま向ける** → 原則おすすめしません（本番データを触るリスク）。
- **本番と同じ種類の API（API Gateway + Lambda）を開発でも使う** → 開発用の API Gateway + Lambda を用意し、ローカルから `NEXT_PUBLIC_API_BASE_URL` でそこを向ける形にすると、環境の統一性が高まります。手順は [API.md](./API.md) の「開発/本番 API デプロイ詳細」を参照。

### おすすめの進め方（短く）

1. **S3+CloudFront を変えたくない** → **共有ハンドラ（方針 B）** を第一候補。`lib/api-handlers` にロジックを寄せ、`app/api` と Lambda の両方から呼ぶ。必要なら開発用 API をデプロイしてローカルから向ける（[API.md](./API.md)）。
2. **構成をとにかく揃えたい** → **本番も Next.js（方針 A）**。`output: "export"` をやめ、Vercel 等に載せれば `app/api` がそのまま本番で動く。
3. **Lambda の挙動をローカルでも試したい** → 方針 B のうえに **Serverless Offline** や **開発用 Lambda デプロイ**（下記 Part 2 の案2・案4）をのせる。

詳細な選択肢（方針 A〜D）と比較は、以前の `LOCAL_PROD_PARITY.md` の内容を [DESIGN.md](./DESIGN.md) や [API.md](./API.md) とあわせて参照してください。

---

## Part 2: ローカル環境を本番に近づける方法（実装オプション）

## 目次

1. [現在の構成](#現在の構成)
2. [選択肢の比較](#選択肢の比較)
3. [案1: LocalStack（完全ローカルエミュレーション）](#案1-localstack完全ローカルエミュレーション)
4. [案2: 開発用AWSリソース（現在の方法の改善）](#案2-開発用awsリソース現在の方法の改善)
5. [案3: Docker Compose + LocalStack](#案3-docker-compose--localstack)
6. [案4: Serverless Offline（API Gateway + Lambdaのみ）](#案4-serverless-offlineapi-gateway--lambdaのみ)
7. [推奨案](#推奨案)

---

## 現在の構成

**本番環境:**
- S3 + CloudFront（静的サイト配信）
- API Gateway + Lambda（バックエンドAPI）
- Cognito（認証）
- Secrets Manager（設定管理）

**現在のローカル環境:**
- Next.js開発サーバー（`npm run dev`）
- 実際のAWSリソースを使用（Cognito、S3、Secrets Manager）
- Next.js API Routes（`/app/api/*`）でAPIを提供

**課題:**
- 本番環境（API Gateway + Lambda）とローカル環境（Next.js API Routes）が異なる
- 本番環境の動作をローカルで再現しにくい
- 開発中にAWSコストが発生する可能性

> **ローカルと本番の構成を揃える方針**は、この doc の **Part 1: 方針とおすすめ** を参照してください。

---

## 選択肢の比較

| 案 | メリット | デメリット | 実装難易度 | コスト |
|---|---|---|---|---|
| **案1: LocalStack** | 完全にローカル、AWSコストなし、高速 | 一部の機能が制限される、セットアップが複雑 | 中 | 無料 |
| **案2: 開発用AWS** | 本番と完全に同じ、実装が簡単 | AWSコストが発生、環境分離が必要 | 低 | 低〜中 |
| **案3: Docker + LocalStack** | 再現性が高い、チームで共有しやすい | セットアップが複雑、Docker知識が必要 | 高 | 無料 |
| **案4: Serverless Offline** | Lambda関数をローカルでテスト可能 | CloudFront/S3のエミュレーションなし | 中 | 無料 |

---

## 案1: LocalStack（完全ローカルエミュレーション）

### 概要

LocalStackは、AWSサービスをローカルでエミュレートするツールです。Dockerコンテナで実行され、S3、API Gateway、Lambda、Cognito、Secrets Managerなどをローカルで再現できます。

### メリット

- ✅ **完全にローカル**: インターネット接続不要、AWSコストなし
- ✅ **高速**: ローカルネットワークで動作するため高速
- ✅ **本番に近い**: 本番環境と同じAWSサービスを使用
- ✅ **再現性**: チーム全員が同じ環境を構築可能

### デメリット

- ❌ **機能制限**: 一部のAWS機能が完全に再現されない場合がある
- ❌ **セットアップ複雑**: 初期セットアップに時間がかかる
- ❌ **メモリ使用**: Dockerコンテナがメモリを消費

### 実装方法

#### 1. LocalStackのインストール

```bash
# Docker Desktopがインストールされていることを確認
docker --version

# LocalStackを起動（docker-compose.ymlを使用）
docker-compose up -d localstack
```

#### 2. docker-compose.ymlの作成

プロジェクトルートに`docker-compose.yml`を作成：

```yaml
version: '3.8'

services:
  localstack:
    image: localstack/localstack:latest
    container_name: photo-gallery-localstack
    ports:
      - "4566:4566"            # LocalStackのメインエンドポイント
      - "4510-4559:4510-4559"  # 外部サービスエンドポイント
    environment:
      - SERVICES=s3,apigateway,lambda,cognito-idp,secretsmanager,iam
      - DEBUG=1
      - DATA_DIR=/tmp/localstack/data
      - DOCKER_HOST=unix:///var/run/docker.sock
    volumes:
      - "./localstack-data:/tmp/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 30s
      timeout: 10s
      retries: 5
```

#### 3. 環境変数の設定

`.env.local`に以下を追加：

```env
# LocalStack設定
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_DEFAULT_REGION=ap-northeast-1

# 本番環境の場合はコメントアウト
# AWS_ENDPOINT_URL=
```

#### 4. AWS SDKの設定変更

`lib/aws/secrets.ts`などを修正して、LocalStackエンドポイントを使用するように設定：

```typescript
import { S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || "ap-northeast-1",
  endpoint: process.env.AWS_ENDPOINT_URL, // LocalStackのエンドポイント
  credentials: process.env.AWS_ENDPOINT_URL ? {
    accessKeyId: "test",
    secretAccessKey: "test",
  } : undefined,
});
```

#### 5. リソースの初期化スクリプト

`scripts/init-localstack.ts`を作成して、LocalStackに必要なリソース（S3バケット、Cognito User Poolなど）を自動的に作成：

```typescript
// scripts/init-localstack.ts
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { CognitoIdentityProviderClient, CreateUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";

const endpoint = process.env.AWS_ENDPOINT_URL || "http://localhost:4566";

async function initLocalStack() {
  // S3バケットの作成
  const s3Client = new S3Client({
    endpoint,
    region: "ap-northeast-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  
  await s3Client.send(new CreateBucketCommand({
    Bucket: "photo-gallery-local",
  }));
  
  // Cognito User Poolの作成
  // ... (実装)
  
  console.log("✅ LocalStackの初期化が完了しました");
}

initLocalStack();
```

#### 6. package.jsonにスクリプトを追加

```json
{
  "scripts": {
    "localstack:up": "docker-compose up -d localstack",
    "localstack:down": "docker-compose down",
    "localstack:init": "tsx scripts/init-localstack.ts",
    "dev:localstack": "npm run localstack:up && npm run localstack:init && npm run dev"
  }
}
```

### 使用手順

```bash
# LocalStackを起動
npm run localstack:up

# リソースを初期化
npm run localstack:init

# 開発サーバーを起動
npm run dev
```

---

## 案2: 開発用AWSリソース（現在の方法の改善）

### 概要

現在の方法を改善し、本番環境とは別の開発用AWSリソースを使用します。環境変数で切り替えられるようにします。

### メリット

- ✅ **実装が簡単**: 既存のコードをほとんど変更不要
- ✅ **本番と完全に同じ**: 実際のAWSサービスを使用
- ✅ **信頼性が高い**: 本番環境と同じ動作が保証される

### デメリット

- ❌ **AWSコスト**: 開発中もAWSコストが発生
- ❌ **環境分離**: 本番と開発環境を分離する必要がある
- ❌ **セットアップ時間**: 各開発者がAWSリソースを準備する必要がある

### 実装方法

#### 1. 環境変数で切り替え

`.env.local`（開発環境）と`.env.production`（本番環境）を分離：

```env
# .env.local (開発環境)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
AWS_S3_BUCKET_NAME=dev-photo-gallery-uploads
AWS_SECRET_NAME=dev-photo-gallery-secrets
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_DEV123456
NEXT_PUBLIC_COGNITO_CLIENT_ID=dev-client-id-12345

# .env.production (本番環境)
NEXT_PUBLIC_API_BASE_URL=https://api.journey-photo.com
AWS_S3_BUCKET_NAME=prod-journey-photo-upload
AWS_SECRET_NAME=prod-journey-photo-secrets
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_PROD123456
NEXT_PUBLIC_COGNITO_CLIENT_ID=prod-client-id-12345
```

#### 2. 開発用AWSリソースの作成

本番環境とは別のリソースを作成：

- **S3バケット**: `dev-photo-gallery-uploads`
- **Cognito User Pool**: 開発用の別のUser Pool
- **Secrets Manager**: `dev-photo-gallery-secrets`
- **API Gateway + Lambda**: 開発用の別のスタック（オプション）

#### 3. コードの修正

`lib/utils/api.ts`などで、環境に応じてAPIエンドポイントを切り替え：

```typescript
export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    // サーバー側
    return process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
  }
  
  // クライアント側
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (baseUrl && baseUrl.startsWith("http")) {
    return baseUrl; // 本番環境（API Gateway）
  }
  return "/api"; // ローカル環境（Next.js API Routes）
}
```

#### 4. 開発用API Gateway + Lambdaのセットアップ（オプション）

本番環境と同じ構成で開発用のAPI Gateway + Lambdaを作成：

- **API Gateway**: `dev-photo-gallery-api`
- **Lambda関数**: 開発用の関数（環境変数で開発用S3バケットを指定）

---

## 案3: Docker Compose + LocalStack

### 概要

Docker ComposeでLocalStackとNext.js開発サーバーを一緒に管理します。

### メリット

- ✅ **完全にローカル**: インターネット接続不要
- ✅ **再現性**: チーム全員が同じ環境を構築可能
- ✅ **一括管理**: すべてのサービスを`docker-compose`で管理

### デメリット

- ❌ **セットアップ複雑**: DockerとLocalStackの知識が必要
- ❌ **メモリ使用**: 複数のコンテナがメモリを消費
- ❌ **デバッグが難しい**: コンテナ内でのデバッグが必要

### 実装方法

#### docker-compose.yml

```yaml
version: '3.8'

services:
  localstack:
    image: localstack/localstack:latest
    container_name: photo-gallery-localstack
    ports:
      - "4566:4566"
    environment:
      - SERVICES=s3,apigateway,lambda,cognito-idp,secretsmanager
      - DEBUG=1
    volumes:
      - "./localstack-data:/tmp/localstack"

  nextjs:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - AWS_ENDPOINT_URL=http://localstack:4566
      - AWS_ACCESS_KEY_ID=test
      - AWS_SECRET_ACCESS_KEY=test
    depends_on:
      - localstack
```

---

## 案4: Serverless Offline（API Gateway + Lambdaのみ）

### 概要

Serverless Frameworkの`serverless-offline`プラグインを使用して、API Gateway + Lambdaをローカルでエミュレートします。S3とCognitoは実際のAWSリソースを使用します。

### メリット

- ✅ **Lambda関数をローカルでテスト**: 本番環境と同じLambda関数をローカルで実行
- ✅ **実装が比較的簡単**: Serverless Frameworkの知識があれば実装しやすい
- ✅ **デバッグが容易**: ローカルでLambda関数をデバッグ可能

### デメリット

- ❌ **S3/Cognitoは実際のAWS**: 完全にローカルではない
- ❌ **Serverless Frameworkが必要**: 新しいツールの導入が必要

### 実装方法

#### 1. Serverless Frameworkのインストール

```bash
npm install -D serverless serverless-offline
```

#### 2. serverless.ymlの作成

```yaml
service: photo-gallery-api

provider:
  name: aws
  runtime: nodejs20.x
  region: ap-northeast-1
  environment:
    AWS_S3_BUCKET_NAME: ${env:AWS_S3_BUCKET_NAME}
    AWS_SECRET_NAME: ${env:AWS_SECRET_NAME}

functions:
  photos:
    handler: lambda/photos.handler
    events:
      - http:
          path: /photos
          method: get
          cors: true
  uploadPresignedUrl:
    handler: lambda/upload-presigned-url.handler
    events:
      - http:
          path: /upload/presigned-url
          method: post
          cors: true

plugins:
  - serverless-offline
```

#### 3. Lambda関数の実装

`lambda/photos.ts`などにLambda関数を実装。

#### 4. ローカル実行

```bash
# Serverless Offlineで起動
npx serverless offline

# 開発サーバーを起動（別ターミナル）
npm run dev
```

---

## 推奨案

### 開発段階に応じた推奨

1. **初期開発・プロトタイピング**: **案2（開発用AWSリソース）**
   - 実装が簡単で、すぐに始められる
   - 本番環境と同じ動作が保証される

2. **チーム開発・CI/CD**: **案1（LocalStack）**
   - コストがかからず、再現性が高い
   - CI/CDパイプラインでも使用可能

3. **完全にローカルで開発したい場合**: **案3（Docker Compose + LocalStack）**
   - インターネット接続不要
   - チーム全員が同じ環境を構築可能

4. **Lambda関数の詳細なテスト**: **案4（Serverless Offline）**
   - Lambda関数をローカルでデバッグ可能
   - 本番環境と同じコードをテスト可能

### ハイブリッドアプローチ（推奨）

**開発段階に応じて切り替え可能にする:**

```typescript
// lib/config/environment.ts
export const getEnvironment = () => {
  const useLocalStack = process.env.USE_LOCALSTACK === "true";
  const useDevAws = process.env.USE_DEV_AWS === "true";
  
  if (useLocalStack) {
    return {
      type: "localstack",
      endpoint: "http://localhost:4566",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    };
  }
  
  if (useDevAws) {
    return {
      type: "dev-aws",
      endpoint: undefined, // 実際のAWSを使用
      credentials: undefined, // AWS CLIの認証情報を使用
    };
  }
  
  return {
    type: "production",
    endpoint: undefined,
    credentials: undefined,
  };
};
```

`.env.local`で切り替え：

```env
# LocalStackを使用する場合
USE_LOCALSTACK=true

# 開発用AWSリソースを使用する場合
USE_DEV_AWS=true

# 本番環境（デフォルト）
# USE_LOCALSTACK=false
# USE_DEV_AWS=false
```

---

## 次のステップ

選択した案に応じて、詳細な実装手順を提供します。どの案を採用しますか？

> **構成の揃え方（ローカル vs 本番）**：  
> 本番も Next.js にするか、共有ハンドラで Lambda と揃えるかなど、方針の選び方はこの doc の **Part 1: 方針とおすすめ** を参照してください。

1. **案1: LocalStack** - 完全にローカルで開発したい
2. **案2: 開発用AWSリソース** - 現在の方法を改善したい
3. **案3: Docker Compose + LocalStack** - チーム開発に最適化したい
4. **案4: Serverless Offline** - Lambda関数を重点的にテストしたい
5. **ハイブリッド** - 開発段階に応じて切り替えたい
