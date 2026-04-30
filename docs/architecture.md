# システムアーキテクチャ

## 全体構成

```
User
 └→ CloudFront (journey-photo.com / d1s3dwwzgxf5ni.cloudfront.net)
     ├→ S3 prod-journey-photo.com          # 静的HTML/JS/CSS
     ├→ API Gateway (Admin API)            # 管理者操作
     │   └→ Lambda photo-gallery-api-prod-api
     ├→ API Gateway (User API)             # 一般ユーザー操作
     │   └→ Lambda photo-gallery-user-api-prod
     └→ S3 prod-journey-photo-upload       # アップロード画像

Cognito ap-northeast-1_ZbuhDQsWz          # 認証
DynamoDB prod-photo-gallery-photos         # 写真メタデータ（移行済み）
S3 prod-journey-photo.com/app/data/photos.json  # 旧データ（バックアップとして保持）
```

## リソース一覧

| リソース | 種別 | 名前/ID | 用途 |
|---------|------|---------|------|
| CloudFront | Distribution | EYRLTGCPOS9E4 | CDN・ルーティング |
| S3 | Bucket | prod-journey-photo.com | 静的サイト配信 |
| S3 | Bucket | prod-journey-photo-upload | 画像アップロード先 |
| API Gateway | HTTP API | ionr4ik01e | 管理者API |
| API Gateway | HTTP API | 9qmc4qb2e4 | 一般ユーザーAPI |
| Lambda | Function | photo-gallery-api-prod-api | 管理者API ハンドラ |
| Lambda | Function | photo-gallery-user-api-prod | 一般ユーザーAPI ハンドラ |
| DynamoDB | Table | prod-photo-gallery-photos | 写真メタデータ |
| Cognito | User Pool | ap-northeast-1_ZbuhDQsWz | 認証 |
| Cognito | App Client | 21cs4cd8dkttmg3snloj72u8mu | フロントエンド認証 |
| Cognito | Group | admin | 管理者グループ |
| Cognito | Group | user | 一般ユーザーグループ |

## 認証・認可

```
ログイン → Cognito JWT発行
JWT payload の cognito:groups で権限判定:
  admin グループ → 管理者API・一般ユーザーAPI 両方使用可
  user グループ  → 一般ユーザーAPIのみ使用可
  グループなし  → 公開APIのみ（写真閲覧）
```

## データフロー

### 写真閲覧（公開）
```
ブラウザ → CloudFront → 静的HTML（BASE_PHOTOS で即時表示）
                      → Admin API GET /api/photos → Lambda → DynamoDB
                                                           → S3 photos.json（フォールバック）
```

### 写真アップロード（管理者）
```
管理者 → Presigned URL取得（Admin API）→ S3直接PUT
      → メタデータ保存（Admin API）→ Lambda → DynamoDB + S3 photos.json
```

### 写真アップロード（一般ユーザー）
```
一般ユーザー → Presigned URL取得（User API）→ S3直接PUT
            → メタデータ保存（User API）→ Lambda → S3 photos.json
```
