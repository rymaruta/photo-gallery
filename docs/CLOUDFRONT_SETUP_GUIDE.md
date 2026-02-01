# CloudFront 設定ガイド（どこを見て何を設定するか）

このプロジェクトの本番は **1 つの CloudFront ディストリビューション** で、**静的サイト（S3）** と **API（API Gateway）** の両方を配信する想定です。

- **ルート（`/`）** → S3（`prod-journey-photo.com`）の静的サイト
- **`/api/*`** → API Gateway（Lambda）

---

## 1. CloudFront を開く

1. AWS コンソールにログイン
2. 上部の検索バーで **「CloudFront」** と入力 → **CloudFront** を開く
3. **「Distributions」** 一覧から、本番用のディストリビューションをクリック  
   - **Domain name** が `d1s3dwwzgxf5ni.cloudfront.net` のもの（または **Alternate domain names** に `journey-photo.com` があるもの）

---

## 2. 「Origins」タブでオリジンを確認・設定

**場所**: ディストリビューション詳細画面の上部タブ **「Origins」**

### 確認したいこと

- **静的サイト用の Origin が 1 つある**
  - **Origin domain**: `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com`  
    （S3 バケット `prod-journey-photo.com` のバケットエンドポイント）
  - **Origin access**: **Origin access control (OAC)** で、例: `journey-photo-com-oac` を選択
  - **Protocol**: デフォルトのままでOK（HTTPS または Match viewer）

- **API 用の Origin が 1 つある**（既に API 用で作ってある場合）
  - **Origin domain**: API Gateway の URL（例: `xxxx.execute-api.ap-northeast-1.amazonaws.com`）

### 修正する場合

1. **「Create origin」** で新規追加、または既存の Origin の行を選択して **「Edit」**
2. **Origin domain** のプルダウンから **`prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com`** を選択（一覧に出ていれば。なければ手入力）
3. **Origin access** で **Origin access control settings (recommended)** を選び、作成済みの OAC（例: `journey-photo-com-oac`）を選択
4. **「Save changes」**

※ S3 バケット `prod-journey-photo.com` の **バケットポリシー** に、この OAC 用の `cloudfront.amazonaws.com` 許可が入っている必要があります（別ドキュメントの手順どおり）。

---

### オリジン作成／編集フォームの項目別設定（細かい設定）

S3 オリジン（`prod-journey-photo.com`）を作成・編集するときの、各項目の推奨値です。

| 項目 | 設定値 | 補足 |
|------|--------|------|
| **Origin domain** | `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com` | プルダウンにあれば選択。なければ手入力。 |
| **Origin path** | （空欄） | そのまま。何も入力しない。 |
| **名前** | `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com` または `S3-prod-journey-photo-com` | 識別用。分かりやすい名前でよい。 |
| **オリジンアクセス** | **Origin access control settings (recommended)** | 「Public」ではなく **OAC** を選ぶ。 |
| **Origin access control**（OAC を選んだあと） | 作成済みの OAC（例: `journey-photo-com-oac`） | ドロップダウンから選択。 |
| **カスタムヘッダーを追加** | 追加しない | そのままでよい。 |
| **Enable Origin Shield** | **いいえ** | 小規模なら不要。コスト増になる。 |
| **Connection attempts** | **3** | デフォルトのままでよい。 |
| **Connection timeout** | **10** | デフォルトのままでよい。 |
| **Response timeout** | **30** | デフォルトのままでよい。 |
| **Response completion timeout** | **Enable のまま**（またはデフォルト） | そのままでよい。 |

**まとめ（必須だけ）:**

- **Origin domain**: `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com`
- **Origin path**: 空欄
- **名前**: 分かりやすい名前（例: `S3-prod-journey-photo-com`）
- **オリジンアクセス**: **Origin access control settings (recommended)** → OAC を選択

それ以外はデフォルトのままで問題ありません。

---

## 3. 「Behaviors」タブでパスごとの配信先を設定

**場所**: 上部タブ **「Behaviors」**

