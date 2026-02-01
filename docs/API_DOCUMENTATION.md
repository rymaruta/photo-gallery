# API実装ドキュメント

このドキュメントでは、PhotoGalleryアプリケーションのAPI実装について説明します。

## 目次

1. [概要](#概要)
2. [APIエンドポイント一覧](#apiエンドポイント一覧)
3. [認証](#認証)
4. [データ管理](#データ管理)
5. [各エンドポイントの詳細](#各エンドポイントの詳細)
6. [エラーハンドリング](#エラーハンドリング)
7. [キャッシュ戦略](#キャッシュ戦略)

---

## 概要

PhotoGalleryアプリケーションは、Next.jsのAPI Routesを使用してRESTful APIを提供しています。主な機能は以下の通りです：

- 写真の一覧取得・個別取得
- 写真の編集・削除
- 写真のアップロード（S3への直接アップロード）
- ベース写真とアップロード写真の統合管理

### アーキテクチャ

- **ベース写真**: `app/data/photos.ts`に定義された初期写真データ
- **アップロード写真**: `app/data/photos.json`に保存されるユーザーアップロード写真
- **編集済みベース写真**: `photos.json`に保存される、ベース写真の編集内容

APIは、ベース写真とアップロード写真を統合して返し、編集済みのベース写真は`photos.json`の内容で上書きされます。

---

## APIエンドポイント一覧

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/api/photos` | 写真一覧を取得 | 不要 |
| GET | `/api/photos/[id]` | 特定の写真を取得 | 不要 |
| PUT | `/api/photos/[id]` | 写真を更新 | 必要 |
| DELETE | `/api/photos/[id]` | 写真を削除 | 必要 |
| POST | `/api/upload/presigned-url` | S3アップロード用のPresigned URLを生成 | 必要 |
| POST | `/api/upload/save` | アップロードされた写真のメタデータを保存 | 必要 |

---

## 認証

編集・削除・アップロード関連のエンドポイントは、APIキーによる認証が必要です。

### 認証方法

リクエストヘッダーに`x-api-key`を設定します：

```http
x-api-key: YOUR_API_KEY
```

### APIキーの取得

- **サーバー側**: AWS Secrets Managerまたは環境変数`UPLOAD_API_KEY`から取得
- **クライアント側**: 環境変数`NEXT_PUBLIC_UPLOAD_API_KEY`を使用

### 認証エラー

認証に失敗した場合、以下のレスポンスが返されます：

```json
{
  "error": "認証に失敗しました"
}
```

ステータスコード: `401 Unauthorized`

---

## データ管理

### データソース

1. **BASE_PHOTOS** (`app/data/photos.ts`)
   - アプリケーションに組み込まれた初期写真データ
   - TypeScriptファイルとして定義
   - 編集可能（編集内容は`photos.json`に保存）

2. **photos.json** (`app/data/photos.json`)
   - ユーザーがアップロードした写真
   - 編集されたベース写真
   - JSON形式で保存

### データ統合ロジック

APIは以下の順序でデータを統合します：

1. `BASE_PHOTOS`をベースとして読み込む
2. `photos.json`が存在する場合：
   - 編集済みベース写真（`BASE_PHOTOS`に存在するID）を上書き
   - 新しい写真（`BASE_PHOTOS`に存在しないID）を追加

### データ保存

- **編集**: 編集された写真は`photos.json`に保存されます
- **削除**: `photos.json`から該当する写真を削除します（ベース写真も削除可能）
- **アップロード**: 新しい写真を`photos.json`に追加します

---

## 各エンドポイントの詳細

### 1. GET `/api/photos`

写真一覧を取得します。

#### リクエスト

```http
GET /api/photos
```

認証: 不要

#### レスポンス

**成功時 (200 OK)**

```json
[
  {
    "id": "photo-1",
    "src": "https://example.com/image.jpg",
    "title": {
      "ja": "タイトル",
      "en": "Title"
    },
    "description": {
      "ja": ["説明1", "説明2"],
      "en": ["Description 1", "Description 2"]
    },
    "location": "Tokyo, Japan",
    "category": "landscape",
    "tags": ["tag1", "tag2"],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**エラー時 (500 Internal Server Error)**

```json
{
  "error": "写真の取得に失敗しました"
}
```

#### キャッシュ

- `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
- 60秒間キャッシュ、300秒間は古いキャッシュを返す

---

### 2. GET `/api/photos/[id]`

特定の写真を取得します。

#### リクエスト

```http
GET /api/photos/photo-1
```

認証: 不要

#### レスポンス

**成功時 (200 OK)**

```json
{
  "id": "photo-1",
  "src": "https://example.com/image.jpg",
  "title": {
    "ja": "タイトル",
    "en": "Title"
  },
  "description": {
    "ja": ["説明1"],
    "en": ["Description 1"]
  },
  "location": "Tokyo, Japan",
  "category": "landscape",
  "tags": ["tag1", "tag2"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**エラー時**

- `404 Not Found`: 写真が見つからない場合
- `500 Internal Server Error`: サーバーエラー

```json
{
  "error": "写真が見つかりません"
}
```

#### キャッシュ

- `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`

---

### 3. PUT `/api/photos/[id]`

写真のメタデータを更新します。

#### リクエスト

```http
PUT /api/photos/photo-1
Content-Type: application/json
x-api-key: YOUR_API_KEY
```

**リクエストボディ**

```json
{
  "title": {
    "ja": "新しいタイトル",
    "en": "New Title"
  },
  "description": {
    "ja": ["新しい説明1", "新しい説明2"],
    "en": ["New Description 1", "New Description 2"]
  },
  "location": "Osaka, Japan",
  "category": "portrait",
  "tags": ["tag3", "tag4"],
  "coords": {
    "lat": 35.6762,
    "lng": 139.6503
  },
  "mapLinks": {
    "google": "https://maps.app.goo.gl/...",
    "osm": "https://www.openstreetmap.org/..."
  }
}
```

認証: 必要

#### レスポンス

**成功時 (200 OK)**

```json
{
  "success": true,
  "photo": {
    "id": "photo-1",
    "src": "https://example.com/image.jpg",
    "title": {
      "ja": "新しいタイトル",
      "en": "New Title"
    },
    "updatedAt": "2024-01-02T00:00:00.000Z"
  }
}
```

**エラー時**

- `401 Unauthorized`: 認証失敗
- `404 Not Found`: 写真が見つからない
- `500 Internal Server Error`: サーバーエラー

#### 実装詳細

- ベース写真も編集可能
- 編集内容は`photos.json`に保存される
- `updatedAt`フィールドが自動的に更新される
- キャッシュが自動的にクリアされる

---

### 4. DELETE `/api/photos/[id]`

写真を削除します。

#### リクエスト

```http
DELETE /api/photos/photo-1
x-api-key: YOUR_API_KEY
```

認証: 必要

#### レスポンス

**成功時 (200 OK)**

```json
{
  "success": true
}
```

**エラー時**

- `401 Unauthorized`: 認証失敗
- `404 Not Found`: 写真が見つからない
- `500 Internal Server Error`: サーバーエラー

#### 実装詳細

- ベース写真も削除可能（`photos.json`から削除）
- S3に保存されている画像も削除される（URLが`http`で始まる場合）
- キャッシュが自動的にクリアされる

---

### 5. POST `/api/upload/presigned-url`

S3への直接アップロード用のPresigned URLを生成します。

#### リクエスト

```http
POST /api/upload/presigned-url
Content-Type: application/json
x-api-key: YOUR_API_KEY
```

**リクエストボディ**

```json
{
  "fileName": "photo.jpg",
  "fileType": "image/jpeg",
  "fileSize": 1024000
}
```

認証: 必要

#### バリデーション

- `fileName`: 必須
- `fileType`: 必須、`image/`で始まる必要がある
- `fileSize`: 最大10MB

#### レスポンス

**成功時 (200 OK)**

```json
{
  "presignedUrl": "https://s3.amazonaws.com/bucket/uploads/uuid.jpg?X-Amz-Algorithm=...",
  "key": "uploads/uuid.jpg",
  "publicUrl": "https://cloudfront.example.com/uploads/uuid.jpg"
}
```

**エラー時**

- `400 Bad Request`: バリデーションエラー
- `401 Unauthorized`: 認証失敗
- `500 Internal Server Error`: サーバーエラー

```json
{
  "error": "ファイル名とファイルタイプが必要です"
}
```

#### 実装詳細

- Presigned URLは15分間有効
- ファイル名はUUIDでランダム化される（セキュリティ向上）
- CloudFront URLが設定されている場合はそれを使用
- IAMロールまたはアクセスキーでS3にアクセス

---

### 6. POST `/api/upload/save`

アップロードされた写真のメタデータを保存します。

#### リクエスト

```http
POST /api/upload/save
Content-Type: application/json
x-api-key: YOUR_API_KEY
```

**リクエストボディ**

```json
{
  "key": "uploads/uuid.jpg",
  "publicUrl": "https://cloudfront.example.com/uploads/uuid.jpg",
  "title": {
    "ja": "タイトル",
    "en": "Title"
  },
  "description": {
    "ja": ["説明1", "説明2"],
    "en": ["Description 1", "Description 2"]
  },
  "location": "Tokyo, Japan",
  "category": "landscape",
  "tags": ["tag1", "tag2"]
}
```

認証: 必要

#### バリデーション

- `key`: 必須
- `publicUrl`: 必須

#### レスポンス

**成功時 (200 OK)**

```json
{
  "success": true,
  "photo": {
    "id": "generated-uuid",
    "src": "https://cloudfront.example.com/uploads/uuid.jpg",
    "title": {
      "ja": "タイトル",
      "en": "Title"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**エラー時**

- `400 Bad Request`: バリデーションエラー
- `401 Unauthorized`: 認証失敗
- `500 Internal Server Error`: サーバーエラー

#### 実装詳細

- 新しい写真IDが自動生成される（UUID）
- `photos.json`に追加される
- `createdAt`と`updatedAt`が自動設定される

---

## エラーハンドリング

### エラーレスポンス形式

すべてのエラーレスポンスは以下の形式です：

```json
{
  "error": "エラーメッセージ"
}
```

### ステータスコード

| ステータスコード | 説明 |
|----------------|------|
| 200 | 成功 |
| 400 | バリデーションエラー（リクエストが不正） |
| 401 | 認証失敗 |
| 404 | リソースが見つからない |
| 500 | サーバーエラー |

### エラーログ

サーバー側のエラーは`console.error`でログに記録されます：

```typescript
console.error("写真取得エラー:", error);
```

---

## キャッシュ戦略

### サーバー側キャッシュ

#### 写真データのキャッシュ

`/api/photos/[id]`の`loadPhotos()`関数では、30秒間のメモリキャッシュを使用：

```typescript
const PHOTOS_CACHE_TTL = 30 * 1000; // 30秒
```

- キャッシュは編集・削除時に自動的にクリアされる
- 複数のリクエストで同じデータを返すことで、パフォーマンスを向上

#### HTTPキャッシュ

- `GET /api/photos`: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
- `GET /api/photos/[id]`: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`

### クライアント側キャッシュ

管理画面では、常に最新のデータを取得するため`cache: "no-store"`を使用：

```typescript
const response = await fetch("/api/photos", { cache: "no-store" });
```

---

## 実装の詳細

### ファイル構造

```
app/api/
├── photos/
│   ├── route.ts              # GET /api/photos
│   └── [id]/
│       └── route.ts          # GET, PUT, DELETE /api/photos/[id]
└── upload/
    ├── presigned-url/
    │   └── route.ts          # POST /api/upload/presigned-url
    └── save/
        └── route.ts          # POST /api/upload/save
```

### 依存関係

- **AWS SDK**: S3操作、Presigned URL生成
- **Next.js**: API Routes、ファイルシステム操作
- **UUID**: 一意のID生成

### 設定管理

すべての設定は`lib/aws/secrets.ts`の`getConfig()`関数から取得：

- AWS Secrets Manager（推奨）
- 環境変数（フォールバック）

### セキュリティ

1. **APIキー認証**: 編集・削除・アップロード操作には認証が必要
2. **ファイル名のランダム化**: UUIDを使用してファイル名をランダム化
3. **ファイルタイプ検証**: 画像ファイルのみ許可
4. **ファイルサイズ制限**: 最大10MB

---

## トラブルシューティング

### よくある問題

#### 1. 認証エラー

**症状**: `401 Unauthorized`エラー

**原因**:
- APIキーが正しく設定されていない
- `x-api-key`ヘッダーが送信されていない

**解決方法**:
- 環境変数`NEXT_PUBLIC_UPLOAD_API_KEY`が正しく設定されているか確認
- Secrets Managerまたは環境変数`UPLOAD_API_KEY`が正しく設定されているか確認

#### 2. 写真が表示されない

**症状**: 写真一覧が空、または特定の写真が表示されない

**原因**:
- `photos.json`が存在しない、または破損している
- キャッシュが古い

**解決方法**:
- `app/data/photos.json`の存在と形式を確認
- サーバーを再起動してキャッシュをクリア

#### 3. S3アップロードエラー

**症状**: Presigned URLの生成に失敗

**原因**:
- AWS認証情報が正しく設定されていない
- S3バケットの権限が不足している

**解決方法**:
- AWS Secrets Managerまたは環境変数の設定を確認
- IAMロール/ユーザーの権限を確認

---

## 今後の改善点

1. **ページネーション**: 大量の写真に対応するため、ページネーション機能を追加
2. **バッチ操作**: 複数の写真を一度に編集・削除できる機能
3. **検索機能**: タイトル、説明、タグでの検索API
4. **画像最適化**: アップロード時に自動的に画像を最適化
5. **バージョン管理**: 編集履歴の保存と復元機能

---

## 参考資料

- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/)
- [S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
