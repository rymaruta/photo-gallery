# アップロード機能の詳細ガイド（参考資料）

**⚠️ このドキュメントは参考資料です。初心者の方は [初めてのセットアップ](./SETUP.md) を先に読んでください。**

## 📋 このドキュメントの対象者

- ✅ **アップロード機能の仕組みを詳しく知りたい人**
- ✅ **既に基本設定が完了している人**

## 📚 初心者の方はこちら

- **[初めてのセットアップ](./SETUP.md)** - AWS設定の基本手順（初心者向け）
- **[クイックスタートガイド](./QUICK_START.md)** - 5分で始める

---

## 概要

このアプリケーションは、以下の機能を提供します：

1. **AWS S3を使用したセキュアな写真アップロード機能**
   - Presigned URLを使用して、クライアントから直接S3にアップロード
   - サーバーの負荷を軽減し、高速なアップロードを実現

2. **AWS Cognitoを使用した認証システム**
   - 管理者のみがアップロード機能にアクセス可能
   - グループベースのアクセス制御

## 目次

1. [環境変数の設定](#環境変数の設定)
2. [AWS Cognitoのセットアップ](#aws-cognitoのセットアップ)
3. [AWS S3のセットアップ](#aws-s3のセットアップ)
4. [AWS Secrets Managerのセットアップ](#aws-secrets-managerのセットアップ)
5. [CloudFrontのセットアップ（オプション）](#cloudfrontのセットアップオプション)
6. [セキュリティの考慮事項](#セキュリティの考慮事項)
7. [使用方法](#使用方法)
8. [トラブルシューティング](#トラブルシューティング)

---

## 環境変数の設定

### 環境変数の一覧と取得方法

以下の表に、各環境変数の取得方法と設定場所をまとめています：

| 環境変数名 | 取得場所 | 形式の例 | 必須 | 説明 |
|-----------|---------|---------|------|------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | AWS Cognito User Pool | `ap-northeast-1_AbCdEfGhI` | ✅ | User PoolのID |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | AWS Cognito App Client | `1a2b3c4d5e6f7g8h9i0j1k2l3m` | ✅ | アプリクライアントのID |
| `NEXT_PUBLIC_AWS_REGION` | AWS Cognito User Pool | `ap-northeast-1` | ✅ | AWSリージョン |
| `AWS_SECRET_NAME` | AWS Secrets Manager | `photo-gallery-secrets` | ✅ | Secrets Managerのシークレット名（S3関連の設定を自動取得） |
| `NEXT_PUBLIC_UPLOAD_API_KEY` | 自分で生成（AWSから発行されない） | `your-secure-random-string-here` | ✅ | クライアント側APIキー（自分でランダム文字列を生成、必ず設定が必要） |

### ローカル開発環境

`.env.local`ファイルをプロジェクトルートに作成し、以下の環境変数を設定してください：

```env
# ============================================
# AWS Cognito設定（認証システム）
# ============================================
# 取得方法: AWS Cognito → ユーザープール → 全般設定 → ユーザープールID
# 例: ap-northeast-1_AbCdEfGhI
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_AbCdEfGhI

# 取得方法: AWS Cognito → ユーザープール → アプリ統合 → アプリクライアント → クライアントID
# 例: 1a2b3c4d5e6f7g8h9i0j1k2l3m
NEXT_PUBLIC_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m

# 取得方法: ユーザープールを作成したリージョン（通常は ap-northeast-1）
# 例: ap-northeast-1
NEXT_PUBLIC_AWS_REGION=ap-northeast-1

# ============================================
# AWS S3設定（アップロード機能）
# ============================================
# Secrets Managerから取得（推奨）
# 1. AWS Secrets Managerでシークレットを作成（詳細は後述の「AWS Secrets Managerのセットアップ」を参照）
# 2. 作成したシークレットの「名前」を以下に設定
# 3. シークレットには以下の値を保存: AWS_REGION, AWS_S3_BUCKET_NAME, UPLOAD_API_KEY, CLOUDFRONT_URL（オプション）
#
# 取得方法:
# - AWSコンソール → Secrets Manager → シークレット一覧
# - 作成したシークレットの「名前」をコピー（例: photo-gallery-secrets）
# - 以下の環境変数に設定
AWS_SECRET_NAME=photo-gallery-secrets
#
# ============================================
# AWS認証情報の設定（Secrets Managerにアクセスするために必要）
# ============================================
# ローカル開発環境でSecrets Managerを使用する場合、AWS認証情報が必要です
# 推奨方法: ~/.aws/credentialsファイルを使用
#   - AWS CLIをインストール: https://aws.amazon.com/cli/
#   - コマンドラインで実行: aws configure
#   - Access Key ID, Secret Access Key, Region を入力
#   - この場合、環境変数は不要です（AWS SDKが自動的に~/.aws/credentialsから読み込みます）

# ============================================
# セキュリティ設定（APIキー）
# ============================================
# ⚠️ 重要: これはAWSから発行されるキーではありません。自分で生成するランダムな文字列です。
#
# NEXT_PUBLIC_UPLOAD_API_KEY: クライアント側で使用（ブラウザに公開される）
# 生成方法（以下のいずれか）:
# 1. コマンドライン: openssl rand -hex 32
# 2. Node.js: require('crypto').randomBytes(32).toString('hex')
# 3. オンラインツール: ランダム文字列生成ツールを使用
#
# 例: z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4
# 注意: UPLOAD_API_KEY（Secrets Managerに保存）とは必ず別の値にしてください
NEXT_PUBLIC_UPLOAD_API_KEY=z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4
#
# 注意: UPLOAD_API_KEY（サーバー側で使用）はSecrets Managerに保存してください（.env.localには設定不要です）

# ============================================
# CloudFront URL (本番環境のみ、オプション)
# ============================================
# 注意: ローカル環境では不要です。本番環境でCDNを使用する場合のみ設定してください。
# この値はSecrets Managerに保存してください（.env.localには設定不要です）
# 取得方法: AWS CloudFront → ディストリビューション → ドメイン名
# 例: https://d1234567890abc.cloudfront.net
# 注意: CloudFrontを使用しない場合は設定不要（S3の直接URLが使用されます）
```

### 最終確認：.env.local の中身

プロジェクト直下の`.env.local`は、最終的に以下のようになっていればOKです：

```env
# ============================================
# AWS Cognito設定（認証システム）
# ============================================
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_AbCdEfGhI
NEXT_PUBLIC_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m
NEXT_PUBLIC_AWS_REGION=ap-northeast-1

# ============================================
# AWS S3設定（アップロード機能）
# ============================================
# Secrets Managerのシークレット名（上記の「AWS Secrets Managerのセットアップ」で作成した名前）
AWS_SECRET_NAME=photo-gallery-secrets

# ============================================
# セキュリティ設定（APIキー）
# ============================================
# クライアント側で使用するAPIキー（自分で生成したランダム文字列）
NEXT_PUBLIC_UPLOAD_API_KEY=z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4
```

**⚠️ 重要**: 
- `AWS_ACCESS_KEY_ID`と`AWS_SECRET_ACCESS_KEY`は`.env.local`に設定**不要**です（AWS CLIで`aws configure`を実行した場合）
- `UPLOAD_API_KEY`（サーバー側）はSecrets Managerに保存されているため、`.env.local`には設定不要です
- `CLOUDFRONT_URL`はローカル環境では不要です

### 各環境変数の詳細な取得方法

#### 1. AWS Cognito関連の環境変数

**`NEXT_PUBLIC_COGNITO_USER_POOL_ID`**
- **取得場所**: AWSコンソール → Cognito → ユーザープール → 作成したユーザープールを選択 → 「全般設定」タブ
- **表示場所**: 「ユーザープールID」の欄に表示
- **形式**: `ap-northeast-1_AbCdEfGhI`（リージョン_ランダム文字列）
- **例**: `ap-northeast-1_AbCdEfGhI`

**`NEXT_PUBLIC_COGNITO_CLIENT_ID`**
- **取得場所**: AWSコンソール → Cognito → ユーザープール → 作成したユーザープールを選択 → 「アプリ統合」タブ → アプリクライアントを選択
- **表示場所**: 「クライアントID」の欄に表示
- **形式**: 26文字の英数字
- **例**: `1a2b3c4d5e6f7g8h9i0j1k2l3m`

**`NEXT_PUBLIC_AWS_REGION`**
- **取得場所**: ユーザープールを作成したリージョン
- **一般的な値**: `ap-northeast-1`（東京リージョン）
- **例**: `ap-northeast-1`

#### 2. AWS S3関連の環境変数

**`AWS_SECRET_NAME`**
- **説明**: Secrets Managerに保存したシークレットの「名前」を設定します
- **取得場所**: AWSコンソール → Secrets Manager → シークレット一覧
- **表示場所**: 作成したシークレットの「名前」列に表示される値
- **形式**: 小文字、数字、ハイフンのみ（例: `photo-gallery-secrets`）
- **例**: `photo-gallery-secrets`
- **具体的な手順**:
  1. AWSコンソールにログイン
  2. 検索バーで「Secrets Manager」を検索して開く
  3. 左メニューから「シークレット」をクリック
  4. シークレット一覧で、作成したシークレットの「名前」を確認（例: `photo-gallery-secrets`）
  5. その名前を`.env.local`の`AWS_SECRET_NAME`に設定
- **注意**: 
  - この環境変数を設定すると、S3関連の設定（`AWS_REGION`、`AWS_S3_BUCKET_NAME`、`UPLOAD_API_KEY`、`CLOUDFRONT_URL`など）はSecrets Managerから自動的に取得されます
  - Secrets Managerにシークレットを作成していない場合は、先に「AWS Secrets Managerのセットアップ」セクションを参照してください

**ローカル開発環境でのAWS認証情報の設定**:
- **推奨方法**: `~/.aws/credentials`ファイルを使用
  - AWS CLIをインストールして設定: `aws configure`
  - この場合、AWS SDKが自動的に`~/.aws/credentials`から読み込み、Secrets Managerにアクセスできます

#### 3. APIキー関連の環境変数

**`NEXT_PUBLIC_UPLOAD_API_KEY`**

**⚠️ 重要**: これは**AWSから発行されるキーではありません**。自分で生成するランダムな文字列です。

- **説明**: アップロードAPIへのアクセスを保護するための認証キーです（クライアント側で使用）
- **生成方法**: 自分でランダムな文字列を生成（以下のいずれかの方法）
  - **コマンドライン（推奨）**: 
    ```bash
    openssl rand -hex 32
    # または
    openssl rand -base64 32
    ```
  - **Node.js**: 
    ```javascript
    require('crypto').randomBytes(32).toString('hex')
    ```
  - **オンラインツール**: ランダム文字列生成ツール（例: https://www.random.org/strings/）を使用
- **形式**: 64文字以上のランダムな英数字
- **例**: `z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4`
- **設定場所**: `.env.local`に直接設定（必ず設定が必要）
- **注意**: 
  - `UPLOAD_API_KEY`（サーバー側で使用、Secrets Managerに保存）とは**必ず別の値**にしてください
  - `NEXT_PUBLIC_UPLOAD_API_KEY`はブラウザに公開されるため、セキュリティ上別のキーを使用することを強く推奨します
  - `UPLOAD_API_KEY`はサーバー側でのみ使用され、Secrets Managerに保存してください（`.env.local`には設定不要です）

#### 4. CloudFront関連の環境変数（本番環境のみ、オプション）

**⚠️ 重要**: ローカル環境では**不要**です。本番環境でCDNを使用する場合のみ設定してください。

**注意**: この値はSecrets Managerに保存してください。`.env.local`には設定不要です。

**`CLOUDFRONT_URL`**（Secrets Managerに保存）
- **取得場所**: AWSコンソール → CloudFront → ディストリビューション → 作成したディストリビューションを選択
- **表示場所**: 「ドメイン名」の欄に表示
- **形式**: `https://d1234567890abc.cloudfront.net`
- **動作**: 
  - 設定されている場合: アップロードされた画像のURLにCloudFront URLが使用されます
  - 設定されていない場合: S3の直接URL（`https://バケット名.s3.リージョン.amazonaws.com/...`）が使用されます
- **推奨**: 本番環境でCDNを使用する場合のみ設定。ローカル環境では設定不要

### 本番環境（Vercel等）

本番環境では、AWS Secrets Managerから設定を取得します。

#### 1. 環境変数の設定

Vercelなどの環境変数設定に以下を追加：

```env
# ============================================
# AWS Cognito設定（認証システム）
# 取得方法: ローカル開発環境と同じ（上記参照）
# ============================================
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_AbCdEfGhI
NEXT_PUBLIC_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m
NEXT_PUBLIC_AWS_REGION=ap-northeast-1

# ============================================
# AWS Secrets Manager設定
# ============================================
# 取得方法: AWS Secrets Manager → 作成したシークレットの名前
# 例: photo-gallery-secrets
AWS_SECRET_NAME=photo-gallery-secrets

# ⚠️ 重要: IAMロールを使用する場合、AWS認証情報の環境変数は不要です
# AWS SDKが自動的にIAMロールを使用します
# Secrets Managerから以下の値が自動的に取得されます:
# - AWS_REGION
# - AWS_S3_BUCKET_NAME
# - UPLOAD_API_KEY
# - CLOUDFRONT_URL（オプション）

# ============================================
# クライアント側で使用するAPIキー（公開環境変数として設定）
# 生成方法: ローカル開発環境と同じ（上記参照）
# ============================================
NEXT_PUBLIC_UPLOAD_API_KEY=z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4
```

#### 2. 本番環境での環境変数の違い

**ローカル開発環境と本番環境で同じ値を使用するもの:**
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_AWS_REGION`
- `NEXT_PUBLIC_UPLOAD_API_KEY`

**本番環境でSecrets Managerから取得するもの（環境変数には設定しない）:**
- `AWS_REGION`
- `AWS_S3_BUCKET_NAME`
- `UPLOAD_API_KEY`
- `CLOUDFRONT_URL`（オプション）

**本番環境で追加で設定するもの:**
- `AWS_SECRET_NAME`: Secrets Managerのシークレット名

**⚠️ IAMロールを使用する場合（推奨）:**
- Vercelなどのサーバーレス環境では、IAMロールを使用することを強く推奨します
- IAMロールを使用する場合、`AWS_ACCESS_KEY_ID`と`AWS_SECRET_ACCESS_KEY`は設定不要です
- AWS SDKが自動的にIAMロールの認証情報を使用します
- Secrets ManagerへのアクセスもIAMロールで可能です（VercelのIAMロールに適切な権限を付与）

#### 2. IAMロール/ユーザーの権限設定

Secrets ManagerにアクセスするためのIAMロール/ユーザーに以下のポリシーをアタッチ：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-1:YOUR_ACCOUNT_ID:secret:photo-gallery-secrets-*"
    }
  ]
}
```

**注意**: Vercelなどのサーバーレス環境では、実行環境のIAMロールが自動的に使用されます。その場合は、Vercelの環境変数にAWS認証情報を設定する必要はありません。

---

## AWS Cognitoのセットアップ

### 1. Cognito User Poolの作成

1. AWSコンソールでCognitoサービスに移動
2. 「ユーザープールの作成」をクリック
3. 以下の設定で進む：

   **ステップ1: サインインオプション**
   - ユーザー名とメールアドレスを選択
   - パスワードポリシー: 必要に応じて設定（推奨: 最小8文字、大文字・小文字・数字・記号を含む）

   **ステップ2: セキュリティ設定**
   - MFA: オプション（必要に応じて有効化）
   - パスワードポリシー: 適切に設定

   **ステップ3: アプリクライアント**
   - 「アプリクライアントを作成」をクリック
   - クライアント名を設定（例: `photo-gallery-client`）
   - **⚠️ 重要: クライアントシークレットを生成しない** を選択（推奨）
     - シークレットありのクライアントを使用する場合は、追加の設定が必要です
     - シークレットなしのクライアントを使用することを強く推奨します
   - **認証フロー**: 以下のフローを有効化（重要）
     - ✅ `ALLOW_USER_PASSWORD_AUTH`（必須）
     - ✅ `ALLOW_REFRESH_TOKEN_AUTH`（推奨）
   - 「アプリクライアントを作成」をクリック

   **ステップ4: 確認の手順**
   - メールによる確認を選択
   - 必要に応じてカスタムメールテンプレートを設定

4. 「ユーザープールを作成」をクリック

### 2. 管理者グループの作成

1. 作成したユーザープールの「グループ」タブに移動
2. 「グループを作成」をクリック
3. 以下の設定を入力：
   - **グループ名**: `admin`（正確にこの名前を使用）
   - **説明**: 管理者グループ（任意）
   - **優先度**: 0（デフォルト）
4. 「グループを作成」をクリック

### 3. ユーザーの作成とグループへの追加

1. 「ユーザー」タブに移動
2. 「ユーザーを作成」をクリック
3. 以下の情報を入力：
   - **ユーザー名**: 管理者のユーザー名（例: `admin`）
   - **メールアドレス**: 管理者のメールアドレス
   - **一時パスワード**: 安全なパスワードを設定
   - **メール確認済み**: ✅ チェック（本番環境では推奨）
4. 「ユーザーを作成」をクリック
5. 作成したユーザーを選択
6. 「グループに追加」をクリック
7. `admin`グループを選択して追加

**重要**: 初回ログイン時に、一時パスワードの変更が求められる場合があります。

### 4. アプリクライアントの設定確認

1. 「アプリ統合」タブに移動
2. 作成したアプリクライアントを選択
3. 「認証フロー」セクションで以下が有効になっているか確認：
   - ✅ `ALLOW_USER_PASSWORD_AUTH`
   - ✅ `ALLOW_REFRESH_TOKEN_AUTH`

### 5. 必要な値を取得

設定が完了したら、以下の値を取得して環境変数に設定：

- **User Pool ID**: 
  - ユーザープール一覧ページまたはユーザープールの詳細ページのURLに表示
  - 形式: `ap-northeast-1_XXXXXXXXX`
  - または、ユーザープールの詳細ページの「全般設定」セクションに表示

- **App Client ID**: 
  - 「アプリ統合」タブ → アプリクライアント → クライアントID
  - 形式: `xxxxxxxxxxxxxxxxxxxxxxxxxx`

- **Region**: 
  - ユーザープールを作成したリージョン（例: `ap-northeast-1`）

- **Identity Pool ID** (オプション):
  - Cognito Identity Poolを作成した場合のID
  - 形式: `ap-northeast-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

### 6. 認証フロー

1. ユーザーが`/login`ページでユーザー名とパスワードを入力
2. Cognitoで認証を実行
3. 認証成功後、ユーザーのグループをチェック
4. `admin`グループに属している場合のみアップロード機能にアクセス可能
5. セッションはブラウザに保存され、次回アクセス時に自動的に認証状態を確認

### 7. 保護されているページ

- `/upload`: 管理者のみがアクセス可能
- 管理者でない場合、自動的に`/login`にリダイレクト

### 8. ヘッダーナビゲーション

- アップロードリンクは管理者のみに表示されます
- 一般ユーザーには表示されません

---

## AWS S3のセットアップ

### 1. S3バケットの作成

1. AWSコンソールでS3サービスに移動
2. 「バケットを作成」をクリック
3. 以下の設定を入力：
   - **バケット名**: 一意の名前を設定（例: `journey-photo-assets-local-2026` または `photo-gallery-uploads`）
     - ⚠️ 注意: バケット名は世界中で一意である必要があります
   - **AWSリージョン**: `ap-northeast-1`（アジアパシフィック（東京））
   - **オブジェクト所有権**: **ACL無効（推奨）** を選択
   - **このバケットのブロックパブリックアクセス設定**: 
     - **ローカル開発環境**: すべてのチェックを外す（OFFにする）ことを推奨
       - ⚠️ 警告が表示されますが、「現在の設定により～」の承諾ボックスにチェックを入れて進んでください
       - 理由: CloudFrontの設定なしで、すぐにアップロードした画像を表示確認するため
     - **本番環境**: CloudFrontを使用する場合はブロックを維持
4. 「バケットを作成」をクリック

### 2. バケットポリシーの設定

アップロードされたファイルを公開読み取り可能にする場合、以下のバケットポリシーを設定：

1. 作成したバケット名をクリック
2. 「アクセス許可」タブを開く
3. 「バケットポリシー」の「編集」をクリック
4. 以下のJSONを貼り付けて「変更の保存」をクリック

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

**⚠️ 重要**: `your-bucket-name` の部分を、ステップ1で作成したバケット名に置き換えてください。

**注意**: 
- ローカル開発環境では、このポリシーで画像を直接表示できます
- 本番環境でCloudFrontを使用する場合は、このポリシーは不要です。CloudFront経由でのみアクセス可能にします

### 3. CORS設定

ローカルPC（localhost）からS3へ直接画像をアップロードする許可を与えます：

1. 作成したバケット名をクリック
2. 「アクセス許可」タブを開く
3. 一番下の「クロスオリジンリソース共有 (CORS)」の「編集」をクリック
4. 以下のJSONを貼り付けて「変更の保存」をクリック

**ローカル開発環境用（推奨）:**

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedOrigins": ["http://localhost:3000"],
    "ExposeHeaders": ["ETag"]
  }
]
```

**本番環境用（特定のドメインに制限）:**

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
    "AllowedOrigins": [
      "https://your-domain.com",
      "https://www.your-domain.com"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### 4. IAMロールまたはIAMユーザーの作成と権限設定

**⚠️ 重要**: 本番環境（Vercel等）では、IAMロールを使用することを強く推奨します。IAMロールを使用する場合、アクセスキーとシークレットキーは不要です。

#### オプションA: IAMロールを使用する場合（本番環境推奨）

**Vercelでの設定:**
1. Vercelプロジェクトの設定 → 「Settings」→ 「AWS」セクション
2. AWSアカウントIDとIAMロールARNを設定
3. または、Vercel CLIを使用: `vercel env add AWS_ROLE_ARN`

**IAMロールの作成:**
1. AWSコンソール → IAM → ロール → 「ロールを作成」
2. 「信頼されたエンティティタイプ」: 「カスタム信頼ポリシー」を選択
3. 信頼ポリシー（Vercelの場合）:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "vercel"
        }
      }
    }
  ]
}
```
4. 以下のポリシーをアタッチ：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/uploads/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name",
      "Condition": {
        "StringLike": {
          "s3:prefix": "uploads/*"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-1:YOUR_ACCOUNT_ID:secret:photo-gallery-secrets-*"
    }
  ]
}
```

5. ロール名を設定（例: `photo-gallery-vercel-role`）
6. 「ロールを作成」をクリック
7. **環境変数は設定不要**: AWS SDKが自動的にIAMロールを使用します

#### ローカル開発環境での認証情報の設定

**ステップ1: IAMユーザーとアクセスキーの作成**

ローカルのNext.jsアプリが「S3に書き込んでいいよ」という許可証（アクセスキー）を作ります：

1. AWSコンソールで「IAM」を開く
2. 「ユーザー」→「ユーザーの作成」をクリック
3. ユーザー名: `local-dev-user` など（任意の名前）
4. 「許可のオプション」: **「ポリシーを直接アタッチする」** を選択
5. 許可ポリシー: 検索窓で以下を検索し、チェックを入れる：
   - `AmazonS3FullAccess`
   - `SecretsManagerReadWrite`
   - ⚠️ 注意: 本来はもっと権限を絞るべきですが、開発用なのでこれで進めます
6. 「ユーザーを作成」をクリック
7. 作成したユーザー名をクリック → 「セキュリティ認証情報」タブ
8. 「アクセスキーを作成」→「ローカルコード」を選択 → 作成
9. 表示される「アクセスキー」と「シークレットアクセスキー」をメモしてください
   - ⚠️ 重要: シークレットキーは一度しか表示されません。必ずメモしてください

**ステップ2: AWS CLIで認証情報を設定（推奨方法）**

`.env`にキーを書くのはセキュリティリスクがあるため、AWS公式が推奨する**「AWS CLI」を使った設定**を行います：

1. ターミナル（VSCodeのターミナルでOK）を開く
2. 以下のコマンドを入力：
   ```bash
   aws configure
   ```
   - ⚠️ `command not found` と出る場合は、AWS CLIのインストールが必要です
     - Windows: https://aws.amazon.com/cli/ からインストーラーをダウンロード
     - macOS: `brew install awscli`
     - Linux: `sudo apt-get install awscli` または `sudo yum install awscli`
3. 聞かれた通りに入力：
   - **AWS Access Key ID**: ステップ1でメモしたアクセスキー
   - **AWS Secret Access Key**: ステップ1でメモしたシークレットキー
   - **Default region name**: `ap-northeast-1`
   - **Default output format**: `json`

これを行うと、Next.js（AWS SDK）が勝手にこの設定を読み込んでくれるので、`.env.local`にキーを書く必要がなくなります。

**代替方法（AWS CLIを使用しない場合）:**

- `.env.local`に`AWS_ACCESS_KEY_ID`と`AWS_SECRET_ACCESS_KEY`を設定
- ⚠️ セキュリティ上、この方法は推奨されません

### 5. ライフサイクルポリシー（オプション）

古いファイルを自動的に削除またはアーカイブする場合：

1. バケットの「管理」タブに移動
2. 「ライフサイクルルール」セクションでルールを作成
3. 例: 90日以上経過したファイルを削除

---

## AWS Secrets Managerのセットアップ

### 1. Secrets Managerにシークレットを作成

アプリは「環境変数をSecrets Managerから取ってくる」構成になっているため、これを作成します：

1. AWSコンソールで「Secrets Manager」を開く
2. 「新しいシークレットを保存する」をクリック
3. 以下の設定を選択：
   - **シークレットのタイプ**: 「その他のシークレット」を選択
   - **キー/値のペア**: 「追加」ボタンで行を増やしながら、以下を入力：

| キー | 値（例） | 説明 |
|------|---------|------|
| `AWS_REGION` | `ap-northeast-1` | AWSリージョン |
| `AWS_S3_BUCKET_NAME` | `journey-photo-assets-local-2026` | ステップ1で作成したバケット名 |
| `UPLOAD_API_KEY` | `test-secret-key-12345` | 適当な文字列でOK（後で変更可能） |
| `CLOUDFRONT_URL` | （空欄のままでOK） | ローカル環境では不要 |

**または、JSON形式で直接入力する場合:**

```json
{
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "journey-photo-assets-local-2026",
  "UPLOAD_API_KEY": "test-secret-key-12345",
  "CLOUDFRONT_URL": ""
}
```

4. **シークレットの名前**: `photo-gallery-secrets`（または任意の名前）
   - ⚠️ 重要: この名前を`.env.local`の`AWS_SECRET_NAME`に設定します
5. 「次へ」をクリック
6. 自動ローテーション: 必要に応じて設定（オプション、ローカル開発では不要）
7. 「次へ」をクリック
8. 確認して「保存」をクリック

**注意**: 
- `UPLOAD_API_KEY`は後で変更可能です。より安全なランダム文字列に変更することを推奨します
- `CLOUDFRONT_URL`はローカル環境では空欄でOKです。本番環境でCDNを使用する場合のみ設定してください

### 2. IAMロールの権限設定

**IAMロールを使用する場合（推奨）:**
- 上記の「AWS S3のセットアップ」セクションの「オプションA: IAMロールを使用する場合」で作成したIAMロールに、Secrets Managerへのアクセス権限が既に含まれています
- 追加の設定は不要です

**注意**: `YOUR_ACCOUNT_ID`を実際のAWSアカウントIDに置き換えてください。

### 3. 環境変数の設定

本番環境（Vercel等）で以下の環境変数を設定：

```env
# Secrets Managerのシークレット名
AWS_SECRET_NAME=photo-gallery-secrets

# AWSリージョン（Secrets Managerにアクセスするため）
AWS_REGION=ap-northeast-1

# ⚠️ 注意: IAMロールを使用する場合、AWS_ACCESS_KEY_IDとAWS_SECRET_ACCESS_KEYは不要です
# AWS SDKが自動的にIAMロールの認証情報を使用します
```

---

## CloudFrontのセットアップ（オプション）

CDNを使用して画像の配信速度を向上させる場合：

### 1. CloudFrontディストリビューションの作成

1. AWSコンソールでCloudFrontサービスに移動
2. 「ディストリビューションを作成」をクリック
3. 以下の設定を入力：
   - **Origin Domain**: S3バケットを選択
   - **Origin Path**: `/uploads`（アップロードされたファイルのみを配信）
   - **Viewer Protocol Policy**: `Redirect HTTP to HTTPS`（推奨）
   - **Allowed HTTP Methods**: `GET, HEAD, OPTIONS`（必要に応じて`PUT`も追加）
   - **Cache Policy**: `CachingOptimized`またはカスタムポリシー
   - **Origin Request Policy**: `CORS-S3Origin`（CORSを使用する場合）
4. 「ディストリビューションを作成」をクリック

### 2. 環境変数の設定

`CLOUDFRONT_URL`環境変数にディストリビューションのURLを設定：

```env
CLOUDFRONT_URL=https://d1234567890abc.cloudfront.net
```

### 3. S3バケットポリシーの更新

CloudFrontを使用する場合、S3バケットへの直接アクセスを制限することを推奨：

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
      "Resource": "arn:aws:s3:::your-bucket-name/uploads/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/DISTRIBUTION_ID"
        }
      }
    }
  ]
}
```

---

## セキュリティの考慮事項

### APIキーの管理

- `UPLOAD_API_KEY`はサーバー側でのみ使用され、クライアントには公開されません
- `NEXT_PUBLIC_UPLOAD_API_KEY`はクライアント側で使用されますが、これは別のキーにすることが推奨されます
- 本番環境では、環境変数は安全に管理してください（例: Vercelの環境変数設定）
- APIキーは定期的にローテーションすることを推奨

### Cognito認証のセキュリティ

- パスワードポリシーを適切に設定してください：
  - 最小文字数: 8文字以上
  - 大文字、小文字、数字、記号の組み合わせ
- MFA（多要素認証）を有効化することを推奨
- セッション管理：
  - セッションはCognitoによって管理されます
  - トークンの有効期限はデフォルトで1時間
  - リフレッシュトークンにより自動的に更新されます

### ファイルサイズ制限

現在、10MBまでのファイルサイズ制限が設定されています。変更する場合は：

- `app/api/upload/presigned-url/route.ts`の`fileSize > 10 * 1024 * 1024`を変更
- `app/upload/page.tsx`の`selectedFile.size > 10 * 1024 * 1024`を変更

### ファイルタイプの制限

現在、画像ファイルのみが許可されています。変更する場合は：

- `app/api/upload/presigned-url/route.ts`の`fileType.startsWith("image/")`チェックを変更

### S3バケットのセキュリティ

- バケットポリシーを適切に設定
- CORS設定を本番環境では特定のドメインに制限
- IAMユーザーには最小限の権限のみを付与（最小権限の原則）

---

## 使用方法

### 1. アプリケーションの起動

```bash
npm run dev
```

### 2. 管理者としてログイン

1. ヘッダーメニューから「ログイン」を選択
2. 管理者のユーザー名とパスワードを入力
3. 「ログイン」ボタンをクリック

### 3. 写真のアップロード

1. ヘッダーメニューから「アップロード」を選択（管理者のみ表示）
2. 写真を選択（ドラッグ&ドロップまたはクリック）
3. タイトル、説明、場所、カテゴリ、タグを入力（任意）
4. 「アップロード」ボタンをクリック

アップロードが完了すると、自動的にホームページにリダイレクトされます。

---

## トラブルシューティング

### アップロードが失敗する場合

1. **環境変数の確認**
   - `.env.local`ファイルが正しく設定されているか確認
   - 本番環境では、Vercelの環境変数設定を確認

2. **AWS認証情報の確認**
   - AWSの認証情報が有効か確認
   - IAMユーザーに適切な権限があるか確認

3. **S3バケットの権限設定**
   - バケットポリシーが正しく設定されているか確認
   - CORS設定が正しいか確認

4. **ブラウザのコンソール**
   - ブラウザのコンソールでエラーメッセージを確認
   - ネットワークタブでAPIリクエストのステータスを確認

### Presigned URLの生成に失敗する場合

1. **AWS SDKの認証情報**
   - `AWS_ACCESS_KEY_ID`と`AWS_SECRET_ACCESS_KEY`が正しいか確認
   - IAMユーザーに`S3:PutObject`権限があるか確認

2. **S3バケット名**
   - バケット名が正しいか確認
   - バケットが存在するか確認

3. **リージョン**
   - リージョンが正しいか確認
   - バケットとリージョンが一致しているか確認

### ログインできない場合

1. **User Pool IDとClient ID**
   - `NEXT_PUBLIC_COGNITO_USER_POOL_ID`が正しいか確認
   - `NEXT_PUBLIC_COGNITO_CLIENT_ID`が正しいか確認

2. **アプリクライアントの設定**
   - アプリクライアントで`ALLOW_USER_PASSWORD_AUTH`が有効になっているか確認
   - ブラウザのコンソールでエラーメッセージを確認

3. **ユーザーの状態**
   - ユーザーが正しく作成され、確認済みか確認
   - ユーザーが有効になっているか確認

### 管理者として認識されない場合

**⚠️ 最も一般的な原因**: ユーザーが`admin`グループに追加されていない

#### 解決手順

1. **AWSコンソールで確認・修正**
   - AWSコンソール → Cognito → ユーザープール
   - 「ユーザー」タブ → ログインしたユーザーを選択
   - 「グループ」タブを確認
   - `admin`グループが表示されているか確認
   - **表示されていない場合**:
     - 「グループに追加」をクリック
     - `admin`グループを選択して追加
   - 追加後、**再度ログイン**してください（グループ情報はログイン時に取得されます）

2. **グループ名の確認**
   - グループ名が正確に`admin`（大文字小文字も含む）か確認
   - `Admin`や`ADMIN`など、大文字小文字が異なると認識されません

3. **ログアウトと再ログイン**
   - グループを追加した後は、必ずログアウトして再度ログインしてください
   - ブラウザのキャッシュをクリアすることも推奨

4. **トークンの確認（デバッグ用）**
   - ブラウザの開発者ツール（F12）→ コンソールタブ
   - ログイン時に「IDトークンのペイロード」のログを確認
   - `groups: ["admin"]` が含まれているか確認
   - `groups: []`（空配列）の場合は、グループが追加されていません

### 環境変数が読み込まれない場合

1. **ファイルの場所**
   - `.env.local`ファイルがプロジェクトルートに存在するか確認
   - ファイル名が正確か確認（`.env.local`）

2. **環境変数名**
   - クライアント側で使用する変数は`NEXT_PUBLIC_`で始まる必要がある
   - サーバー側のみで使用する変数は`NEXT_PUBLIC_`を付けない

3. **開発サーバーの再起動**
   - 環境変数を変更した後は、開発サーバーを再起動

### Secrets Managerから取得できない場合

1. **シークレット名**
   - `AWS_SECRET_NAME`が正しいか確認
   - シークレットが存在するか確認

2. **IAM権限**
   - IAMユーザー/ロールに`secretsmanager:GetSecretValue`権限があるか確認
   - リソースARNが正しいか確認

3. **リージョン**
   - `AWS_REGION`が正しいか確認
   - シークレットが存在するリージョンと一致しているか確認

---

## 今後の改善案

### アップロード機能

- [ ] 画像のリサイズ機能
- [ ] 複数ファイルの一括アップロード
- [ ] アップロード進捗の詳細表示
- [ ] 画像のプレビュー機能の強化
- [ ] EXIFデータの自動抽出
- [ ] 画像の最適化（WebP変換など）

### 認証機能

- [ ] パスワードリセット機能
- [ ] メール確認の自動化
- [ ] ログアウト確認ダイアログ
- [ ] セッションタイムアウトの警告
- [ ] 複数の管理者グループのサポート
- [ ] アクセスログの記録
- [ ] ログイン試行回数の制限

### セキュリティ

- [ ] APIキーの自動ローテーション
- [ ] レート制限の実装
- [ ] IPアドレスベースのアクセス制限
- [ ] アップロードファイルのウイルススキャン

---

## 参考リンク

- [AWS S3 ドキュメント](https://docs.aws.amazon.com/s3/)
- [AWS Cognito ドキュメント](https://docs.aws.amazon.com/cognito/)
- [AWS Secrets Manager ドキュメント](https://docs.aws.amazon.com/secretsmanager/)
- [AWS CloudFront ドキュメント](https://docs.aws.amazon.com/cloudfront/)
- [Next.js 環境変数](https://nextjs.org/docs/basic-features/environment-variables)
