# 写真データ（dev-photos.json / prod-photos.json）の開発用・本番用の分け方

写真一覧データは **開発用** と **本番用** でファイルを分けています。

| ファイル | 用途 | 画像 URL（`src`） |
|----------|------|-------------------|
| **dev-photos.json** | **開発環境**（ローカル・Next API・dev Lambda） | 開発用（例: `dev-journey-photo-upload.s3...`） |
| **prod-photos.json** | **本番環境**（本番 S3 にアップロードする用） | 本番用（例: `https://journey-photo.com/uploads/...`） |

## 開発時

- 編集・追加するのは **`dev-photos.json`** だけ。
- ローカルや開発用 API は `dev-photos.json` を参照します。

## 本番反映の手順

1. **本番用 JSON を生成**（`dev-photos.json` の URL を本番用に変換）  
   ```bash
   npm run convert:photos:prod
   ```
   → `app/data/prod-photos.json` が生成されます。

2. **本番 S3 にアップロード**  
   ```bash
   npm run upload:photos:prod
   ```
   → `prod-photos.json` を本番サイト用バケットの `app/data/photos.json` としてアップロードします。  
   （`prod-photos.json` が無い場合は、`dev-photos.json` を変換してからアップロードします。）

## 補足

- S3 上ではキーは **`app/data/photos.json`** のままです（Lambda がこのパスを参照します）。
- `prod-photos.json` は `convert:photos:prod` で上書きされるため、手で編集する必要はありません。
- 本番の画像も、本番用バケット（または CloudFront）の `/uploads/` に置いてください。

## 既存の photos.json から移行する場合

以前 `photos.json` を使っていた場合は、次のようにリネームしてください。

```bash
mv app/data/photos.json app/data/dev-photos.json
```
