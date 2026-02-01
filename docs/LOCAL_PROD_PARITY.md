# ローカルと本番で同じような構成にする — 方針とおすすめ

ローカルと本番の API まわりを「できるだけ同じような構成」にしたいときの選択肢と、おすすめの進め方をまとめます。

---

## 1. 現状の整理

| 項目 | ローカル | 本番 |
|------|----------|------|
| **フロント** | `next dev`（Node） | S3 + CloudFront（静的のみ） |
| **API** | Next.js Route Handlers（`app/api/*`） | API Gateway + Lambda |
| **API の実装** | `app/api` の `route.ts` | PRODUCTION_SETUP 内の Lambda 用コード（手動で AWS にコピペ） |
| **`getApiBaseUrl()`** | 未設定時は `/api`（同一オリジン） | `NEXT_PUBLIC_API_BASE_URL` で API Gateway / CloudFront の `/api` を指定 |
| **ビルド** | 不要（`next dev` で `app/api` がそのまま使える） | `output: "export"` のため、ビルド時に `app/api` を退避（`prepare-static-build.js`） |

**主な違い**

- ローカル: API が **Next.js の Route Handler（Node）**
- 本番: API が **Lambda（別ランタイム）** で、`app/api` のロジックを Lambda 用に**別実装・コピペ**している。

---

## 1.5 よくある質問: ローカルも本番の API を使う？ 環境の統一性は？

### 「本番の API をそのまま」使う（本番の URL を向ける）

**→ 原則おすすめしません。**

- 本番データを触る・壊すリスクがある
- 本番のコスト・スロットリングの影響を受ける
- デバッグや試行錯誤には向かない

### 「本番と**同じ種類**の API（API Gateway + Lambda）」を開発でも使う

**→ 環境の統一性を「ランタイム・インフラ」まで取りたいなら、ありです。**

その場合、**本番の API ではなく、開発用の API Gateway + Lambda を用意**して、ローカルからそこを向ける形にします。

| やり方 | 概要 | 統一性 | 手間・コスト |
|--------|------|--------|--------------|
| **開発用 API Gateway+Lambda を AWS にデプロイ** | 本番と別の「dev」用 API + Lambda。dev 用 S3・Cognito 等を参照。ローカルは `NEXT_PUBLIC_API_BASE_URL=https://dev-xxx.execute-api...` | ◎ ランタイム・インフラほぼ同一 | デプロイの整備、わずかな AWS 料金 |
| **Serverless Offline でローカルに API Gateway+Lambda を再現** | `lambda/` を serverless-offline で起動。ローカルは `NEXT_PUBLIC_API_BASE_URL=http://localhost:3002` など | ◎ ランタイムに近い | ツール導入、`lambda/` の整備 |

いずれも **`app/api` は使わず、常に `NEXT_PUBLIC_API_BASE_URL` で「開発用 API」を向ける**形にすると、「フロントはどこかしらの API を呼ぶ」でローカルも本番も揃います。

### 「環境の統一性」をどこで取るか

統一の「強さ」で整理すると、次の 3 段階になります。

| レベル | 内容 | 実現のしやすさ | 効果 |
|--------|------|----------------|------|
| **① コード** | 同じハンドラロジックを `app/api` と Lambda の両方から使う（`lib/api-handlers`） | 中（リファクタあり） | 仕様の食い違いや実装バグを減らせる |
| **② リクエストの向け先** | ローカルも「API の URL」を `NEXT_PUBLIC_API_BASE_URL` で指定。`app/api` は使わない | 低（設定のみ） | 本番に近い CORS・認証・ネットワークを体験できる |
| **③ ランタイム** | ローカルでも API Gateway+Lambda 相当（開発用 or Serverless Offline）を動かす | 中〜高 | コールドスタートや Lambda 特有の挙動をローカルで確認できる |

**おすすめの進め方**

1. **まず ① コードの統一（方針 B）**
   - `lib/api-handlers` にロジックを寄せ、`app/api` と Lambda の両方から呼ぶ。
   - これだけでも「何をする API か」がローカル・本番で一致し、環境の統一性は大きく上がります。
   - いまの `app/api` を残すので、**保存すればすぐ反映される**開発体験は維持できます。

