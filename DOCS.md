# Photo Gallery — 開発ドキュメント

## 目次
1. [プロジェクト概要](#プロジェクト概要)
2. [技術スタック](#技術スタック)
3. [ディレクトリ構成](#ディレクトリ構成)
4. [開発環境セットアップ](#開発環境セットアップ)
5. [環境変数](#環境変数)
6. [テスト](#テスト)
7. [デプロイ](#デプロイ)
8. [アーキテクチャ](#アーキテクチャ)

---

## プロジェクト概要

写真作品を公開するポートフォリオサイト。フロントエンドは Next.js (静的エクスポート) で構築し、AWS S3 + CloudFront で配信。写真のアップロードや管理には AWS Lambda (API Gateway) を使用。

---

## 技術スタック

| 用途 | 技術 |
|---|---|
| フロントエンド | Next.js 16 (App Router), React 19 |
| スタイリング | Tailwind CSS v4 |
| 認証 | AWS Cognito (amazon-cognito-identity-js) |
| ストレージ | AWS S3 |
| CDN | AWS CloudFront |
| API | AWS Lambda + API Gateway (Serverless Framework) |
| 秘密情報管理 | AWS Secrets Manager |
| テスト | Vitest + React Testing Library |

---

## ディレクトリ構成

```
photo-gallery/
├── app/                        # Next.js App Router
│   ├── components/             # 共通UIコンポーネント
│   │   ├── GalleryGrid.tsx     # 写真グリッド表示
│   │   ├── GalleryModal.tsx    # 写真拡大モーダル
│   │   ├── FilterBar.tsx       # カテゴリ・タグフィルタ
│   │   ├── HeaderNav.tsx       # ヘッダーナビゲーション
│   │   ├── Footer.tsx          # フッター
│   │   └── Toast.tsx           # トースト通知
│   ├── data/
│   │   └── photos.ts           # 写真データ定義・ユーティリティ関数
│   ├── hooks/
│   │   └── useGallery.tsx      # ギャラリーのフィルタ・ソート・モーダル管理
│   ├── i18n/
│   │   ├── labels.ts           # 日英ラベル定義
│   │   ├── context.tsx         # LocaleProvider・useLocale Hook
│   │   └── about.ts            # Aboutページ用テキスト
│   ├── auth/
│   │   └── context.tsx         # AuthProvider・useAuth Hook
│   ├── api/                    # ローカル開発用 API Routes
│   │   ├── photos/             # 写真一覧・詳細取得
│   │   └── upload/             # Presigned URL発行・保存
│   ├── gallery/page.tsx        # ギャラリーページ
│   ├── photo/[id]/page.tsx     # 写真詳細ページ
│   ├── favorites/page.tsx      # お気に入りページ
│   ├── history/page.tsx        # 閲覧履歴ページ
│   ├── upload/page.tsx         # アップロードページ（要認証）
│   ├── admin/page.tsx          # 管理ページ（要admin権限）
│   ├── layout.tsx              # ルートレイアウト
│   └── globals.css             # グローバルスタイル
├── lib/                        # サーバー/クライアント共通ロジック
│   ├── auth/
│   │   ├── cognito.ts          # Cognito認証関数
│   │   └── config.ts           # Cognito設定（環境変数）
│   ├── aws/
│   │   └── secrets.ts          # Secrets Manager / 設定取得
│   ├── hooks/
│   │   ├── useFavorites.ts     # お気に入り（localStorage）
│   │   ├── useViewHistory.ts   # 閲覧履歴（localStorage）
│   │   ├── useSwipe.ts         # スワイプジェスチャー
│   │   └── useImagePreloader.ts # 画像プリロード
│   ├── utils/
│   │   ├── log.ts              # ログユーティリティ（本番: warn/errorのみ）
│   │   ├── seo.ts              # SEO・構造化データ生成
│   │   ├── share.ts            # シェア機能
│   │   └── string.ts           # 文字列ユーティリティ
│   └── types/
│       └── gallery.ts          # GalleryFilters 型定義
├── vitest.config.ts            # Vitestの設定
├── vitest.setup.ts             # テストのセットアップ（jest-dom）
├── next.config.ts              # Next.js設定（静的エクスポート）
├── postcss.config.mjs          # PostCSS設定（Tailwind v4）
└── tailwind.config.js          # Tailwind設定（コンテンツパス）
```

---

## 開発環境セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.local` を作成（下記「環境変数」セクション参照）。

### 3. 開発サーバーの起動

```bash
npm run dev
# http://localhost:3000 でアクセス可能
```

ローカルでは `app/api/` の API Routes を使用して写真の取得・アップロードが行われる。

---

## 環境変数

`.env.local` に以下を設定する。本番では AWS Secrets Manager で管理することも可能。

```env
# --- Cognito 認証 ---
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_AWS_REGION=ap-northeast-1
# ⚠️ Cognito App Client には通常シークレット不要（パブリッククライアント）
# NEXT_PUBLIC_COGNITO_CLIENT_SECRET=  ← 基本的に設定しない

# --- S3 / アップロード ---
AWS_S3_BUCKET_NAME=your-bucket-name
AWS_REGION=ap-northeast-1
UPLOAD_API_KEY=your-api-key           # Lambda側のAPIキー

# ローカル開発時のアップロードAPIキー（本番では設定しない）
NEXT_PUBLIC_UPLOAD_API_KEY=your-dev-api-key

# --- CloudFront（任意）---
CLOUDFRONT_URL=https://xxxxxxxx.cloudfront.net

# --- API エンドポイント ---
# Lambda を使う場合は以下を設定（未設定の場合はローカル API Routes を使用）
NEXT_PUBLIC_API_BASE_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod

# ローカル API Routes を強制使用したい場合
NEXT_PUBLIC_USE_LOCAL_API=true

# --- AWS Secrets Manager（本番Lambda環境）---
AWS_SECRET_NAME=photo-gallery/prod
```

### 環境別の動作

| 環境 | API | 認証 |
|---|---|---|
| ローカル開発 | `app/api/` (Next.js API Routes) | Cognito（任意）|
| 本番 | AWS Lambda + API Gateway | Cognito (admin グループ) |

---

## テスト

### テストの実行

```bash
# 全テストをワンショット実行
npm test

# ウォッチモード（ファイル変更時に自動実行）
npm run test:watch

# カバレッジレポート付き
npm run test:coverage
```

### テストファイルの構成

```
app/
├── i18n/__tests__/
│   ├── labels.test.ts      # 日英ラベルの整合性テスト
│   └── context.test.tsx    # LocaleProvider / useLocale Hook のテスト
├── data/__tests__/
│   └── photos.test.ts      # getLocalized, generateMapLinksFromCoords 等のユーティリティテスト
└── hooks/__tests__/
    └── useGallery.test.ts  # カテゴリフィルタ・検索・ソート・モーダル操作のテスト
```

### 新しいテストの追加方針

- ユーティリティ関数・カスタムフック・Context が対象
- UI コンポーネントのテストは `__tests__/` サブディレクトリに `.test.tsx` で追加
- モックは最小限に（localStorage は `vitest.setup.ts` で提供）

---

## デプロイ

### フロントエンド（S3 + CloudFront）

```bash
# 1. 本番ビルド（静的HTML/JS/CSSを生成）
npm run build
# → out/ ディレクトリに静的ファイルが生成される

# 2. S3 へアップロード
npm run web:deploy:prod
# → scripts/deploy-static-site.js --bucket journey-photo.com が実行される
```

ビルド前に `scripts/prepare-static-build.js` が `app/api/` を一時退避し、
静的エクスポート後に元に戻す（ローカル開発用の API Routes を本番ビルドから除外するため）。

### バックエンド API（AWS Lambda）

```bash
# 開発環境へデプロイ
npm run api:deploy:dev

# 本番環境へデプロイ
npm run api:deploy:prod

# デプロイ済みの API エンドポイントを確認
npm run api:info:prod
```

Serverless Framework を使用。`api/` ディレクトリに Lambda 関数が定義されている。

### フルデプロイ（API + フロントエンド）

```bash
npm run deploy:prod
# api:deploy:prod → web:deploy:prod の順に実行される
```

### 写真データのアップロード

```bash
# ローカル画像を S3 へアップロード
npm run upload-local-images

# EXIF データを既存写真に追加
npm run add-exif
```

---

## アーキテクチャ

### データフロー

```
ブラウザ
  │
  ├─ 写真一覧取得
  │    └─ [本番] CloudFront → S3 (静的JSON or Lambda)
  │    └─ [開発] localhost:3000/api/photos
  │
  ├─ 写真アップロード（要admin）
  │    └─ Cognito でログイン → JWT トークン取得
  │    └─ Lambda に Presigned URL リクエスト
  │    └─ Presigned URL で S3 へ直接アップロード
  │    └─ Lambda にメタデータ保存リクエスト
  │
  └─ フロントエンド配信
       └─ CloudFront → S3 (out/ の静的ファイル)
```

### ローカライズ

- 日本語 (`ja`) / 英語 (`en`) をサポート
- ユーザーの選択は `localStorage` に保存
- `LocaleProvider` → `useLocale()` Hook でアプリ全体に配布
- ラベルは `app/i18n/labels.ts` で一元管理

### お気に入り・閲覧履歴

- `localStorage` に保存（サーバー不要）
- `lib/hooks/useFavorites.ts` / `lib/hooks/useViewHistory.ts` で管理

### ログ

`lib/utils/log` を使用。

| 環境 | info/debug | warn/error |
|---|---|---|
| 開発 | console に出力 | console に出力 |
| 本番 | 出力しない (silent) | console に出力 |
