# Photo Gallery

Next.js を使ったシンプルなギャラリーアプリです。  
TypeScript + Tailwind CSS + Heroicons を導入して開発しています。

---

## 📖 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [主な機能](#2-主な機能)
3. [技術スタック](#3-技術スタック)
4. [セットアップ手順](#4-セットアップ手順)
5. [開発環境の構築](#5-開発環境の構築)
6. [使い方](#6-使い方)
7. [ディレクトリ構成](#7-ディレクトリ構成)
8. [Git 操作](#8-git-操作)
9. [デプロイ](#9-デプロイ)
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

## 4. セットアップ手順

### 初回セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/rymaruta/photo-gallery.git
cd photo-gallery/

# 依存関係をインストール
npm install
```

### セットアップ資料（docs）

- `docs/LOCAL_SETUP.md`（ローカル開発）
- `docs/PRODUCTION_SETUP.md`（本番デプロイ）
- `docs/UPLOAD_SETUP.md`（アップロード/Secrets Manager）
- `docs/AUTH_SETUP.md`（Cognito認証）
- `docs/API_DOCUMENTATION.md`（API実装）
- `docs/LOCAL_PROD_PARITY.md`（ローカルと本番の構成を揃える方針・おすすめ）
- `docs/LOCAL_ENVIRONMENT_OPTIONS.md`（ローカルで本番に近い環境をつくる方法）

### 環境リセット（必要に応じて）

```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

---

## 5. 開発環境の構築

### TypeScript 導入（既に導入済み）

```bash
npm install --save-dev typescript @types/react @types/node
npm install --save-dev @types/react @types/react-dom
```

### Heroicons 導入（既に導入済み）

```bash
npm install @heroicons/react
```

### Tailwind CSS 導入（既に導入済み）

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

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

---

## 7. ディレクトリ構成

```
photo-gallery/
├── app/                      # アプリケーションコード
│   ├── about/               # About ページ
│   ├── components/          # React コンポーネント
│   │   ├── FilterBar.tsx    # フィルターバー
│   │   ├── GalleryGrid.tsx  # ギャラリーグリッド
│   │   ├── GalleryModal.tsx # モーダル表示
│   │   ├── HeaderNav.tsx    # ヘッダーナビゲーション
│   │   ├── LocaleToggle.tsx # 言語切り替え
│   │   └── ProtectedPortrait.tsx
│   ├── data/                # データファイル
│   │   └── photos.ts        # 写真データ
│   ├── gallery/             # ギャラリーページ
│   ├── hooks/               # カスタムフック
│   │   └── useGallery.tsx   # ギャラリー用フック
│   ├── i18n/                # 国際化
│   │   └── labels.ts        # ラベル定義
│   ├── layout.tsx           # ルートレイアウト
│   ├── page.tsx             # ホームページ
│   └── globals.css          # グローバルスタイル
├── public/                  # 静的ファイル (画像など)
├── .gitignore
├── eslint.config.mjs
├── next-env.d.ts
├── next.config.ts           # Next.js 設定
├── package.json
├── package-lock.json
├── postcss.config.js
├── tailwind.config.js       # Tailwind CSS 設定
├── tsconfig.json            # TypeScript 設定
└── README.md
```

---

## 8. Git 操作

### Git 初期化

```bash
git init
```

### ファイルをステージング

```bash
git add .
```

### コミット

```bash
git commit -m "初期版ギャラリーを保存"
```

### GitHubで新しいリポジトリを作成（例: photo-gallery）

```bash
git remote set-url origin https://github.com/rymaruta/photo-gallery.git
```

### ブランチ名を main に揃える

```bash
git branch -M main
```

### push

```bash
git push -u origin main
```

---

## 9. デプロイ

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

## 10. 今後の予定

- ▶ 画像アップロード機能の追加
- ▶ モーダル表示の実装（✅ 実装済み）
- ▶ Tailwind を活用したデザイン改善（✅ 実装済み）
- ▶ 検索機能の追加
- ▶ お気に入り機能の追加
- ▶ 画像の詳細情報（EXIFデータ）の表示
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