2. **② まで取りたい場合**
   - 開発用の API Gateway+Lambda を AWS に 1 本デプロイする。**本番と同じ `api/serverless.yml` と `api/handler.js` を `--stage dev` でデプロイする**手順は [API ドキュメント](API.md)（開発デプロイの節）を参照。
   - ローカル用 `.env.local` に  
     `NEXT_PUBLIC_API_BASE_URL=https://dev-xxx.execute-api.ap-northeast-1.amazonaws.com`  
     を設定し、`app/api` は使わない（或者：`getApiBaseUrl` で、`NEXT_PUBLIC_API_BASE_URL` が常に優先されるようにしておく）。
   - 日常の UI 開発は `app/api` のままにして、**「本番デプロイ前の確認」「結合テスト」のときだけ** 開発用 API を向ける、という使い分けもできます。

3. **③ ランタイムまで揃えたい場合**
   - 開発用 API Gateway+Lambda、または Serverless Offline を用意。
   - ローカルは常にその URL を `NEXT_PUBLIC_API_BASE_URL` で向ける。
   - トレードオフ: Lambda の修正のたびにデプロイ or serverless offline の再起動が必要になり、**イテレーションは `app/api` より遅く**なります。Lambda 特有の検証がしたいとき向きです。

**まとめ（環境の統一性が欲しいとき）**

- **「本番の API をそのまま」** は使わない。
- **「本番と同じ種類の API」** を開発用に用意し、ローカルからそれを向けるのは、統一性を高めるうえで有効。
- 現実的には、**① コードの統一（方針 B）をまず行い**、必要に応じて ② → ③ と広げていく形がおすすめです。

---

## 2. とりの選択肢

### 方針 A: 本番も Next.js (Node) で動かす — 静的エクスポートをやめる

**概要**

- `next.config.ts` の `output: "export"` をやめる。
- 本番も `next build` + `next start`（または同等）を動かすプラットフォームに載せる。

**例**

- **Vercel**（推奨）: そのままデプロイ。`app/api` が Vercel のサーバーレス関数として動く。
- **AWS Amplify**（SSR 対応）: Next.js を Node でホスト。
- **ECS / EC2 / Fargate**: `next start` をコンテナで常時起動。
- **Lambda + OpenNext / Serverless Next.js 系**: `next start` 相当を Lambda で動かし、`app/api` も Lambda 上で実行。

**メリット**

- ローカルも本番も **同じ `app/api`** がそのまま使える。
- `prepare-static-build.js` が不要になる。
- デプロイ・運用の考え方が「1 本の Next.js アプリ」で揃う。

**デメリット**

- いまの **S3+CloudFront の「静的だけ」の構成** から変える必要がある。
- ホスティングが「静的ファイル配信」から「Node プロセス / サーバーレス関数」に変わり、コスト・運用が変わる。

**向いている人**

- S3+CloudFront にこだわらず、**とにかくローカルと本番の構成を揃えたい**場合。
- Vercel など、Next 向けホスティングを使える場合。

---

### 方針 B: 共有ハンドラ + 2 種類の「入口」— S3+CloudFront+API Gateway+Lambda は維持

**概要**

- **ビジネスロジック** を `lib/api-handlers/` などに抽出する。
- **ローカル**: `app/api` の `route.ts` は「リクエストの解釈」「ハンドラ呼び出し」「レスポンスの組み立て」だけの薄いアダプタ。
- **本番**: Lambda ハンドラも、**同じ `lib/api-handlers` を import して呼び出す**。API Gateway のイベントを解釈し、ハンドラの戻り値を API Gateway 形式に変換するだけの薄いアダプタ。

**想定ディレクトリ例**

```
lib/
  api-handlers/
    photos.ts      # getPhotos, getPhotoById, updatePhoto, deletePhoto の中身
    upload.ts      # createPresignedUrl, savePhoto の中身
    types.ts       # 入出力の型
  aws/
    secrets.ts     # 既存の getConfig（ローカル・Lambda どちらからも利用）
app/
  api/             # ローカル用の薄いアダプタ（NextRequest → ハンドラ → NextResponse）
    photos/
    photos/[id]/
    upload/presigned-url/
    upload/save/
lambda/            # 本番用の薄いアダプタ（API Gateway イベント → ハンドラ → レスポンス）
  handler.ts       # または /photos, /photos/:id, /upload/presigned-url, /upload/save ごと
```

**共有の考え方**

- `getConfig()` はそのまま `lib/aws/secrets` を**両方から**使う。
- `photos.json` の読書き:
  - ローカル: 従来どおり `fs` + `app/data/photos.json`（`lib/api-handlers` に「データ取得関数」を渡す or 環境で分岐）。
  - Lambda: S3 の `app/data/photos.json` を get/put。  
  → 中身の「写真リストの操作ロジック」は共通にし、**データ取得・保存のインターフェース**だけを差し替える形にすると、ローカル・本番で揃えやすい。

**メリット**

