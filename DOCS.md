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

> **実在するパスだけを書く。** 以前ここには `app/gallery/`・`app/history/`・
> `app/upload/`・`app/data/photos.ts`・`app/hooks/useGallery.tsx`・
> `app/i18n/about.ts`・`GalleryModal.tsx` が並んでいたが、**どれも無かった**。
> 触ったときは実物と突き合わせること。

```
photo-gallery/
├── app/                        Next.js App Router（22ページ）
│   ├── components/             画面部品
│   │   ├── GalleryGrid.tsx     写真グリッド
│   │   ├── GalleryModal/       写真の拡大（ディレクトリ。index・ModalImage・ModalCaption …）
│   │   ├── FilterBar.tsx       絞り込み（検索・タグ・カテゴリ・並び）
│   │   ├── HeaderNav.tsx       ヘッダー ／ Footer.tsx ／ Toast.tsx
│   │   ├── PhotoMap.tsx        撮影地マップ（Leaflet）
│   │   └── stories/            ストーリー（StoriesBar・StoryViewer）
│   ├── data/photos.json        写真データ（**ビルド時に DynamoDB から生成**）
│   ├── i18n/                   labels.ts ／ context.tsx（locale は ja 固定）
│   ├── auth/context.tsx        AuthProvider・useAuth
│   ├── api/                    ローカル開発用。**ビルド時に退避される**
│   ├── photo/[id]/             写真ページ（検索の着地点）
│   ├── tag|location|category|camera/[..]/   集約ページ
│   ├── map/ favorites/ privacy/ j/          地図・お気に入り・規約・招待
│   ├── user/                   upload・edit・drafts・profile・albums（要ログイン）
│   ├── users/                  [id]（公開プロフィール）・search
│   └── admin/                  管理（要 admin 権限）
├── lib/                        画面から独立した部分
│   ├── utils/                  collections（集約）・seo・photoOrder・image・
│   │                           ownValues / tagChoices / categoryChoices（入力候補）
│   ├── hooks/                  useGallery・useFollow・useComments・usePhotos …
│   ├── auth/                   Cognito のラッパー
│   └── data/photos.ts          Photo 型とローカライズのユーティリティ
├── api-user/                   利用者向け Lambda（50口・serverless v3）
├── api/                        管理向け Lambda（8口）
├── scripts/                    ビルド・デプロイ・保守・診断
├── public/                     sw.js・manifest.webmanifest・offline.html
├── docs/                       設計と運用
└── .github/workflows/          deploy・deploy-api・maintenance・token-health …
```

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

🔴 **画面から言語を切り替える道は無い。** `locale` は **`ja` 固定**で、
`localStorage` に `ja` 以外が残っていれば**消す**（`app/i18n/context.tsx:26-28`）。
`setLocale` は残っているが、本体コードから呼ぶ側が1つも無い。

- ラベルは `app/i18n/labels.ts` に日英とも在る（英語側は画面に出ない）
- `LocaleProvider` → `useLocale()` Hook でアプリ全体に配布
- `locale === "en"` の分岐がコード中に約400か所あるが、**どれも到達しない**
- 同じ理由で `og:locale:alternate`・hreflang・写真ページの隠し英語文は
  **撤去済み**（英語版が在ると名乗らないため）

### お気に入り

- `localStorage` に保存（サーバー不要）。`lib/hooks/useFavorites.ts`
- **閲覧履歴の仕組みは無い**（`useViewHistory` も `/history` も実在しない。
  以前ここに書いてあったが、コードを grep して0件だった）
- ⚠️ 一覧のハートは**この端末の `localStorage`**、写真ページのハートは
  **サーバー優先**（`usePhotoLikes`）。未ログインで押してからログインすると
  一覧は赤・開くと空、という食い違いが出る（承知のうえで残している）

### ログ

`lib/utils/log` を使用。

| 環境 | info/debug | warn/error |
|---|---|---|
| 開発 | console に出力 | console に出力 |
| 本番 | 出力しない (silent) | console に出力 |
