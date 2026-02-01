# 本番デプロイ（DEPLOY）

本番URL、CloudFront・Route 53 の設定、よくあるエラーの対処をまとめています。

---

## 📋 目次

1. [デプロイ手順（開発・本番）](#デプロイ手順開発本番)
2. [本番URL一覧](#本番url一覧)
3. [本番の正しい構成（何がどこにあるか）](#本番の正しい構成何がどこにあるか)
4. [AレコードとAAAAレコードの違い](#aレコードとaaaaレコードの違い)
5. [CloudFront（API用）の設定](#cloudfrontapi用の設定)
6. [CloudFront（画像用 /uploads/*）の設定](#cloudfront画像用-uploadsの設定)
7. [Route 53（journey-photo.com）の設定](#route-53journey-photocomの設定)
8. [トラブルシューティング](#トラブルシューティング)
9. [クイックチェックリスト](#クイックチェックリスト)
10. [本番の Secrets Manager（想定値）](#本番の-secrets-manager想定値)
11. [OAC とは／サイト用 OAC の説明](#oacorigin-access-controlとはサイト用-oac-の説明)
12. [CloudFront 画面ごとの設定値（参考）](#cloudfront-画面ごとの設定値参考)
13. [CloudFront 設定ガイド（画面ごとの操作）](#cloudfront-設定ガイド画面ごとの操作)
14. [参照](#参照)

---

## デプロイ手順（開発・本番）

開発と本番で **API のルート構成は同じ**（`/api/photos` など）です。参照するバケット・シークレットが `--stage dev` / `--stage prod` で切り替わります。

### 開発環境（dev）

| やりたいこと | コマンド | 説明 |
|--------------|----------|------|
| **API だけデプロイ** | `npm run api:deploy:dev` | Lambda + API Gateway を dev 用にデプロイ。Secrets Manager の `dev-journey-photo-upload` を参照。 |
| **開発用 S3 に写真データを上げる** | `npm run dev:upload` | `app/data/dev-photos.json` と対応画像を `dev-journey-photo.com` / `dev-journey-photo-upload` にアップロード。dev の API で一覧を確認したいときに使う。 |
| **ローカルで動かす** | `npm run dev` | デプロイはしない。Next.js 開発サーバー + ローカル API（`app/api`）または `NEXT_PUBLIC_API_BASE_URL` で dev Lambda を向ける。 |

**開発の流れの例**

1. 初回: Secrets Manager に `dev-journey-photo-upload` を作成し、`COGNITO_USER_POOL_ID`・`AWS_S3_BUCKET_NAME`・`AWS_S3_SITE_BUCKET_NAME` などを設定。
2. `npm run api:deploy:dev` で API をデプロイ。
3. （任意）`npm run dev:upload` で dev S3 に写真一覧を上げ、dev の API で表示確認。
4. 普段は `npm run dev` でローカル開発。写真データは `app/data/dev-photos.json` を編集。

---

### 本番環境（prod）

| やりたいこと | コマンド | 説明 |
|--------------|----------|------|
| **写真一覧を本番用に変換** | `npm run convert:photos:prod` | `dev-photos.json` から `prod-photos.json` を生成（画像 URL を本番用に変換）。 |
| **写真一覧を本番 S3 にアップロード** | `npm run upload:photos:prod` | `prod-photos.json` を本番サイト用バケットの `app/data/photos.json` としてアップロード。 |
| **API だけデプロイ** | `npm run api:deploy:prod` | Lambda + API Gateway を本番用にデプロイ。`prod-journey-photo-upload` を参照。 |
| **静的サイトだけデプロイ** | `npm run web:deploy:prod` | Next.js をビルドし、S3 にアップロードして CloudFront キャッシュ無効化。 |
| **本番を一括デプロイ** | `npm run deploy:prod` | チェック → API デプロイ → 静的サイトデプロイまで一括。写真一覧のアップロードは含まない。 |

**本番ビルド前の確認（.env.production）**

静的サイト（`web:deploy:prod` や `deploy:prod`）を実行する前に、**.env.production** を確認する。

| 変数 | 設定する値 | 理由 |
|------|------------|------|
| **NEXT_PUBLIC_API_BASE_URL** | **`https://journey-photo.com/api`** | カスタムドメインにすること。CloudFront の URL（`https://d1s3dwwzgxf5ni.cloudfront.net/api` など）にすると、journey-photo.com で開いたページが別オリジンに API を呼び出し、**CORS でブロック**されて写真が 0 件になる。 |
| **NEXT_PUBLIC_SITE_URL** | `https://journey-photo.com` | 本番のサイト URL。 |

変更した場合は **必ず静的サイトを再ビルド・再デプロイ**（`npm run web:deploy:prod`）する。環境変数はビルド時に埋め込まれるため、変更だけでは反映されない。

**本番反映の流れ（推奨）**

1. **写真データを更新した場合**
   ```bash
   npm run convert:photos:prod   # dev-photos.json → prod-photos.json
   npm run upload:photos:prod    # 本番 S3 に app/data/photos.json としてアップロード
   ```
2. **API または静的サイトを反映する場合**
   ```bash
   npm run deploy:prod           # lint/type-check → api:deploy:prod → web:deploy:prod
   ```
3. **写真もコードもまとめて本番反映する場合**
   ```bash
   npm run convert:photos:prod
   npm run upload:photos:prod
   npm run deploy:prod
   ```

**全部デプロイし直してキャッシュも消す（トラブル時）**

写真が 0 件・CORS エラー・古いキャッシュで原因が分かりにくいときは、**全部デプロイし直す**と早い。

1. **.env.production** を確認する。  
   `NEXT_PUBLIC_API_BASE_URL=https://journey-photo.com/api`（CloudFront の URL にしない）。
2. 次をまとめて実行する。  
   ```bash
   npm run convert:photos:prod
   npm run upload:photos:prod
   npm run deploy:prod
   ```

- **`web:deploy:prod`**（`deploy:prod` に含まれる）の最後で **CloudFront の `/*` 無効化**が実行される。Secrets Manager に **CLOUDFRONT_DISTRIBUTION_ID** が入っていれば、手動で `aws cloudfront create-invalidation` を叩く必要はない。
- 無効化の反映に 2〜5 分かかることがある。完了後に https://journey-photo.com を開き直す（必要なら Ctrl+Shift+R）。

**注意**

- **デプロイのたびに写真が消える**: `web:deploy:prod` は `aws s3 sync out/ ... --delete` でバケットを上書きするため、**`app/data/photos.json` は out/ に含まれず削除されます**。対策として、**web:deploy:prod のなかで sync のあとに `upload:photos:prod` を自動実行**するようにしてあります（`app/data/prod-photos.json` または `dev-photos.json` がローカルにあれば復元されます）。ローカルにどちらも無い場合は「写真一覧が 0 件になります」と警告が出るので、そのときは `npm run convert:photos:prod && npm run upload:photos:prod` で復元してください。
- 本番の写真一覧は **`prod-photos.json`**（本番 URL の `src`）をアップロードすること。`dev-photos.json` をそのまま本番に上げない。詳細は [app/data/README.md](../app/data/README.md)。

**デプロイ時の流れ（写真データ）**

`web:deploy:prod` 実行時は次の順で動きます。**本番で管理者が登録した写真を上書きしない**ため、必ず「本番 → ローカル」を取り込んでからビルド・アップロードします。

1. **本番 S3 の `app/data/photos.json`** をローカルの **`app/data/prod-photos.json`** にダウンロード（初回やファイルが無い場合は既存のローカルファイルを使用）。
2. その `prod-photos.json` を使って Next.js をビルド。
3. `aws s3 sync out/ ... --delete` で静的ファイルをアップロード（このとき S3 の `app/data/photos.json` は削除される）。
4. ローカルの `prod-photos.json`（＝手順1で取り直した本番の内容）を S3 の `app/data/photos.json` として再アップロード。
5. CloudFront のキャッシュ無効化。

**本番の写真データを守るための推奨対策**

| 対策 | 内容 | やり方 |
|------|------|--------|
| **① デプロイ前に本番をローカルに反映** | ローカルだけの古い `prod-photos.json` で本番を上書きしない | ✅ 済：`web:deploy:prod` の [0/3] で本番 S3 から `prod-photos.json` を取得してからビルドしている。 |
| **② S3 バージョニングを有効化** | `app/data/photos.json` を誤って上書き・削除しても、過去バージョンから復元できる | AWS コンソールでサイト用バケットを開く → **バージョニング** を「有効にする」。必要ならライフサイクルで古いバージョンを一定期間後に削除。 |
| **③ デプロイ前のローカルをバックアップ（任意）** | 本番を取り込む前に、今のローカル `prod-photos.json` を日付付きで退避しておくと、差分確認やロールバックがしやすい | `npm run backup:prod-photos` で `app/data/backups/prod-photos-YYYYMMDD-HHmmss.json` が作成される（直近 10 件を保持）。 |
| **④ 本番のみで写真を追加する運用を避ける** | 本番管理画面でだけ追加し、ローカルに取り込まずに別のデプロイをすると、取り込み前の古いローカルで上書きされる可能性がある | 常に **`web:deploy:prod` でデプロイ**する（毎回本番を取得してからアップロードするため安全）。`upload:photos:prod` だけ単体で実行する場合は、事前に本番から取得するか、意図した内容であることを確認する。 |

- **②** は一度設定すれば、誤操作やスクリプト不具合時にも S3 の「以前のバージョン」から `app/data/photos.json` を復元できるので特におすすめです。
- **③** を使う場合: デプロイ前に `npm run backup:prod-photos` を実行すると、`app/data/backups/` に日付付きコピーが作られます。

**開発と本番の対応**

| 項目 | 開発（dev） | 本番（prod） |
|------|-------------|--------------|
| Secrets Manager | `dev-journey-photo-upload` | `prod-journey-photo-upload` |
| サイト用 S3 バケット | `dev-journey-photo.com` | `prod-journey-photo.com` など（シークレットの `AWS_S3_SITE_BUCKET_NAME`） |
| 画像アップロード用 S3 | `dev-journey-photo-upload` | `prod-journey-photo-upload` |
| 写真データ（ローカル） | `app/data/dev-photos.json` | `app/data/prod-photos.json`（本番 S3 には `app/data/photos.json` としてアップロード） |
| API デプロイ | `npm run api:deploy:dev` | `npm run api:deploy:prod` |
| 静的サイトデプロイ | 任意（dev 用 S3 があれば手動など） | `npm run web:deploy:prod` |

---

## 本番URL一覧

| 種類 | URL | 備考 |
|------|-----|------|
| **本番のサイトURL** | `https://journey-photo.com` | 公開用。`.env.production` の `NEXT_PUBLIC_SITE_URL` |
| **API のベース** | `https://journey-photo.com/api` | `NEXT_PUBLIC_API_BASE_URL` |
| **CloudFront のドメイン** | `https://d1s3dwwzgxf5ni.cloudfront.net` | 配信元。Route 53 の A/AAAA がここを向く |

- `.env.production` は **`NEXT_PUBLIC_SITE_URL=https://journey-photo.com`** と **`NEXT_PUBLIC_API_BASE_URL=https://journey-photo.com/api`** にしておく。

---

## 本番の正しい構成（何がどこにあるか）

ユーザーが **https://journey-photo.com** で見るものと、その裏側の対応関係です。

**ユーザーから見える URL**

| URL | 中身 |
|-----|------|
| `https://journey-photo.com/` | トップページ（HTML/JS） |
| `https://journey-photo.com/api/photos` | 写真一覧の JSON（API） |
| `https://journey-photo.com/uploads/xxxx.jpg` | 各写真の画像ファイル |

**CloudFront が「どのパスをどこに渡すか」の正しい形**

| パス | 渡す先 | 中身の置き場所 |
|------|--------|----------------|
| **`/`** や **`/*`**（デフォルト） | S3 サイト用バケット | HTML・JS・`app/data/photos.json` など |
| **`/api/*`** | API Gateway（Lambda） | 一覧取得・アップロード API |
| **`/uploads/*`** | S3 画像用バケット | アップロードされた画像（.jpg など） |

**S3 バケットの役割（本番）**

| バケット名 | 役割 | 中身の例 |
|------------|------|----------|
| **prod-journey-photo.com** | サイト用 | `index.html`、`_next/`、**`app/data/photos.json`**（一覧データ） |
| **prod-journey-photo-upload** | 画像用 | **`uploads/xxxx.jpg`**（写真ファイル本体） |

**正しい状態のまとめ**

- 一覧データ（`photos.json`）→ サイト用バケットの `app/data/photos.json` にあり、API がここを読んで返す。✅ いまここはできている。
- 画像ファイル → 画像用バケット（`prod-journey-photo-upload`）の `uploads/` にある。✅ ここも確認済みで 19 件ある。
- **足りていないもの**: CloudFront で **「`/uploads/*` のリクエストを画像用バケット（prod-journey-photo-upload）に渡す」** 設定。  
  → これがないと `https://journey-photo.com/uploads/xxx.jpg` がサイト用バケットを参照し、そこに `uploads/` がないため 404 になり「画像を読み込めません」になる。

**やること（画像を表示させるため）**

CloudFront の **Behaviors** に次を追加する。

- **Path pattern**: `uploads/*`
- **Origin**: S3 の **prod-journey-photo-upload**（オリジンは事前に作成し、OAC でアクセス許可）
- **順序**: `api/*` や `*`（Default）より**上**に置く

これで「何が正しいか」と「今どこが足りていないか」が揃います。

---

## AレコードとAAAAレコードの違い

| タイプ | 役割 | 向き先の形式 |
|--------|------|----------------|
| **A** | **IPv4** で「このドメインのサーバーはどこか」を指す | IPv4 アドレス（例: 192.0.2.1） |
| **AAAA** | **IPv6** で同じく「サーバーはどこか」を指す | IPv6 アドレス |

- **どちらも「ドメイン → サーバー（ここでは CloudFront）」を指す**。A は IPv4 用、AAAA は IPv6 用。
- Route 53 で **エイリアス** を使うと、A と AAAA の両方で **同じ CloudFront ディストリビューション** を指定できる（IP は自動）。
- **触るのは A と AAAA の 4 件だけ**（ルートと www の 2 ドメイン × 2 タイプ）。NS・SOA・CNAME は変更しない。

---

## CloudFront（API用）の設定

**目的**: `https://journey-photo.com/api/*` を API Gateway（Lambda）に渡す。API のルートは `/api/photos` など `/api` プレフィックス付きでデプロイされている。

**本番で使う CloudFront**: `d1s3dwwzgxf5ni.cloudfront.net`

### 手順

1. **API Gateway の URL を確認**  
   プロジェクトルートで `cd api` のあと `npx serverless info --stage prod` を実行。**endpoints:** の URL の「パスより前」をメモ（例: `https://ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com`）。

2. **CloudFront → オリジン** で **オリジンを作成**。  
   **オリジンドメイン**: 上記の `https://` を除いた部分（例: `ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com`）。**名前** は例: `API-Gateway-prod`。

3. **CloudFront → ビヘイビア** で **ビヘイビアを作成**。  
   **パスパターン**: `api/*`。**オリジン**: 上記で作った API 用オリジン。**ビューワープロトコルポリシー**: Redirect HTTP to HTTPS。  
   **`api/*` の行を `*`（Default）より上に置く。**

---

## CloudFront（画像用 /uploads/*）の設定

**目的**: `https://journey-photo.com/uploads/xxx.jpg` を **画像用 S3 バケット（prod-journey-photo-upload）** から配信する。  
これがないと一覧は出るが「画像を読み込めません」になる。

**前提**: 同じ CloudFront ディストリビューション（本番用）を使う。API 用の設定はそのまま。

### 手順

**1. 画像用 S3 用の OAC（Origin Access Control）を作る（まだ無い場合）**

- **CloudFront** → 左メニュー **「Origin access」** → **「Origin access control」** → **「Create control setting」**
- **名前**: 例: `prod-journey-photo-upload-oac`
- **Signing behavior**: **Sign requests (recommended)**
- **Origin type**: **S3**
- **「Create」** で保存

**2. 画像用 S3 バケットのポリシーで CloudFront を許可する**

- **S3** → バケット **prod-journey-photo-upload** を開く → **「Permissions」** → **「Bucket policy」** → **「Edit」**
- 次の JSON を設定する（`YOUR_DISTRIBUTION_ARN` は CloudFront のディストリビューション ARN、例: `arn:aws:cloudfront::123456789012:distribution/EYRLTGCPOS9E4`。`YOUR_OAC_ARN` は上で作った OAC の ARN）。

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
      "Resource": "arn:aws:s3:::prod-journey-photo-upload/uploads/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "YOUR_DISTRIBUTION_ARN"
        }
      }
    }
  ]
}
```

- **「Save changes」**

**3. CloudFront に「画像用 S3」のオリジンを追加する**

- **CloudFront** → 本番用ディストリビューションを開く → **「Origins」** タブ → **「Create origin」**
- **Origin domain**: プルダウンから **`prod-journey-photo-upload.s3.ap-northeast-1.amazonaws.com`** を選択（なければ手入力）
- **Name**: 例: `S3-prod-journey-photo-upload`
- **Origin access**: **Origin access control settings (recommended)** を選び、上で作った OAC（例: `prod-journey-photo-upload-oac`）を選択
- **「Create」**

**4. ビヘイビア「uploads/*」を追加する**

- **「Behaviors」** タブ → **「Create behavior」**
- **Path pattern**: `npm run deploy:prod`
- **Origin and origin groups**: 上で作った **S3-prod-journey-photo-upload** を選択
- **Viewer protocol policy**: **Redirect HTTP to HTTPS**
- **Cache policy**: **CachingOptimized** など（デフォルトで可）
- **「Create behavior」**
- **順序**: 一覧で **`uploads/*`** が **`api/*`** と **`*`（Default）より上**になるようにする（より具体的なパスが上）。  
  「Edit」で **Precedence** の数字を小さくすると上に来る。

**5. 反映を待つ**

- 数分かかることがある。その後、`https://journey-photo.com/uploads/29de9197-5d15-490e-83ae-491e7386bb34.jpg` などを開いて画像が表示されれば OK。
- まだ古いキャッシュが出る場合は:  
  `aws cloudfront create-invalidation --distribution-id EYRLTGCPOS9E4 --paths "/uploads/*"`

---

## Route 53（journey-photo.com）の設定

**目的**: journey-photo.com でアクセスしたときに CloudFront に繋がるようにする。

- **重要**: Route 53 に A/AAAA を置いても、**ドメインの「名前サーバー」が Route 53 を向いていない**と NXDOMAIN になります。→ [トラブルシューティング「NXDOMAIN」](#4-このサイトにアクセスできませんdns_probe_finished_nxdomain) を参照。

### 7 レコードある場合の内訳

| レコード名 | タイプ | 触る？ | 説明 |
|------------|--------|--------|------|
| journey-photo.com | **A** | ✅ 更新 | サイト（IPv4）→ CloudFront |
| journey-photo.com | **AAAA** | ✅ 更新 | サイト（IPv6）→ CloudFront |
| journey-photo.com | NS | ❌ 触らない | 名前サーバー（自動作成） |
| journey-photo.com | SOA | ❌ 触らない | ゾーン情報（自動作成） |
| _xxxxx.journey-photo.com | CNAME | ❌ 触らない | 証明書検証用など |
| www.journey-photo.com | **A** / **AAAA** | ✅ 更新 | www → CloudFront |

**やること**: journey-photo.com と www の **A と AAAA の計 4 件** の「トラフィックのルーティング先」を **CloudFront ディストリビューション**（`d1s3dwwzgxf5ni.cloudfront.net`）にし、**エイリアス** で指定する。無ければ作成、あれば編集。

---

## トラブルシューティング

### 1. ルート（/）で何も表示されない・真っ白・403・404

- **CloudFront → Behaviors**: Path pattern **`*`** の **Origin** が **S3**（Secrets Manager の `AWS_S3_SITE_BUCKET_NAME` のバケット）になっているか確認。API Gateway のままだと `/` に何も返らない。
- **CloudFront → General**: **Default root object** が **`index.html`** か確認。
- **S3**: サイト用バケットのルートに **`index.html`** があるか確認。無ければ **プロジェクトルート** で `npm run web:deploy:prod` を実行（`api` フォルダ内の `deploy:prod` は API のみで S3 には上がらない）。

### 2. S3 にファイルが無い・別バケットにデプロイしている

- Secrets Manager（`prod-journey-photo-upload`）の **`AWS_S3_SITE_BUCKET_NAME`** と、CloudFront の Origin で参照している S3 バケット名が **同じ** か確認。
- デプロイは **プロジェクトルート** で `npm run web:deploy:prod`。

### 3. 設定を直したのにまだ反映されない

- CloudFront のキャッシュ無効化:  
  `aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths "/*"`
- 数分待ってからシークレットウィンドウや Ctrl+F5 で再アクセス。

### 4. 「このサイトにアクセスできません」・DNS_PROBE_FINISHED_NXDOMAIN

**デプロイのやり直しでは直りません。** 名前サーバー（NS）の設定が原因です。

1. **Route 53 → ホストゾーン → journey-photo.com** で、**タイプ NS** のレコードの **値 4 つ** をメモ。
2. **journey-photo.com を取得したレジストラ**（AWS・お名前.com・ムームー等）の管理画面で、**このドメインの「名前サーバー」** を上記 4 つに変更して保存。
3. 反映に数時間～最大 48 時間かかることがある。

**補足**: まず `https://d1s3dwwzgxf5ni.cloudfront.net/` でサイトが開くか確認。開けば CloudFront/S3 は問題なく、journey-photo.com の名前サーバーを Route 53 に合わせるだけで解消します。

### 5. journey-photo.com は解決するが表示されない

- Route 53 の **A/AAAA（エイリアス）** が CloudFront を指しているか。
- CloudFront の **Alternate domain names** に `journey-photo.com` が入っているか。
- **SSL 証明書**（ACM、us-east-1）で journey-photo.com をカバーしているか。

### 6. サイトは開くが「写真が0件」「該当する写真がありません」

**原因**: 写真一覧は **API（GET /api/photos）** が返しており、API は **S3 の `app/data/photos.json`** を読んでいます。本番のサイト用バケットにこのファイルが無いか空だと 0 件になります。

**原因**: 本番の API（Lambda）は **サイト用 S3 バケット**の `app/data/photos.json` だけを参照します。このファイルがバケットに無い、または空だと 0 件になります。

**対処**:

1. **すぐ試す（推奨）**  
   開発用 `app/data/dev-photos.json` を本番用に分離してからアップロードする：
   ```bash
   npm run convert:photos:prod   # dev-photos.json から prod-photos.json を生成
   npm run upload:photos:prod   # prod-photos.json を本番 S3 にアップロード
   ```
   （`dev-photos.json` = 開発用・`prod-photos.json` = 本番用。詳細は [app/data/README.md](../app/data/README.md)。`prod-photos.json` が無い場合は `upload:photos:prod` が `dev-photos.json` を変換してからアップロードします。）

2. **管理画面から写真をアップロードする**  
   本番でログインし、**管理** → 写真アップロードで 1 枚以上アップロードする。API が S3 に `app/data/photos.json` を作成・更新します。

3. **既存の本番用 JSON を手動で S3 に置く**  
   - バケット名: Secrets Manager の **`AWS_S3_SITE_BUCKET_NAME`**（例: `journey-photo.com`）  
   - キー: **`app/data/photos.json`**（S3 上はこのパス）  
   - 例（AWS CLI）:  
     `aws s3 cp app/data/prod-photos.json s3://<AWS_S3_SITE_BUCKET_NAME>/app/data/photos.json`  
   - 本番には **prod-photos.json**（本番 URL の `src`）を置く。開発用の `dev-photos.json` をそのまま置かないこと。

**まだ 0 件のときの確認**（`upload:photos:prod` 済みでも 0 件なら次を順に確認）:

1. **API に届いているか**  
   ブラウザで **`https://journey-photo.com/api/photos`** を開く。  
   - **JSON の配列**（`[{...}, ...]`）が表示される → API は動いている。Lambda が読んでいるバケットとアップロード先が違う可能性（下記 2）。  
   - **404 や HTML ページ** が表示される → **CloudFront が `/api/*` を Lambda に渡していない**。CloudFront → Behaviors で **Path pattern `api/*`** のビヘイビアがあり、**オリジンが API Gateway** になっており、**`*`（Default）より上**にあるか確認する。

2. **Lambda が読むバケットとアップロード先を一致させる**  
   Secrets Manager（`prod-journey-photo-upload`）の **`AWS_S3_SITE_BUCKET_NAME`** の値を確認する。  
   - `upload:photos:prod` でアップロードした先が **`prod-journey-photo.com`** なら、この値も **`prod-journey-photo.com`** である必要がある。  
   - ここが **`journey-photo.com`** など別名だと、Lambda は別バケットの `app/data/photos.json` を読むため 0 件になる。  
   → その場合は **`prod-journey-photo.com` にアップロードしたのと同じ内容を、`journey-photo.com` バケットの `app/data/photos.json` に置く**か、シークレットの `AWS_S3_SITE_BUCKET_NAME` を `prod-journey-photo.com` に合わせる。

3. **CloudFront のキャッシュ**  
   設定を直したあとはキャッシュ無効化:  
   `aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths "/api/*"`  
   その後、ブラウザでスーパーリロード（Ctrl+Shift+R など）して再表示する。

### 7. CORS エラーで写真が取得できない（コンソールに Access-Control-Allow-Origin）

**症状**: サイトは開くが写真が 0 件。ブラウザの開発者ツール（F12）のコンソールに  
「Access to fetch at 'https://d1s3dwwzgxf5ni.cloudfront.net/api/photos' from origin 'https://journey-photo.com' has been blocked by CORS policy」のようなエラーが出る。

**原因**: 本番ビルド時に **NEXT_PUBLIC_API_BASE_URL** が **CloudFront の URL** になっている。  
ページは journey-photo.com で開いているのに、API 呼び出し先が CloudFront ドメインになり、別オリジンとして CORS でブロックされる。

**対処**:

1. **.env.production** を開き、次に修正する。  
   - **誤**: `NEXT_PUBLIC_API_BASE_URL=https://d1s3dwwzgxf5ni.cloudfront.net/api`（または CloudFront の URL）  
   - **正**: `NEXT_PUBLIC_API_BASE_URL=https://journey-photo.com/api`
2. 静的サイトを再ビルド・再デプロイする。  
   ```bash
   npm run web:deploy:prod
   ```
3. デプロイ後、数分待ってから https://journey-photo.com を開き直す（必要なら Ctrl+Shift+R でスーパーリロード）。

これで同じオリジン（journey-photo.com）に API を呼ぶため、CORS は発生しない。

---

## 開発用・本番用の photos の分離

**結論**: ローカルでは **`dev-photos.json`（開発用）** と **`prod-photos.json`（本番用）** を分けています。本番 S3 に置くのは本番用の内容だけにしてください。

| ファイル | 用途 | 画像 URL（`src`） |
|----------|------|-------------------|
| **dev-photos.json** | **開発環境**（ローカル・Next API・dev Lambda） | 開発用（例: `dev-journey-photo-upload.s3...`） |
| **prod-photos.json** | **本番環境**（本番 S3 にアップロードする用） | 本番用（例: `https://journey-photo.com/uploads/...`） |

- 開発時は **`dev-photos.json`** だけ編集する。
- 本番反映: `npm run convert:photos:prod` で `prod-photos.json` を生成 → `npm run upload:photos:prod` で本番 S3 にアップロード。  
  詳細は [app/data/README.md](../app/data/README.md)。

※ 画像ファイル自体も本番バケットに置く必要があります。管理画面からのアップロードなら画像・JSON とも本番に揃います。

---

## クイックチェックリスト

- [ ] **.env.production**: `NEXT_PUBLIC_API_BASE_URL=https://journey-photo.com/api`（**CloudFront の URL にしない**。CORS で写真が取れなくなる）。`NEXT_PUBLIC_SITE_URL=https://journey-photo.com`。
- [ ] **CloudFront Origins**: 静的サイト用 S3 が 1 つあり OAC 設定済み。API 用に API Gateway を 1 つ追加済み。
- [ ] **CloudFront Behaviors**: `api/*` が API Gateway オリジンで **`*` より上**。Path pattern **`*`** の Origin が S3。Redirect HTTP to HTTPS。
- [ ] **CloudFront General**: **Default root object** = `index.html`。
- [ ] **S3**: サイト用バケットのルートに `index.html` がある（`npm run web:deploy:prod` 済み）。写真一覧を更新した場合は `npm run upload:photos:prod` で `app/data/photos.json` をアップロード済み。
- [ ] **Secrets Manager**（`prod-journey-photo-upload`）: 必須キーがすべてある。`AWS_S3_SITE_BUCKET_NAME` がアップロード先のバケット名と一致している。
- [ ] **Cognito**: 本番のコールバックURL・サインアウトURL に `https://journey-photo.com` を追加。
- [ ] **Route 53**: journey-photo.com / www の **A と AAAA** が CloudFront（エイリアス）を指している。ドメインの**名前サーバー**が Route 53 の NS 4 つに設定されている。
- [ ] **カスタムドメイン + HTTPS**: CloudFront の Alternate domain names に journey-photo.com、Custom SSL certificate を設定。

---

## 本番の Secrets Manager（想定値）

**シークレット名**: `prod-journey-photo-upload`

| キー | 必須 | 想定値の例 |
|------|------|------------|
| **COGNITO_USER_POOL_ID** | ✅ | `ap-northeast-1_ZbuhDQsWz` |
| **AWS_REGION** | ✅ | `ap-northeast-1` |
| **AWS_S3_BUCKET_NAME** | ✅ | `prod-journey-photo-upload` |
| **AWS_S3_SITE_BUCKET_NAME** | ✅ | `prod-journey-photo.com` または `journey-photo.com` |
| **CLOUDFRONT_URL** | ✅ | `https://d1s3dwwzgxf5ni.cloudfront.net` |
| **CLOUDFRONT_DISTRIBUTION_ID** | 任意 | CloudFront コンソールで確認 |

---

## OAC（Origin Access Control）とは／サイト用 OAC の説明

**OAC** は、**CloudFront だけが S3 にアクセスできるようにする**ための設定です。  
S3 バケットを「全世界に公開」にしなくても、CloudFront 経由でのみ配信できます。

| 用語 | 説明 |
|------|------|
| **OAC** | Origin Access Control。CloudFront がオリジン（ここでは S3）にリクエストするときに使う「CloudFront であること」の証明。S3 のバケットポリシーで「この CloudFront からのアクセスのみ許可」と書くときに、OAC を指定する。 |
| **サイト用 OAC**（例: **PhotoGallerySiteOAC**） | **静的サイト用 S3 バケット**（`prod-journey-photo.com`）用の OAC。CloudFront の「Default（`*`）」のオリジンで、この OAC を選ぶと、HTML/JS や `app/data/photos.json` がそのバケットから安全に配信される。名前はコンソールで付けたもので、`journey-photo-com-oac` など別名でもよい。 |
| **画像用 OAC**（例: **prod-journey-photo-upload-oac**） | **画像用 S3 バケット**（`prod-journey-photo-upload`）用の OAC。`/uploads/*` のビヘイビアでこの OAC を使うと、画像ファイルがそのバケットから配信される。 |

**PhotoGallerySiteOAC** のような名前は、AWS コンソールで OAC を作成したときに付けた**識別用の名前**です。  
「サイト用 S3（prod-journey-photo.com）に CloudFront からアクセスするための OAC」という意味で使っているなら、その OAC を静的サイト用オリジンの **Origin access control** で選べば正しいです。

---

## CloudFront 画面ごとの設定値（参考）

| タブ | やること | 入れる値 |
|------|----------|----------|
| **Origins** | Origin domain | `<AWS_S3_SITE_BUCKET_NAME>.s3.ap-northeast-1.amazonaws.com`。OAC を選択（サイト用なら PhotoGallerySiteOAC など）。 |
| **Behaviors**（`*`） | オリジン | 上記 S3。圧縮 Yes。Redirect HTTP to HTTPS。 |
| **General** | Default root object | `index.html`。カスタムドメイン時は Alternate domain names に journey-photo.com。 |

---

## CloudFront 設定ガイド（画面ごとの操作）

本番は **1 つの CloudFront ディストリビューション** で、**静的サイト（S3）** と **API（API Gateway）** の両方を配信します（`/` → S3、`/api/*` → API Gateway）。

### 1. CloudFront を開く

1. AWS コンソールで **「CloudFront」** を開く
2. **「Distributions」** 一覧から本番用のディストリビューションをクリック（**Alternate domain names** に `journey-photo.com` があるもの）

### 2. 「Origins」タブでオリジンを確認・設定

- **静的サイト用**: Origin domain に `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com`、**Origin access** で **Origin access control (OAC)** を選択（例: `journey-photo-com-oac`）
- **API 用**: Origin domain に API Gateway の URL

修正する場合は **「Create origin」** または既存の **「Edit」** で上記のとおり設定し **「Save changes」**。

**オリジン作成時の推奨値（S3）:** Origin domain に上記 S3 エンドポイント、Origin path は空欄、名前は識別用に任意、**オリジンアクセス** は **OAC** を選択。それ以外はデフォルトで可。

### 3. 「Behaviors」タブでパスごとの配信先を設定

| Path pattern | 用途 | Origin |
|--------------|------|--------|
| `/api/*` | API | API Gateway の Origin |
| `*` (Default) | 静的サイト全体 | S3（prod-journey-photo.com） |

**重要**: `/api/*` が `*` より**上（優先度が高い）**になっている必要があります。

**Default（`*`）の設定:** オリジンに S3 を選択、**Viewer protocol policy** を **Redirect HTTP to HTTPS**、**Allowed HTTP methods** を **GET, HEAD, OPTIONS**（または GET, HEAD）、**Compress objects automatically** を **Yes**。**Save changes**。

**`/api/*` の設定:** Origin に API Gateway を選択。Behavior がなければ **「Create behavior」** で Path pattern: `api/*`、Origin: API Gateway を追加。

### 4. 「General」タブでルートオブジェクトとドメインを設定

- **Default root object**: **`index.html`**（必須）
- カスタムドメイン: **Alternate domain names** に `journey-photo.com`、**Custom SSL certificate** で us-east-1 の ACM 証明書を選択

### 5. 設定変更の反映

変更後、**Deployed** になるまで数分～15 分かかることがあります。すぐ確認する場合はキャッシュ無効化（`aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"`）。ブラウザはシークレットウィンドウまたは Ctrl+F5 で再読み込み。

### 6. クイックチェックリスト（Origins / Behaviors / General）

- **Origins**: Origin domain = `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com`、Origin path = 空欄、オリジンアクセス = OAC を選択 → **Save changes**
- **Behaviors（`*`）**: パスパターン = `*`、オリジン = 上記 S3、圧縮 Yes、Redirect HTTP to HTTPS、GET, HEAD → **Save changes**
- **General**: Default root object = `index.html`、カスタムドメイン時は Alternate domain names と SSL 証明書 → **Save changes**

---

## 参照

- **[環境設定の整理](./ENVIRONMENT_CONFIG.md)** — 環境変数一覧
- **[本番環境のセットアップ](./PRODUCTION_SETUP.md)** — 初回構築の全体手順
