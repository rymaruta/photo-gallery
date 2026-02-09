# Photo Gallery ドキュメント一覧

このフォルダは、セットアップ・デプロイ・トラブルシューティング・設計の参照用です。**まずは [QUICK_START.md](./QUICK_START.md)** から始めてください。

---

## 入門・セットアップ

| ドキュメント | 内容 |
|--------------|------|
| **[QUICK_START.md](./QUICK_START.md)** | 5分で始める・最小限の手順 |
| **[SETUP.md](./SETUP.md)** | 初めてのセットアップ（AWS Cognito・S3・Secrets Manager・環境変数） |
| **[ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)** | 環境変数一覧・開発/本番の設定の整理・Secrets Manager の確認方法 |

---

## デプロイ・本番環境

| ドキュメント | 内容 |
|--------------|------|
| **[DEPLOY.md](./DEPLOY.md)** | 本番デプロイ手順（開発・本番）、変更の本番反映・スマホでのデプロイ・セキュリティヘッダー、本番URL・CloudFront・Route 53・トラブル対処・CloudFront 設定ガイド |
| **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** | 本番環境の初回構築（詳細手順） |
| **[API.md](./API.md)** | API エンドポイント一覧・認証・Lambda の dev/prod デプロイ・**静的エクスポートと API の扱い** |
| **[BUCKETS.md](./BUCKETS.md)** | S3 バケットの使い分け（サイト用・画像用）・マイグレーション（オリジナル保管＋表示用リサイズ）の流れ |

---

## トラブルシューティング・参考

| ドキュメント | 内容 |
|--------------|------|
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | アップロードエラー・Lambda 側の確認・診断手順・よくあるエラー・**ギャラリーで灰色ボックスになる場合** |
| **[INVESTIGATE.md](./INVESTIGATE.md)** | 調査系スクリプト（本番の写真表示・API・画像疎通をまとめて確認する手順、`npm run investigate`） |
| **[UPLOAD_SETUP.md](./UPLOAD_SETUP.md)** | アップロード機能の詳細（S3・Presigned URL・CloudFront オプション） |
| **[LOCAL_ENVIRONMENT_OPTIONS.md](./LOCAL_ENVIRONMENT_OPTIONS.md)** | ローカルと本番の構成を揃える方針・LocalStack・Serverless Offline |
| **[NOTES.md](./NOTES.md)** | 開発メモ（rewrites 警告・eslint-disable 一覧・Markdown プレビューが黒くなる件） |

---

## 設計・SEO・改善

| ドキュメント | 内容 |
|--------------|------|
| **[DESIGN.md](./DESIGN.md)** | 設計図（全体構成・データフロー・API・AWS リソース・デプロイ・認証・**構成の見直し案**・**フォルダ構成**・ブログ追加時の参照） |
| **[design-diagram.html](./design-diagram.html)** | 視覚的な構成図（ブラウザで開くと Mermaid で描いた図が表示される） |
| **[SEO.md](./SEO.md)** | SEO 対策・メタタグ・構造化データ・リソースヒント |
| **[IMPROVEMENTS.md](./IMPROVEMENTS.md)** | 改善バックログ・おすすめ提案（技術的負債・テスト・運用・UX の候補一覧） |

---

## ドキュメントの探し方

- **写真の閲覧だけしたい** → [QUICK_START.md](./QUICK_START.md) で `npm run dev` まで
- **アップロード機能を使いたい** → [SETUP.md](./SETUP.md)
- **本番にデプロイしたい** → [DEPLOY.md](./DEPLOY.md) → 初回なら [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)
- **本番で表示されない・NXDOMAIN** → [DEPLOY.md](./DEPLOY.md) のトラブルシューティング
- **アップロード・Lambda でエラー** → [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **S3 バケット・マイグレーション** → [BUCKETS.md](./BUCKETS.md)
- **設計・構成を理解したい** → [DESIGN.md](./DESIGN.md) と [design-diagram.html](./design-diagram.html)
- **開発時のメモ（rewrites 警告・eslint 等）** → [NOTES.md](./NOTES.md)