- **S3+CloudFront と API Gateway+Lambda の構成をそのまま維持**できる。
- API の「何をするか」は 1 か所（`lib/api-handlers`）にまとまり、**ローカルと本番で同じロジック**を実行できる。
- `app/api` は引き続きローカル開発専用。本番ビルドでは `prepare-static-build.js` で退避する現状の仕組みで問題ない。

**デメリット**

- 最初に `app/api` から `lib/api-handlers` への**リファクタ**が必要。
- Lambda 用の**エントリ（`lambda/`）とデプロイ（zip / CDK / Serverless 等）**を整える必要がある（PRODUCTION_SETUP の Lambda コードを、`lib` を import する形に置き換えるイメージ）。

**向いている人**

- **S3+CloudFront は維持したい**が、API の「実装」はローカルと本番で揃えたい場合。
- 既存の PRODUCTION_SETUP（Lambda をコンソールにコピペ）から、**リポジトリ主導の Lambda デプロイ**に移行したい場合。

---

### 方針 C: ローカルでも API Gateway + Lambda をエミュレートする

**概要**

- ローカル: **Serverless Offline** や **LocalStack** で、API Gateway + Lambda を動かす。
- 本番: そのまま API Gateway + Lambda。
- フロントは `NEXT_PUBLIC_API_BASE_URL` で、ローカルでは `http://localhost:3xxx` などエミュレータの URL を向ける。

**メリット**

- 本番に**かなり近い**形で Lambda の挙動を試せる。
- 認証・ルーティングの違いによるバグを、ローカルで見つけやすい。

**デメリット**

- セットアップが重い（Serverless Framework / LocalStack、Docker 等）。
- Lambda の実装を「`lambda/` にまとめて Serverless で配る」など、**本番と同じコードパス**にしないと、ローカルと本番の二重管理になりがち。  
  → やるなら、**方針 B の `lib/api-handlers` を Lambda から使う形**と組み合わせるのがおすすめ。

**向いている人**

- Lambda の挙動を**ローカルでしっかり再現したい**場合。
- すでに `docs/LOCAL_ENVIRONMENT_OPTIONS.md` の「案4: Serverless Offline」などを検討している場合。

---

### 方針 D: 単一の Node API サーバーを、ローカルと Lambda の両方で動かす

**概要**

- Express / Hono などで `/api/photos`, `/api/photos/:id`, `/api/upload/presigned-url`, `/api/upload/save` を **1 本の Node アプリ**として実装。
- **ローカル**: そのサーバーを `localhost:3001` などで起動。Next.js は `next dev` で 3000。`NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` か、`next.config` の `rewrites` で `/api` を 3001 にプロキシ。
- **本番**: 同じ Node アプリを **Lambda + @vendia/serverless-express 等** で包み、API Gateway から呼ぶ。

**メリット**

- API の実装が **1 コードベース**。ルーティングやリクエスト解析の形がローカルと本番で同じ。

**デメリット**

- いまの **Next.js の `app/api` をやめて**、別の Node サーバーに寄せる必要がある。
- Lambda では Node を 1 プロセス起動する形になるため、コールドスタートやパッケージサイズの影響はある。

**向いている人**

- すでに Express 等で API を書いている、または Next の Route Handler への愛着が薄く、**API を 1 本のサーバーにまとめたい**場合。

---

## 3. 比較とおすすめの選び方

| 観点 | A: 本番も Next.js | B: 共有ハンドラ | C: Serverless Offline 等 | D: 単一 Node API |
|------|--------------------|------------------|---------------------------|-------------------|
| **S3+CloudFront を維持** | ❌ やめる | ✅ 維持 | ✅ 維持 | ✅ 維持（API は別） |
| **構成の似せ方** | ほぼ同一 | ロジック同一、入口が 2 種類 | ランタイムを近づける | 入口 1 本 |
| **初期コスト** | 低（`output` 削除など） | 中（リファクタ + Lambda 整備） | 中〜高（ツール導入） | 中（API の分離） |
| **運用・理解のしやすさ** | とても良い | 良い | やや重い | 良い |

**おすすめの選び方（短く）**

1. **S3+CloudFront を変えたくない**  
   → **方針 B（共有ハンドラ）** を第一候補。  
   あわせて、Lambda をローカルで試したいなら **方針 C** を B の上に載せる。

2. **S3+CloudFront はやめて、構成をとにかく揃えたい**  
   → **方針 A（本番も Next.js）**。Vercel 等に載せれば、`app/api` がそのまま本番になる。

3. **既存の `app/api` を薄く残しつつ、Lambda の実装を 1 本にまとめたい**  
   → **方針 B**。  
   `app/api` は「`lib` の薄いラッパー」にして、Lambda は `lib` を直接使う形にする。

