# 写真データ（1 本化: dev-photos.json のみ編集）

写真一覧は **1 本のソース** で管理します。

| ファイル | 役割 |
|----------|------|
| **dev-photos.json** | **唯一の編集対象**。開発時 API（serverless-offline）とビルド前の変換元。 |
| **prod-photos.json** | **生成物**。`npm run convert:photos:prod` で dev-photos.json から自動生成。手で編集しない・Git にコミットしない（.gitignore 済み）。 |

## 開発時

- 編集・追加するのは **`dev-photos.json`** だけ。
- `npm run dev:api`（serverless-offline）は `dev-photos.json` を読み書きします。

## ビルド・本番反映

- **ビルド**（`npm run build`）の前に、スクリプトが自動で `convert:photos:prod` を実行し、`prod-photos.json` を生成します。手動で convert を忘れる心配はありません。
- **本番 S3 へのアップロード**  
  ```bash
  npm run upload:photos:prod
  ```
  → ローカルの `prod-photos.json` を本番バケットの `app/data/photos.json` としてアップロードします。  
  （無い場合は `dev-photos.json` を変換してからアップロードするフォールバックあり。）

## 補足

- S3 上ではキーは **`app/data/photos.json`** のままです（Lambda がこのパスを参照します）。
- 本番の画像も、本番用バケット（または CloudFront）の `/uploads/` に置いてください。

## 既存の photos.json から移行する場合

以前 `photos.json` を使っていた場合は、次のようにリネームしてください。

```bash
mv app/data/photos.json app/data/dev-photos.json
```
