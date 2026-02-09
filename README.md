# Photo Gallery

Next.js を使ったシンプルなギャラリーアプリです。  
TypeScript + Tailwind CSS + Heroicons を導入して開発しています。

---

## 📖 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [主な機能](#2-主な機能)
3. [技術スタック](#3-技術スタック)
4. [クイックスタート](#4-クイックスタート)
5. [セットアップ手順](#5-セットアップ手順)
6. [使い方](#6-使い方)
7. [ディレクトリ構成](#7-ディレクトリ構成)
8. [デプロイ](#8-デプロイ)
9. [ドキュメント](#9-ドキュメント)
10. [今後の予定](#10-今後の予定)

---

## 1. プロジェクト概要

このリポジトリは Next.js をベースにしたギャラリーアプリです。  
TypeScript と Tailwind CSS を導入し、Heroicons を利用して UI を強化しています。

写真を美しく表示し、カテゴリーやタグでフィルタリングできる機能を提供します。  
多言語対応（日本語/英語）にも対応しており、レスポンシブデザインで様々なデバイスで快適に閲覧できます。

---

## 2. 主な機能

- 📸 **写真ギャラリー表示**: グリッド形式で写真を一覧表示
- 🔍 **フィルタリング機能**: カテゴリーやタグで写真を絞り込み
- 🌐 **多言語対応**: 日本語と英語の切り替えが可能
- 🖼️ **モーダル表示**: 写真をクリックすると詳細をモーダルで表示
- 📱 **レスポンシブデザイン**: PC、タブレット、スマートフォンに対応
- ⚡ **静的エクスポート**: 静的サイトとしてエクスポート可能（AWS S3 + CloudFront などにデプロイ可能）
- 🎨 **モダンなUI**: Tailwind CSS による美しいデザイン

---

## 3. 技術スタック

### フレームワーク・ライブラリ
- **Next.js** `^16.1.1` - React フレームワーク
- **React** `19.2.0` - UI ライブラリ
- **TypeScript** `^5.9.3` - 型安全性

### スタイリング
- **Tailwind CSS** `^4.1.17` - ユーティリティファーストのCSSフレームワーク
- **PostCSS** `^8.5.6` - CSS処理
- **Autoprefixer** `^10.4.21` - ベンダープレフィックスの自動追加

### UIコンポーネント
- **Heroicons** `^2.2.0` - SVGアイコンライブラリ

### ユーティリティ
- **lodash.debounce** `^4.0.8` - デバウンス処理

### 開発ツール
- **ESLint** `^9` - コードリンティング
- **eslint-config-next** `^16.1.1` - Next.js用ESLint設定

---

## 4. クイックスタート

**5分で始める！**

```bash
# 1. プロジェクトをクローン
git clone https://github.com/rymaruta/photo-gallery.git
cd photo-gallery/

# 2. 依存関係をインストール
npm install

# 3. 開発サーバーを起動
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開くと、写真ギャラリーが表示されます！

**📚 詳細な手順は [クイックスタートガイド](./docs/QUICK_START.md) を参照してください。**

---

## 5. セットアップ手順

### 初回セットアップ

上記の「クイックスタート」で基本的な動作確認ができます。

### アップロード機能を使う場合

アップロード機能を使うには、AWSの設定が必要です。以下のドキュメントを参照してください：

- **[初めてのセットアップ](./docs/SETUP.md)** - AWS Cognito、S3、Secrets Managerの設定手順（初心者向け）

### 本番環境にデプロイする場合

- **[本番環境のセットアップ](./docs/PRODUCTION_SETUP.md)** - S3+CloudFront+Lambdaのデプロイ手順

---

## 6. 使い方

### 開発サーバー起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてアプリケーションを確認できます。

### ビルド

```bash
npm run build
```

### 本番環境での起動

```bash
npm run start
```

### リンティング

```bash
npm run lint
```

### 本番環境の動作確認

```bash
npm run diagnose:prod
```

API・静的アセット・画像の疎通を確認します。詳細は [docs/DEPLOY.md](./docs/DEPLOY.md) のトラブルシューティングを参照してください。

---

## 7. ディレクトリ構成

```
photo-gallery/
├── app/                      # Next.js App Router（ページ・API・レイアウト）
│   ├── about/               # About ページ
│   ├── admin/               # 管理（一覧・編集）
│   ├── api/                 # API Routes（開発時のみ。本番は Lambda）
│   │   ├── og/              # OGP 用（photo/[id]）
│   │   ├── photos/          # 写真一覧・単体取得
│   │   └── upload/          # アップロード（presigned-url, save）
│   ├── auth/                # Cognito 認証コンテキスト
│   ├── components/          # 共通 UI
│   │   ├── FilterBar, GalleryGrid, GalleryModal, HeaderNav
│   │   ├── LocaleToggle, Toast, ToastProvider, PwaRegister
│   │   └── ProtectedPortrait, DeleteConfirmModal
│   ├── data/                # 写真データ
│   │   ├── photos.ts        # 型・BASE_PHOTOS・ヘルパー
│   │   ├── dev-photos.json  # 開発用一覧
│   │   └── prod-photos.json # 本番用一覧（convert:photos:prod で生成）
│   ├── favorites/, gallery/, history/, news/
│   ├── i18n/                # 多言語（context, labels, about, news）
│   ├── layout.tsx, page.tsx, globals.css
│   ├── photo/[id]/          # 写真詳細（SSG + クライアントで id 解決）
│   ├── upload/, login/
│   └── error.tsx, not-found.tsx, loading.tsx, robots.ts, sitemap.ts
├── lib/                     # 共有ロジック（型・API・認証・ユーティリティ・フック）
│   ├── auth/                # Cognito, config
│   ├── aws/                 # Secrets 取得
│   ├── hooks/               # useGallery, useFavorites, useToast, useViewHistory, useSwipe, useImagePreloader
│   ├── types/               # ギャラリーフィルタ等の型
│   ├── utils/               # api, log, seo, string, share, exif（*.test.ts は単体テスト）
│   └── photos-initial.ts    # 一覧のキャッシュ・ビルド時データ
├── api/                     # 本番 API（Serverless / Lambda）
│   ├── handler.js
│   └── serverless.yml
├── scripts/                 # デプロイ・データ・診断用（一覧は scripts/README.md）
├── docs/                    # セットアップ・デプロイ・設計（docs/README.md 参照）
├── public/                  # 静的ファイル（画像, manifest, sw.js）
├── next.config.ts, tailwind.config.js, tsconfig.json, eslint.config.mjs
└── package.json, README.md
```

- スクリプトの役割一覧: [scripts/README.md](./scripts/README.md)
- フォルダ構成・設計の考え方: [docs/DESIGN.md](./docs/DESIGN.md)（「フォルダ構成」「構成の見直し案」）

---

## 8. デプロイ

このプロジェクトは静的エクスポート（`output: "export"`）に対応しています。  
AWS S3 + CloudFront などの静的ホスティングサービスにデプロイできます。

### ビルドとエクスポート

```bash
npm ci
npm run build
ls -la out
```

### AWS S3 + CloudFront へのデプロイ

```bash
# 静的ファイルをS3にアップロード
aws s3 sync ./out s3://bucket_name --delete

# CloudFront のキャッシュを無効化
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"

# 確認
curl -I https://your-domain.com

# キャッシュ設定を最適化してアップロード
aws s3 cp ./out/index.html s3://bucket-name/index.html --cache-control "max-age=60, must-revalidate"
aws s3 cp ./out/_next/static s3://bucket-name/_next/static --recursive --cache-control "max-age=31536000, immutable"
aws s3 cp ./out/images s3://bucket-name/images --recursive --cache-control "max-age=31536000, immutable"

# 再度キャッシュを無効化
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

### デプロイ用のインストール（参考）

```bash
npm install serverless
npm install @sls-next/serverless-component@latest
```

---

## 9. ドキュメント

詳細な手順・デプロイ・トラブルシューティングは **docs** フォルダを参照してください。

- **[docs/README.md](./docs/README.md)** — ドキュメント一覧・どこを読めばよいか
- **[クイックスタート](./docs/QUICK_START.md)** — 5分で始める
- **[本番デプロイ](./docs/DEPLOY.md)** — 開発/本番デプロイ・CloudFront・トラブル対処
- **[改善バックログ](./docs/IMPROVEMENTS.md)** — 技術的負債・今後の改善候補一覧

---

## 10. 今後の予定

- ✅ 画像アップロード機能（実装済み）
- ✅ モーダル表示（実装済み）
- ✅ Tailwind CSSによるデザイン（実装済み）
- ✅ お気に入り機能（実装済み）
- ✅ 画像の詳細情報（EXIFデータ）の表示（実装済み）
- ▶ 検索機能の追加
- ▶ ソーシャルシェア機能

---

## 📝 ライセンス

このプロジェクトはプライベートプロジェクトです。

---

## 🤝 コントリビューション

バグ報告や機能要望は、GitHub の Issues でお知らせください。  
プルリクエストも歓迎します。

---

## 📧 連絡先

質問やお問い合わせがある場合は、GitHub の Issues をご利用ください。

---

**Happy Coding! 🎉**
