# Photo Gallery — journey-photo.com

旅の写真を置く個人ギャラリー。**写真が主役**で、優先度は
**SEO・表示速度・安定性**（`CLAUDE.md` に方針）。

- 本番: <https://journey-photo.com>
- Next.js 16 の**静的書き出し**（`output: export`）を S3 + CloudFront で配信
- 会員機能（登録・投稿・フォロー・コメント）は **Lambda + DynamoDB + Cognito**

---

## 目次

1. [できること](#1-できること)
2. [作りの概要](#2-作りの概要)
3. [技術スタック](#3-技術スタック)
4. [動かす](#4-動かす)
5. [**反映の前に必ず通す関門**](#5-反映の前に必ず通す関門)
6. [ディレクトリ構成](#6-ディレクトリ構成)
7. [環境とブランチ](#7-環境とブランチ)
8. [デプロイ](#8-デプロイ)
9. [ドキュメント](#9-ドキュメント)

---

## 1. できること

**見る人**

- 写真の一覧・拡大表示・個別ページ（`/photo/<id>`）
- **集約ページ** — タグ `/tag/*`・撮影地 `/location/*`・カテゴリ `/category/*`・
  機材 `/camera/*`。サイトマップに載るのは**薄くないページだけ**
  （タグ・カテゴリ・機材は3枚以上、**撮影地は2枚以上**）
- **撮影地マップ** `/map` — 座標を持つ写真を地図に出す（Leaflet）
- 絞り込み・サイト内検索（題・説明・撮影地・機材・**タグ・カテゴリ**）
- お気に入り（この端末に保存）／RSS `/feed.xml`
- **PWA** — ホーム画面に追加でき、**一度見たページと一度見た写真はオフラインでも出る**

**投稿する人**（ログインが要る）

- 写真の投稿・編集・下書き・公開/非公開・削除
- **位置情報は上げる前に端末で消す**（写真の APP1／動画の GPS 箱）。
  向きの情報だけは残して縦横が倒れないようにする
- カテゴリ・タグは**決まった選択肢から選ぶ**（打つこともできる）
- 24時間で消える**ストーリー**／**共同アルバム**（招待リンク）
- プロフィール（表示名・@ユーザー名・自己紹介・BGM・ピン留め）
- フォロー・コメント・いいね・通知・ブロック・退会
- **タイムライン** `/timeline` — フォローしている人の写真が投稿順に流れる
  （トップの「フォロー中」から）

**言語**: 日本語のみ。**切り替えは存在しない**
（`app/i18n/context.tsx` は `ja` 固定。英語のラベルはコードに残っているが、
画面から選ぶ道は無い）。

---

## 2. 作りの概要

```
        ┌─ 静的サイト（S3 + CloudFront / OAC）
利用者 ─┤    Next.js の静的書き出し。写真ページ・集約ページ・サイトマップは
        │    ビルド時に作る（DynamoDB から写真データを同期してから建てる）
        │
        └─ API（API Gateway + Lambda）
             api-user/  … 利用者向け 50口（投稿・フォロー・コメント・
                           ストーリー・アルバム・プロフィール）
             api/       … 管理向け 8口
                           ↓
                        DynamoDB（写真・利用者）／ S3（画像の実体）
                        Cognito（ログイン）
```

- **写真を公開・削除すると、API が GitHub Actions に再ビルドを頼む**
  （`repository_dispatch: site-rebuild`）。静的サイトなので、これが無いと
  新しい写真のページもサイトマップも出ない
- `app/data/photos.json` は**ビルド時に DynamoDB から生成される**（コミット不要）
- `app/api/` は開発専用。ビルド時に自動退避される

---

## 3. 技術スタック

| | |
|---|---|
| フレームワーク | Next.js `^16.1.1`（`output: export`）／ React `19.2.0` ／ TypeScript `5.9.3` |
| スタイル | Tailwind CSS `^4.1.17`（`@tailwindcss/postcss`。**設定ファイルは持たない**） |
| UI | Heroicons ／ Leaflet（地図）／ lodash.debounce |
| 画像 | exifr（EXIF の読み取り）／ sharp（ビルド時のサムネ・AVIF 生成） |
| 認証 | amazon-cognito-identity-js |
| AWS | S3 / CloudFront / DynamoDB / Lambda / Cognito / Secrets Manager |
| テスト | vitest ＋ jsdom ＋ Testing Library ／ playwright（実ブラウザのスモーク） |

---

## 4. 動かす

```bash
npm ci
npm run dev        # http://localhost:3000
```

写真データは `app/data/photos.json` を読みます。手元では
**リポジトリに入っている断面**（古い）を使うので、本番と同じ形で建てるには
DynamoDB への接続が要ります。

```bash
npm run build      # DynamoDB から写真を同期してから静的書き出し
npm test           # 単体テスト（vitest）
npm run lint
npm run type-check
```

> ⚠️ 手元で `next build` を直に叩くときは、**本番と同じ環境変数**を渡すこと。
> 渡さないと画像URLを揃える処理が丸ごと効かないビルドができます。
>
> ```bash
> NEXT_PUBLIC_CLOUDFRONT_URL=https://d1s3dwwzgxf5ni.cloudfront.net \
> NEXT_PUBLIC_SITE_URL=https://journey-photo.com npx next build
> ```

---

## 5. 反映の前に必ず通す関門

```bash
npm run verify
```

`deploy.yml` が通すものを**手元で全部**回します（GitHub Actions の枠を1分も使わない）。

| 関門 | 見るもの |
|---|---|
| 型検査（ルート） | `npx tsc --noEmit` |
| 型検査（api / api-user） | ルートの tsconfig は両方を見ていない。**0件ではなく「基準より増えていないこと」** |
| lint | `npx eslint .` |
| 単体テスト | `npx vitest run` |
| ビルド | 本番と同じ環境変数で `next build` |
| 実ブラウザのスモーク | Chromium |
| 派生ありのビルド＋スモーク | **本番のデータの形**（AVIF/WebP の派生つき）を再現する |

**なぜ要るか**: `vitest` は型を見ないので、全部緑でも `next build` が落ちる
（`7276c2b8` — 本番リリースがそこで止まった）。逆にビルドが通っても
**実ブラウザでだけ落ちる**（`24f9df2c` — サムネが水和後に消えた）。
**片方だけでは「落ちない」と言えません。**

---

## 6. ディレクトリ構成

```
photo-gallery/
├── app/                  Next.js の App Router（22ページ）
│   ├── components/       画面部品（GalleryGrid・GalleryModal/・PhotoMap …）
│   ├── photo/[id]/       写真ページ（検索の着地点）
│   ├── tag|location|category|camera/   集約ページ
│   ├── user/             投稿・編集・下書き・プロフィール・アルバム
│   ├── users/            公開プロフィール・利用者検索
│   ├── admin/            管理画面
│   ├── i18n/             ラベル（locale は ja 固定）
│   ├── data/             photos.json（ビルド時に生成）
│   └── api/              開発専用。ビルド時に退避される
├── lib/                  画面から独立した純関数・フック
│   ├── utils/            collections（集約）・seo・photoOrder・image …
│   ├── hooks/            useGallery・useFollow・useComments …
│   └── auth/             Cognito のラッパー
├── api-user/             利用者向け Lambda（serverless v3）
├── api/                  管理向け Lambda
├── scripts/              ビルド・デプロイ・保守・診断の道具
├── public/               sw.js・manifest・offline.html など
├── docs/                 設計と運用のドキュメント
└── .github/workflows/    デプロイ・保守・見張り
```

---

## 7. 環境とブランチ

| 環境 | ブランチ | 反映先 |
|---|---|---|
| 本番 | `main` | journey-photo.com |
| ステージング | `develop` | CloudFront の既定ドメイン（検索避けあり・**写真は空**） |

```
feature/xxx  →(PR)→  develop  →(手動)→ staging で確認
                        ↓ (PR)
                       main    →(自動)→ 本番
```

- **本番へ直接 push しない。**
- AWS のリソースは全て環境名が接頭辞（`prod-*` / `staging-*`）。
- **API は push で自動デプロイ**（`api/**` `api-user/**` を触った push）。
  **staging のフロント反映は手動実行**（1回が重いため）。
- ワークフローはブランチから環境を決める。値が1つでも欠けたら**失敗させる**
  （以前は本番値にフォールバックしていて、緑のまま本番を向いていた）。

> ⚠️ **GitHub Actions の枠は有限で、切れると「遅くなる」ではなく
> 「何も出せなくなる」**（2026-08 にデプロイが20日間止まった）。
> 流す前に残りを引き算すること。詳細は `CLAUDE.md`。

---

## 8. デプロイ

**基本は GitHub Actions に任せる。** 手で叩くとパラメータの渡し忘れが起きます。

```bash
# 静的サイト（フロント）
npm run build
CLOUDFRONT_DISTRIBUTION_ID=EYRLTGCPOS9E4 SITE_URL=https://journey-photo.com \
  npm run web:deploy:prod
```

> ⚠️ `journey-photo.com` はドメイン名。**S3 バケット名は `prod-journey-photo.com`**（別物）。

API（Lambda）は `deploy-api.yml` に任せます。手元から流す場合は
**全パラメータが必須**で、渡し忘れると別環境を向きます（`CLAUDE.md` に一覧）。

---

## 9. ドキュメント

| | |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | **運用の決まりごと**（作業の進め方・本番リソース一覧・Actions の枠・注意事項） |
| [`DOCS.md`](./DOCS.md) | ドキュメントの索引 |
| [`docs/architecture.md`](./docs/architecture.md) | 全体の作り |
| [`docs/PRODUCTION_SETUP.md`](./docs/PRODUCTION_SETUP.md) | 本番環境の構築手順 |
| [`docs/api-user.md`](./docs/api-user.md) / [`docs/api-admin.md`](./docs/api-admin.md) | API の口の一覧 |
| [`docs/strategy-2026-09.md`](./docs/strategy-2026-09.md) | 方向性の検討 |
| [`docs/dynamic-photo-page-2026-09.md`](./docs/dynamic-photo-page-2026-09.md) | 写真ページを動的にする案と、実機で測った結果 |

---

## ライセンス

プライベートプロジェクトです。