### 想定する構成

| Path pattern | 用途           | Origin（配信元）        |
|--------------|----------------|-------------------------|
| `/api/*`     | API            | API Gateway の Origin   |
| `*` (Default)| 静的サイト全体 | S3（prod-journey-photo.com） |

**重要**: `/api/*` より **Default (`*`)** のほうが「より広い」ので、**順序** が大事です。  
一覧で **`/api/*` が `*` より上（優先度が高い）** になっている必要があります。

### Default（`*`）の設定

1. Path pattern が **`*`** の行をクリック → **「Edit」**
2. 次を設定する：
   - **Origin and origin groups**: **S3（prod-journey-photo.com）の Origin** を選択
   - **Viewer protocol policy**: **Redirect HTTP to HTTPS**
   - **Allowed HTTP methods**: **GET, HEAD, OPTIONS**（または **GET, HEAD**）
   - **Cache policy**: **CachingOptimized** など（デフォルトのままで可）
   - **Compress objects automatically**: **Yes**
3. **「Save changes」**

---

### ビヘイビア作成／編集フォームの項目別設定（細かい設定）

静的サイト用の **Default (`*`)** ビヘイビアを作成・編集するときの、各項目の推奨値です。

| 項目 | 設定値 | 補足 |
|------|--------|------|
| **パスパターン** | `*` | すべてのパス。空白にできないので必ず `*` を入力。 |
| **オリジンとオリジングループ** | `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com`（S3 のオリジン） | ドロップダウンから本番用 S3 オリジンを選択。 |
| **オブジェクトを自動的に圧縮** | **Yes** | HTML/CSS/JS の圧縮を有効にする。 |
| **ビューワープロトコルポリシー** | **Redirect HTTP to HTTPS** | HTTP アクセスを HTTPS にリダイレクト。 |
| **許可された HTTP メソッド** | **GET, HEAD** または **GET, HEAD, OPTIONS** | 静的サイトなら GET, HEAD で十分。 |
| **ビューワーのアクセスを制限する** | **No** | 公開サイトのため制限しない。 |
| **キャッシュポリシー** | **CachingOptimized**（S3 推奨） | そのままでよい。 |
| **オリジンリクエストポリシー** | （選択なし）または **CachingOptimized に含まれるもの** | オプション。空欄でよい。 |
| **レスポンスヘッダーポリシー** | （選択なし） | オプション。空欄でよい。 |
| **関数の関連付け** | すべて **関連付けなし** | そのままでよい。 |

**まとめ（必須・推奨）:**

- **パスパターン**: `*`
- **オリジンとオリジングループ**: `prod-journey-photo.com` の S3 オリジン
- **オブジェクトを自動的に圧縮**: **Yes**
- **ビューワープロトコルポリシー**: **Redirect HTTP to HTTPS**
- **許可された HTTP メソッド**: **GET, HEAD**
- **ビューワーのアクセスを制限する**: **No**
- **キャッシュポリシー**: **CachingOptimized**

それ以外はデフォルトのままで問題ありません。最後に **「Create behavior」** または **「Save changes」** をクリックして保存してください。

### `/api/*` の設定（API 用の Behavior がある場合）

1. Path pattern が **`/api/*`** の行をクリック → **「Edit」**
2. **Origin and origin groups**: **API Gateway の Origin** を選択
3. **「Save changes」**

※ `/api/*` の Behavior がまだなければ **「Create behavior」** で追加。Path pattern: `api/*`、Origin: API Gateway。

---

## 4. 「General」タブでルートオブジェクトとドメインを設定

**場所**: 上部タブ **「General」** → 右側 **「Edit」** ボタン

### 必ず設定するもの

- **Default root object**  
  - **`index.html`** と入力  
  - これがないと `https://ドメイン/` で `index.html` が返らず、何も表示されないことがあります。

### カスタムドメイン（journey-photo.com）を使う場合

- **Alternate domain names (CNAMEs)**  
  - **`journey-photo.com`** を追加（複数ある場合は 1 行に 1 つ）