---

## 4. 方針 B を選んだときの進め方（概要）

1. **`lib/api-handlers/` をつくる**
   - `app/api` の各 `route.ts` から、「リクエストの解釈」と「レスポンスの組み立て」を除いた**中核ロジック**を関数として切り出す。
   - 入出力は「プレーンなオブジェクト」にし、`NextRequest` / `NextResponse` や API Gateway の型に依存しないようにする。

2. **`app/api` を薄いアダプタにする**
   - `route.ts` の役割:
     - `NextRequest` から body / headers / params を取り出す
     - `getConfig()` やデータ取得の**実装**（例: `readPhotosFromFs`）を渡して `lib/api-handlers` を呼ぶ
     - 戻り値を `NextResponse.json(...)` に乗せる  
   - 既存の `getConfig` や `lib/aws/secrets` はそのまま利用。

3. **Lambda 用の `lambda/` をつくる**
   - API Gateway のイベントを「`lib/api-handlers` が受け取れる形」に変換。
   - `lib/api-handlers` を import して呼び出し、戻り値を API Gateway のレスポンス形式に変換。
   - `getConfig` は Lambda の環境変数や Secrets Manager を読むので、`lib/aws/secrets` をそのまま使える。
   - データ取得: `photos.json` は S3 の get/put にする。`lib/api-handlers` に「`fetchPhotos` / `writePhotos` のような関数」を渡す形にすると、`app/api` は fs、Lambda は S3 と差し替え可能。

4. **PRODUCTION_SETUP の Lambda を「`lambda/` からビルドした zip をデプロイする」流れに変える**
   - コンソールへのコピペではなく、`lambda/` と `lib` をバンドルして zip をつくり、Lambda にアップロード（または CDK / Serverless / SAM でデプロイ）。

5. **`prepare-static-build.js` はそのまま**
   - `output: "export"` を続ける限り、ビルド時に `app/api` を退避する現状の仕組みでよい。

---

## 5. 方針 A を選んだときの進め方（概要）

1. **`next.config.ts`**
   - `output: "export"` を削除（またはコメントアウト）。

2. **`package.json` の `build`**
   - `node scripts/prepare-static-build.js` をやめ、`next build` または `next build --webpack` に戻す。

3. **`app/api`**
   - 退避は不要。`app/api` をそのまま残す。

4. **本番ホスティング**
   - **Vercel**: リポジトリを連携してデプロイ。`app/api` は自動でサーバーレス関数になる。
   - **Amplify / ECS / Fargate 等**: `next build` のあと `next start` を実行するように設定。  
   - いずれも、`NEXT_PUBLIC_API_BASE_URL` は不要（同一オリジンの `/api` を使う）か、Vercel のサーバーless URL などに合わせて設定。

5. **S3+CloudFront**
   - 静的だけの配信はやめ、上記の「Node で動かす Next.js」をオリジンにする、またはフロントだけ Vercel に移行する、などの構成に変える。

---

## 6. ほかのドキュメントへの参照

- **本番デプロイの全体像**: `docs/PRODUCTION_SETUP.md`
- **ローカルで本番に近い環境をつくる方法**（LocalStack、Serverless Offline 等）: `docs/LOCAL_ENVIRONMENT_OPTIONS.md`
- **静的エクスポートと `app/api` の扱い**（`prepare-static-build.js` の理由）: `docs/PRODUCTION_SETUP.md` の「参考: 静的エクスポート（output: "export"）と app/api のエラーについて」

---

## 7. まとめ

- **「ローカルも本番の API を使う？」「環境の統一性が欲しい」** → 本番の URL をそのまま向けるのは避け、**開発用の API Gateway+Lambda** か **Serverless Offline** を用意して「本番と同じ種類の API」を向けるのがよい。まずは **① コードの統一（方針 B）** から始めるのが現実的。詳しくは [1.5 節](#15-よくある質問-ローカルも本番の-api-を使う-環境の統一性は) を参照。
- **ローカルと本番を「同じような構成」にしたい**だけなら、**方針 A（本番も Next.js）** が一番簡単で、`app/api` をそのまま本番でも使える。
- **S3+CloudFront と API Gateway+Lambda は維持したい**なら、**方針 B（共有ハンドラ + 薄いアダプタ）** で、実装を `lib/api-handlers` に寄せ、`app/api` と Lambda の両方から使う形にするのがおすすめ。
- Lambda の挙動をローカルでも確かめたい場合は、方針 B のうえに **方針 C（Serverless Offline 等）** をのせる、という二段構えにすると、揃え方として無理が少ない。
