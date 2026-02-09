# トラブルシューティング（アップロード・Lambda）

開発環境でアップロードがエラーになる場合、および Lambda API で考えられる問題の診断と解決方法です。

---

## 📋 目次

1. [アップロードエラー](#アップロードエラー)
2. [Lambda 側の確認](#lambda-側の確認)
3. [よくあるエラーと解決方法](#よくあるエラーと解決方法)
4. [本番画像が遅い・タイムアウトする](#本番画像が遅いタイムアウトする)
5. [デプロイ後の古いキャッシュ（503/403）](#デプロイ後の古いキャッシュ503403)
6. [確認チェックリスト](#確認チェックリスト)
7. [ドメインで1枚の写真だけ表示される（謎の画面）](#ドメインで1枚の写真だけ表示される謎の画面)
8. [参照](#参照)

---

## アップロードエラー

### 診断手順

**ステップ1: Secrets Manager の設定を確認**

```bash
npm run check:dev-secrets
```

- `dev-journey-photo-upload` に `COGNITO_USER_POOL_ID` が設定されているか
- `.env.local` の `NEXT_PUBLIC_COGNITO_USER_POOL_ID` と一致しているか

**ステップ2: ログイン状態の確認**

1. `/login` で開発用 Cognito User Pool にログイン
2. **admin グループに属しているユーザー**でログインしているか確認
3. ログイン後、アップロードページ (`/upload`) を再読み込み

**ステップ3: Lambda 側のログを確認**

```bash
# Windows（Git Bash）: MSYS_NO_PATHCONV=1 を付けるか、PowerShell で実行
aws logs tail '/aws/lambda/photo-gallery-api-dev-api' --follow
```

アップロードを試行して、エラーログを確認する。

---

## Lambda 側の確認

### 確認ポイント

1. **Lambda 関数がデプロイされているか**  
   `npm run api:info:dev` でエンドポイントと環境変数を確認。

2. **環境変数 `AWS_SECRET_NAME`**  
   Lambda の環境変数で `AWS_SECRET_NAME=dev-journey-photo-upload` になっているか。

3. **Secrets Manager への権限**  
   Lambda の IAM ロールに `dev-journey-photo-upload` の `secretsmanager:GetSecretValue` があるか。

4. **Secrets Manager に `COGNITO_USER_POOL_ID` があるか**  
   Lambda ログで `COGNITO_USER_POOL_ID not found` が出ていないか。`Config loaded from Secrets Manager` が出ているか。

5. **JWT 検証・admin グループ**  
   ログで `JWT token verified`、`User is not in admin group` の有無を確認。

6. **再デプロイ**  
   コード変更後は `npm run api:deploy:dev` で再デプロイ。

### Lambda 側の診断手順（詳細）

**ステップ1: Lambda 関数の情報を確認**

```bash
npm run api:info:dev
```

- エンドポイント URL が `.env.local` の `NEXT_PUBLIC_API_BASE_URL` と一致しているか
- 環境変数 `AWS_SECRET_NAME` が `dev-journey-photo-upload` になっているか

**ステップ2: Lambda のログを確認**

- **Windows（Git Bash）**: `/aws/lambda/...` がパスとして解釈されるため、`MSYS_NO_PATHCONV=1` を付けるか **PowerShell** で実行する。
  ```bash
  # PowerShell で実行（推奨）
  aws logs tail '/aws/lambda/photo-gallery-api-dev-api' --follow
  ```
- **Linux/Mac**:
  ```bash
  aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow
  ```

確認するログ: `Request received` / `Config loaded from Secrets Manager` / `COGNITO_USER_POOL_ID not found` / `JWT token verified` / `JWT token verification failed` / `User is not in admin group`

**ステップ3: 再デプロイ（必要に応じて）**

```bash
npm run api:deploy:dev
```

---

## よくあるエラーと解決方法

| エラー・症状 | 原因 | 解決方法 |
|--------------|------|----------|
| **認証が必要です** | 未ログイン or JWT が取れていない | `/login` でログイン。localStorage の Cognito セッションを確認。 |
| **認証に失敗しました（401）** | Secrets Manager の `COGNITO_USER_POOL_ID` が .env.local と不一致 | `npm run check:dev-secrets`。不一致なら `npm run fix:dev-secrets` または Secrets Manager を手動更新。 |
| **管理者権限が必要です（403）** | ログインユーザーが admin グループにない | Cognito でユーザーを `admin` グループに追加。ログアウトして再ログイン。 |
| **COGNITO_USER_POOL_ID not found** | Secrets Manager にキーがない or `AWS_SECRET_NAME` が違う | `npm run fix:dev-secrets`。Lambda の `AWS_SECRET_NAME` を確認。 |
| **JWT token verification failed** | User Pool ID の不一致 or トークン期限切れ | Secrets Manager と .env.local の一致を確認。ブラウザで再ログイン。 |
| **User is not in admin group** | ユーザーが admin グループに属していない | Cognito で admin グループに追加。再ログイン。 |

### その他の対処

- **Lambda を再デプロイ**: `npm run api:deploy:dev`
- **ブラウザキャッシュ**: Application → Local Storage をクリアし、再読み込み
- **環境変数**: `.env.local` が読み込まれているか確認。`npm run dev` を再起動

---

## 本番画像が遅い・タイムアウトする

### 現象

- `https://journey-photo.com/uploads/xxx.jpg` を開いても画像がなかなか表示されない
- ツールやスクリプトで画像URLを取得するとタイムアウトする
- 一覧ページで写真が「読み込み中」のままになる時間が長い

### 想定される原因

1. **画像ファイルが大きい**  
   一覧・詳細ともに同じフル解像度のURLを使っているため、1枚あたり数MBになることがある。回線が遅いと転送に時間がかかり、タイムアウトしやすい。

2. **CloudFront のキャッシュ**  
   `/uploads/*` のビヘイビアでキャッシュが無効や短いと、毎回 S3 オリジンへ取りに行き、体感が遅くなる。

3. **ネットワーク・オリジン**  
   利用環境や S3 オリジンへの経路によっては、初回取得に時間がかかる。

### 確認方法

**全画像のサイズを一覧する場合:**

```bash
npm run check:prod-image-sizes
```

- 1枚あたり 1MB 超が続く、または合計が数十MBある場合は「重い」状態。

**特定の1枚の画像でタイムアウトする原因を正確に切り分けたい場合:**

```bash
npm run diagnose:image -- "https://journey-photo.com/uploads/29de9197-5d15-490e-83ae-491e7386bb34.jpg"
```

- HEAD（ヘッダーだけ）と GET Range（先頭1バイトだけ）で応答時間・ステータス・Content-Length を計測します。
- どちらでタイムアウトするかで、**接続／オリジン遅延** と **ファイルサイズによる転送遅延** を区別できます。

### 対処

| 対策 | 内容 |
|------|------|
| **CloudFront で /uploads/* をキャッシュ** | [DEPLOY.md の「CloudFront（画像用 /uploads/*）の設定」](./DEPLOY.md#cloudfront画像用-uploadsの設定) のとおり、キャッシュポリシーを設定し、TTL を長め（例: 1年）にすると 2 回目以降が速くなる。 |
| **サムネイルを用意する** | 一覧用に小さい画像（例: 幅 400〜800px）を別URLで配信し、一覧ではそのURL、詳細ではフル解像度を使う。転送量が減り、表示が速くなる。→ [IMPROVEMENTS.md の「画像のサムネイル」](./IMPROVEMENTS.md) を参照。 |
| **アップロード時の画質・解像度** | アップロード前にリサイズや圧縮を行うと、元ファイルが小さくなり、そのまま配信しても軽くなる。 |

---

## 確認チェックリスト

- [ ] `.env.local` の `NEXT_PUBLIC_COGNITO_USER_POOL_ID` が設定されている
- [ ] Secrets Manager（`dev-journey-photo-upload`）に `COGNITO_USER_POOL_ID` が設定されている
- [ ] 上記 2 つが一致している
- [ ] ログインしている
- [ ] ログインユーザーが admin グループに属している
- [ ] Lambda API（`photo-gallery-api-dev-api`）がデプロイされている
- [ ] Lambda の環境変数 `AWS_SECRET_NAME` が `dev-journey-photo-upload`
- [ ] Lambda の IAM ロールに Secrets Manager の読み取り権限がある

---

## デプロイ後の古いキャッシュ（503/403）

デプロイ後に「読み込み中」のまま、または JS/CSS が 503/403 になる場合、**古い index.html がキャッシュされ、存在しない _next チャンクを参照している**ことが原因です。

**実施している対策**

| 対策 | 内容 |
|------|------|
| **index.html の Cache-Control** | デプロイ時に S3 の index.html に `no-cache, no-store, must-revalidate, max-age=0` を付与。CDN・ブラウザにキャッシュさせない／必ず再検証させる。 |
| **Service Worker** | HTML（`/` および `*.html`）は **キャッシュしない**。常にネットワークから取得するため、デプロイ後は新しい HTML が読まれる。マニフェスト・favicon などは従来どおりキャッシュ。 |
| **CloudFront 無効化** | デプロイ完了時に `/*` の invalidation を実行し、エッジのキャッシュを破棄。 |

**それでも古い表示になる場合**

- ブラウザで **スーパーリロード**（Ctrl+Shift+R / Cmd+Shift+R）
- または **サイトデータの削除**（ブラウザ設定で当サイトのキャッシュ・ストレージを削除）
- Service Worker が古いままの場合は、タブを閉じて再度サイトを開く（SW は CACHE_NAME 更新で自動的に新バージョンに置き換わります）

---

## ギャラリーで一部が「灰色ボックス」になる場合

一覧の一部だけ灰色になるのは **画像の読み込みが失敗している** 状態です。タイトル・カテゴリは枠の下に表示されるため、失敗時は灰色の上にテキストだけ出ているように見えます。

**本番の画像 URL に HEAD でアクセスした結果が 200 OK の場合**、CloudFront/画像用バケットの疎通は問題なし。考えられる原因:

| 原因 | 対処 |
|------|------|
| **A. Next.js の Image で絶対 URL が許可されていなかった** | `next.config.ts` の `images.remotePatterns` に journey-photo.com と CloudFront の `/uploads/**` を追加済み。要再デプロイ。 |
| **B. ブラウザキャッシュで古い失敗状態が残っている** | スーパーリロード（Ctrl+Shift+R）やキャッシュ削除で解消することが多い。 |
| **C. CloudFront で /uploads/* が画像用バケットに向いていない** | [DEPLOY.md - CloudFront（画像用 /uploads/*）の設定](./DEPLOY.md#cloudfront画像用-uploads-の設定) を確認。 |

**次のアクション**: `npm run web:deploy:prod` で再デプロイし、ブラウザでスーパーリロード（Ctrl+Shift+R）またはキャッシュ無効で表示を確認。一覧では先頭 24 件を最初から表示するようにしている（`IN_VIEW_INITIAL_COUNT`）。本番画像の実体確認は `node scripts/verify-prod-images-are-jpeg.js` で一括確認可能。

---

## ドメインで1枚の写真だけ表示される（謎の画面）

**症状**（いずれもルートにアクセスしたときの現象）:

- ギャラリー一覧ではなく **1枚の写真だけ**（例: レストランからの夕焼け）が表示される。
- または **「Photo Not Found」** とローディングスピナーだけが表示され、URL が `https://journey-photo.com/photo/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` のようになっている。

**原因**: CloudFront の **Default root object** が `index.html` ではなく、写真詳細用（`photo/_.html` 等）になっている。そのためルート（`/`）へのリクエストでトップ用の `index.html` が返らず、写真ページの HTML が返り、1枚だけ表示されたり存在しない ID で「Photo Not Found」になったりする。

**対処**:

1. **スクリプトで修正（推奨）**  
   プロジェクトルートで実行する（Secrets Manager に `CLOUDFRONT_DISTRIBUTION_ID` が入っているか、環境変数で渡す）:
   ```bash
   node scripts/ensure-cloudfront-default-root.js
   ```
   または:
   ```bash
   CLOUDFRONT_DISTRIBUTION_ID=あなたの配布ID node scripts/ensure-cloudfront-default-root.js
   ```
   これで Default root object が `index.html` に設定される。反映まで数分かかることがある。

2. **AWS コンソールで確認・修正**  
   - **CloudFront** → 該当ディストリビューション → **General** タブ  
   - **Default root object** を **`index.html`** に変更 → **Save changes**

3. **キャッシュの反映**  
   変更後、ブラウザで **スーパーリロード**（Ctrl+Shift+R / Cmd+Shift+R）またはサイトデータの削除を試す。

---

## コード上の注意点（修正済み・要確認）

以下のようなバグ要因は修正済みです。同様の変更を加える場合は挙動に注意してください。

| 箇所 | 内容 |
|------|------|
| **GalleryModal** | 画像プリロードの `useEffect` で `photos.length === 0` のときに `% photos.length` を実行すると NaN になるため、先頭で `if (!photos.length) return` を追加済み。 |
| **useGallery** | フィルター変更で一覧が短くなり `currentIndex` が範囲外になったとき、モーダルが不正表示にならないよう `useEffect` で `currentIndex` を `null` にリセットするようにした。 |
| **Toast** | トーストの「閉じる」で `setTimeout(removeToast, 300)` を実行しているため、アンマウント時に `clearTimeout` するクリーンアップを追加済み。表示用の `setTimeout(..., 10)` もクリーンアップ済み。 |
| **タッチ／クリック** | ボタン・リンクは **onClick のみ**で処理する方針に統一済み。`onTouchEnd` + `preventDefault()` は一部環境でクリックが発火せず「押しても反応しない」原因になるため削除。`touchAction: "manipulation"` で 300ms 遅延は抑制。 |

**その他の確認ポイント**

- **page.tsx**: モーダルは `currentIndex !== null && filteredPhotos[currentIndex]` のときだけ描画しているため、範囲外インデックスでは描画されない。
- **PhotoPageClient**: `photo` が `undefined`（find で見つからない）のときは 404 表示に分岐済み。
- **upload**: `getElementById("file-input")` は `if (input)` でガード済み。
- **addEventListener / setTimeout**: 主要なコンポーネント（FilterBar, GalleryModal, DeleteConfirmModal, page.tsx）では `useEffect` の return で removeEventListener / clearTimeout を実行済み。

---

## 参照

- **[環境設定の整理](./ENVIRONMENT_CONFIG.md)**
- **[セットアップ](./SETUP.md)** — ローカル・認証・アップロードの設定
- **[本番デプロイ](./DEPLOY.md)** — 本番のトラブルシューティング
