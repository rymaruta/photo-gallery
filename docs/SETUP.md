# 初めてのセットアップガイド

このガイドでは、**アップロード機能を使うために必要なAWS設定**を初心者向けに説明します。

## 📋 このガイドの対象者

- ✅ **アップロード機能を使いたい人**（写真をアップロードしたい）
- ✅ **AWSを初めて使う人**（初心者向けに詳しく説明しています）

## ⚠️ 重要: 写真の閲覧だけならAWS設定は不要

写真の閲覧機能（ギャラリー表示、フィルタリング、お気に入りなど）は、**AWS設定なしで使えます**。  
まずは [クイックスタートガイド](./QUICK_START.md) で動作確認してから、アップロード機能を使う場合のみこのガイドを参照してください。

## 📋 目次

1. [必要なツール](#必要なツール)
2. [AWSリソースの準備](#awsリソースの準備)
3. [環境変数の設定](#環境変数の設定)
4. [アプリケーションの起動](#アプリケーションの起動)
5. [動作確認](#動作確認)
6. [トラブルシューティング](#トラブルシューティング)

---

## 必要なツール

### 1. Node.js のインストール

- **推奨バージョン**: Node.js 18.x 以上
- **インストール方法**: 
  - [公式サイト](https://nodejs.org/)からインストーラーをダウンロード
  - または、`nvm`（Node Version Manager）を使用してインストール

### 2. AWS CLI のインストール（推奨）

AWS CLIを使用すると、認証情報を安全に管理できます。

**Windows:**
1. [AWS CLI インストーラー](https://aws.amazon.com/cli/)をダウンロード
2. インストーラーを実行してインストール
3. コマンドプロンプトまたはPowerShellで確認：
   ```bash
   aws --version
   ```

**macOS:**
```bash
brew install awscli
```

**Linux:**
```bash
sudo apt-get install awscli
# または
sudo yum install awscli
```

### 3. Git のインストール

プロジェクトのクローンに必要です。

---

## AWSリソースの準備

### 1. AWS Cognito User Pool の作成

#### 1.1 User Pool の作成

1. AWSコンソールにログイン
2. 検索バーで「Cognito」を検索して開く
3. 「ユーザープールの作成」をクリック

**ステップ1: サインインオプション**
- ✅ **ユーザー名**を選択
- ✅ **メールアドレス**を選択
- 「次へ」をクリック

**ステップ2: セキュリティ設定**
- **パスワードポリシー**: 「Cognitoのデフォルト」を選択（またはカスタム設定）
  - 最小文字数: 8文字以上
  - 大文字、小文字、数字、記号を含む（推奨）
- **MFA**: 「オプション」を選択（必要に応じて有効化）
- 「次へ」をクリック

**ステップ3: アプリクライアント**
- 「アプリクライアントを作成」をクリック
- **クライアント名**: `photo-gallery-client`（任意の名前）
- ⚠️ **重要**: **「クライアントシークレットを生成しない」** を選択（推奨）
- **認証フロー**: 以下を選択
  - ✅ `ALLOW_USER_PASSWORD_AUTH`（必須）
  - ✅ `ALLOW_REFRESH_TOKEN_AUTH`（推奨）
- 「アプリクライアントを作成」をクリック
- 「次へ」をクリック

**ステップ4: 確認の手順**
- **確認**: 「メールによる確認」を選択
- 「次へ」をクリック

**ステップ5: 確認と作成**
- 設定を確認して「ユーザープールを作成」をクリック

#### 1.2 管理者グループの作成

1. 作成したユーザープールを選択
2. 左メニューから「グループ」を選択
3. 「グループを作成」をクリック
4. 以下の設定を入力：
   - **グループ名**: `admin`（⚠️ 正確にこの名前を使用）
   - **説明**: `管理者グループ`（任意）
   - **優先度**: `0`（デフォルト）
5. 「グループを作成」をクリック

#### 1.3 ユーザーの作成とグループへの追加

1. 左メニューから「ユーザー」を選択
2. 「ユーザーを作成」をクリック
3. 以下の情報を入力：
   - **ユーザー名**: 例: `admin`
   - **メールアドレス**: 管理者のメールアドレス（例: `admin@example.com`）
   - **一時パスワード**: 安全なパスワードを設定（例: `TempPass123!@#`）
   - ✅ **「メール確認済み」** にチェックを入れる（重要）
4. 「ユーザーを作成」をクリック
5. 作成したユーザーを選択
6. 「グループ」タブをクリック
7. 「グループに追加」をクリック
8. `admin`グループを選択して「グループに追加」をクリック

#### 1.4 必要な値を取得

**User Pool ID:**
1. ユーザープール一覧または詳細ページで確認
2. 形式: `ap-northeast-1_AbCdEfGhI`
3. 例: `ap-northeast-1_12345678`

**App Client ID:**
1. 左メニューから「アプリ統合」を選択
2. 「アプリクライアント」セクションでクライアントを選択
3. 「クライアントID」をコピー
4. 形式: 26文字の英数字
5. 例: `1a2b3c4d5e6f7g8h9i0j1k2l3m`

**Region:**
- ユーザープールを作成したリージョン（例: `ap-northeast-1`）

---

### 2. AWS S3 バケットの作成

#### 2.1 バケットの作成

1. AWSコンソールで「S3」を開く
2. 「バケットを作成」をクリック
3. 以下の設定を入力：
   - **バケット名**: 例: `photo-gallery-dev-uploads`（⚠️ 世界中で一意である必要があります）
   - **AWSリージョン**: `ap-northeast-1`（東京）
   - **オブジェクト所有権**: **ACL無効（推奨）** を選択
   - **このバケットのブロックパブリックアクセス設定**:
     - ✅ **すべてのチェックを外す（OFFにする）**（ローカル開発用）
     - ⚠️ 警告が表示されますが、「現在の設定により～」のチェックボックスにチェックを入れて進む
4. 「バケットを作成」をクリック

#### 2.2 バケットポリシーの設定

1. 作成したバケットを選択
2. 「アクセス許可」タブを開く
3. 「バケットポリシー」の「編集」をクリック
4. 以下のJSONを貼り付け（`your-bucket-name`を実際のバケット名に置き換える）：

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

5. 「変更の保存」をクリック

#### 2.3 CORS設定

1. 「アクセス許可」タブの一番下の「クロスオリジンリソース共有 (CORS)」の「編集」をクリック
2. 以下のJSONを貼り付け：

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

3. 「変更の保存」をクリック

---

### 3. AWS Secrets Manager のシークレット作成

#### 3.1 シークレットの作成

1. AWSコンソールで「Secrets Manager」を開く
2. 「新しいシークレットを保存する」をクリック
3. 以下の設定を選択：
   - **シークレットのタイプ**: 「その他のシークレット」を選択
   - **キー/値のペア**: 「追加」ボタンで以下を入力：

| キー | 値（例） | 説明 |
|------|---------|------|
| `AWS_REGION` | `ap-northeast-1` | AWSリージョン |
| `AWS_S3_BUCKET_NAME` | `photo-gallery-dev-uploads` | S3バケット名（上記で作成したバケット名） |
| `UPLOAD_API_KEY` | `dev-secret-key-12345` | サーバー側で使用するAPIキー（後で変更可能） |

**または、JSON形式で直接入力：**

```json
{
  "AWS_REGION": "ap-northeast-1",
  "AWS_S3_BUCKET_NAME": "photo-gallery-dev-uploads",
  "UPLOAD_API_KEY": "dev-secret-key-12345"
}
```

4. 「次へ」をクリック
5. **シークレットの名前**: `photo-gallery-secrets`（または任意の名前）
   - ⚠️ この名前をメモしてください（後で環境変数に設定します）
6. 「次へ」をクリック
7. **自動ローテーション**: 「無効」のまま（ローカル開発では不要）
8. 「次へ」をクリック
9. 確認して「保存」をクリック

#### 3.2 シークレット名の確認

1. Secrets Managerの「シークレット」一覧を開く
2. 作成したシークレットの「名前」をコピー
3. 例: `photo-gallery-secrets`

---

### 4. AWS CLI の設定（推奨）

AWS CLIを使用すると、認証情報を安全に管理できます。

#### 4.1 AWS CLIのインストール

**Windows:**
- [AWS CLI インストーラー](https://aws.amazon.com/cli/)をダウンロードしてインストール

**macOS:**
```bash
brew install awscli
```

**Linux:**
```bash
sudo apt-get install awscli
# または
sudo yum install awscli
```

#### 4.2 認証情報の設定

ターミナル（コマンドプロンプトまたはPowerShell）を開いて、以下を実行：

```bash
aws configure
```

以下の情報を入力：

```
AWS Access Key ID [None]: （AWSコンソールで取得したアクセスキーID）
AWS Secret Access Key [None]: （AWSコンソールで取得したシークレットアクセスキー）
Default region name [None]: ap-northeast-1
Default output format [None]: json
```

**アクセスキーの取得方法:**
1. AWSコンソール右上のユーザー名をクリック
2. 「セキュリティ認証情報」を選択
3. 「アクセスキー」セクションで「アクセスキーを作成」をクリック
4. ⚠️ **重要**: 表示される値を**必ずメモしてください**（一度しか表示されません）

#### 4.3 設定の確認

```bash
aws sts get-caller-identity
```

正しく設定されていれば、AWSアカウント情報が表示されます。

---

## 環境変数の設定

### 1. .env.local ファイルの作成

プロジェクトのルートディレクトリ（`package.json`がある場所）に`.env.local`ファイルを作成します。

### 2. 環境変数の設定

`.env.local`ファイルに以下の内容を記載（実際の値に置き換えてください）：

```env
# ============================================
# AWS Cognito設定（認証システム）
# ============================================
# 取得方法: AWS Cognito → ユーザープール → 全般設定 → ユーザープールID
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_12345678

# 取得方法: AWS Cognito → ユーザープール → アプリ統合 → アプリクライアント → クライアントID
NEXT_PUBLIC_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m

# AWSリージョン（通常は ap-northeast-1）
NEXT_PUBLIC_AWS_REGION=ap-northeast-1

# ============================================
# API設定
# ============================================
# Lambda APIを使用する場合（推奨）
# 開発用API GatewayのURLを設定
NEXT_PUBLIC_API_BASE_URL=https://vr9sellzx4.execute-api.ap-northeast-1.amazonaws.com

# ============================================
# AWS Secrets Manager設定
# ============================================
# Lambda APIが使用するシークレット名
AWS_SECRET_NAME=dev-journey-photo-upload

# AWSリージョン（Secrets Manager用）
AWS_REGION=ap-northeast-1

# ============================================
# サイト設定
# ============================================
# サイトのURL（SEO用、開発環境では localhost）
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**⚠️ 重要**: 
- Lambda APIを使用する場合は、`NEXT_PUBLIC_UPLOAD_API_KEY`は設定**不要**です（Cognito認証を使用）
- ローカルAPI（`app/api`）を使用する場合のみ、`NEXT_PUBLIC_UPLOAD_API_KEY`を設定してください

### ステップ3: 環境変数の確認

`.env.local`ファイルが以下のようになっていればOKです：

```env
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_12345678
NEXT_PUBLIC_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_BASE_URL=https://vr9sellzx4.execute-api.ap-northeast-1.amazonaws.com
AWS_SECRET_NAME=dev-journey-photo-upload
AWS_REGION=ap-northeast-1
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**⚠️ 重要**: 
- `AWS_ACCESS_KEY_ID`と`AWS_SECRET_ACCESS_KEY`は`.env.local`に設定**不要**です（AWS CLIで`aws configure`を実行した場合）
- Lambda APIを使用する場合は、`NEXT_PUBLIC_UPLOAD_API_KEY`は設定**不要**です（Cognito認証を使用）

---

## アプリケーションの起動

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

---

## 動作確認

### 1. ログインの確認

1. ヘッダーメニューから「ログイン」をクリック
2. 作成したユーザー名とパスワードを入力
3. 「ログイン」をクリック
4. ログインが成功し、ホームページにリダイレクトされることを確認

### 2. 管理者権限の確認

1. ログイン後、ヘッダーメニューに「Manage」リンクが表示されることを確認
2. 「Manage」をクリックして写真管理ページにアクセスできることを確認

### 3. アップロード機能の確認

1. ヘッダーメニューから「Upload」をクリック（または「Manage」ページから「新しい写真をアップロード」をクリック）
2. 写真ファイルを選択
3. タイトル、説明、場所、カテゴリ、タグを入力
4. 「アップロード」をクリック
5. アップロードが成功し、写真が一覧に表示されることを確認

---

## トラブルシューティング

### ログインできない場合

1. **User Pool IDとClient IDの確認**
   - `.env.local`の値が正しいか確認
   - AWSコンソールで再度確認

2. **アプリクライアントの設定確認**
   - AWSコンソール → Cognito → ユーザープール → アプリ統合
   - `ALLOW_USER_PASSWORD_AUTH`が有効になっているか確認

3. **ユーザーの状態確認**
   - ユーザーが確認済みか確認
   - ユーザーが有効か確認

### 管理者として認識されない場合

1. **ユーザーがadminグループに追加されているか確認**
   - AWSコンソール → Cognito → ユーザープール → ユーザー
   - ユーザーを選択 → 「グループ」タブ
   - `admin`グループが表示されているか確認
   - 表示されていない場合は、「グループに追加」から`admin`グループを追加

2. **ログアウトして再度ログイン**
   - グループを追加した後は、必ずログアウトして再度ログイン

### アップロードが失敗する場合

1. **AWS認証情報の確認**
   ```bash
   aws sts get-caller-identity
   ```
   - 正しく表示されない場合は、`aws configure`を再実行

2. **Secrets Managerのアクセス確認**
   - IAMユーザーに`SecretsManagerReadWrite`ポリシーがアタッチされているか確認

3. **S3バケットの権限確認**
   - バケットポリシーが正しく設定されているか確認
   - CORS設定が正しいか確認

4. **環境変数の確認**
   - `.env.local`の`AWS_SECRET_NAME`が正しいか確認
   - 開発サーバーを再起動（環境変数を変更した場合）

### 環境変数が読み込まれない場合

1. **ファイルの場所確認**
   - `.env.local`がプロジェクトルートにあるか確認
   - ファイル名が正確か確認（`.env.local`）

2. **開発サーバーの再起動**
   ```bash
   # Ctrl+C で停止してから
   npm run dev
   ```

3. **クライアント側の環境変数**
   - `NEXT_PUBLIC_`で始まる環境変数のみクライアント側で使用可能
   - サーバー側のみで使用する変数は`NEXT_PUBLIC_`を付けない

---

## 次のステップ

- **[環境設定の整理](./ENVIRONMENT_CONFIG.md)** - 開発/本番の設定一覧を確認
- **[本番デプロイ](./DEPLOY.md)** - 本番URL・CloudFront・Route 53・トラブル対処
- **[本番環境のセットアップ（詳細）](./PRODUCTION_SETUP.md)** - 本番環境へのデプロイ手順（詳細）
- **[トラブルシューティング](./TROUBLESHOOTING.md)** - アップロード・Lambda のエラー解決

### 参考資料（詳細を知りたい場合）

- **[認証の詳細](./AUTH_SETUP.md)** - Cognito の仕組み・本番時の設定
- **[アップロードの詳細](./UPLOAD_SETUP.md)** - S3 / Presigned URL の仕組み・CloudFront オプション