- **Custom SSL certificate**  
  - **us-east-1** で発行した ACM 証明書（`journey-photo.com` を含むもの）を選択  
  - CloudFront 用の証明書は **バージニア北部 (us-east-1)** で作成する必要があります。

編集したら **「Save changes」**。

---

## 5. 設定変更の反映

- 変更後、ステータスが **「Deployed」** になるまで **数分～15 分** かかることがあります。
- すぐ確認したい場合は **キャッシュ無効化** を実行：
  ```bash
  aws cloudfront create-invalidation --distribution-id <あなたのディストリビューションID> --paths "/*"
  ```
- ブラウザは **シークレットウィンドウ** または **Ctrl+F5** で再読み込みして確認。

---

## 6. クイックチェックリスト（この順でやればOK・細かい説明不要）

下の表の **「やること」** を上から順にやって、**「入れる値」** のとおりにすれば本番サイトが表示される状態になります。用語の意味が分からなくても、値だけ合わせれば大丈夫です。

### Origins タブ

| # | やること | 入れる値 / 選ぶもの |
|---|----------|---------------------|
| 1 | **Create origin** または既存 Origin の **Edit** を開く | — |
| 2 | **Origin domain** | `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com`（プルダウン or 手入力） |
| 3 | **Origin path** | 何も入れない（空欄） |
| 4 | **名前** | `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com` または `S3-prod-journey-photo-com` |
| 5 | **オリジンアクセス** | **Origin access control settings (recommended)** を選ぶ |
| 6 | **Origin access control**（OAC） | `prod-journey-photo-com-oac`（または作成した OAC 名） |
| 7 | その他 | 触らなくてOK（デフォルトのまま） |
| 8 | **Save changes** をクリック | — |

### Behaviors タブ（Default `*` のビヘイビア）

| # | やること | 入れる値 / 選ぶもの |
|---|----------|---------------------|
| 1 | 既存の **Path pattern `*`** の行を **Edit**、または **Create behavior** | — |
| 2 | **パスパターン** | `*`（半角アスタリスク 1 つ） |
| 3 | **オリジンとオリジングループ** | `prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com` |
| 4 | **オブジェクトを自動的に圧縮** | **Yes** |
| 5 | **ビューワープロトコルポリシー** | **Redirect HTTP to HTTPS** |
| 6 | **許可された HTTP メソッド** | **GET, HEAD** または **GET, HEAD, OPTIONS** |
| 7 | **ビューワーのアクセスを制限する** | **No** |
| 8 | **キャッシュポリシー** | **CachingOptimized**（Recommended for S3） |
| 9 | **オリジンリクエストポリシー** | 選ばなくてOK（空欄） |
| 10 | **レスポンスヘッダーポリシー** | 選ばなくてOK（空欄） |
| 11 | **関数の関連付け** | 全部「関連付けなし」のまま |
| 12 | **Create behavior** または **Save changes** をクリック | — |

### General タブ

| # | やること | 入れる値 / 選ぶもの |
|---|----------|---------------------|
| 1 | **General** タブ → 右の **Edit** をクリック | — |
| 2 | **Default root object** | `index.html`（必ず入力） |
| 3 | カスタムドメイン（journey-photo.com）を使う場合のみ: **Alternate domain names** | `journey-photo.com` を追加 |
| 4 | カスタムドメインを使う場合のみ: **Custom SSL certificate** | us-east-1 の証明書を選択 |
| 5 | **Save changes** をクリック | — |

### 最後の確認

| # | やること |
|---|----------|
| 1 | 数分待ってからブラウザで `https://d1s3dwwzgxf5ni.cloudfront.net/` または `https://journey-photo.com/` を開く |
| 2 | 表示がおかしければ **シークレットウィンドウ** または **Ctrl+F5** で再読み込み |

---

## 7. 関連ドキュメント

- [本番デプロイ](./DEPLOY.md)
- [本番環境のセットアップガイド](./PRODUCTION_SETUP.md)
