# Photo Gallery ドキュメント一覧

このフォルダは、セットアップ・デプロイ・トラブルシューティング・設計の参照用です。**まずは [QUICK_START.md](./QUICK_START.md)** から始めてください。

---

## 入門・セットアップ

| ドキュメント | 内容 |
|--------------|------|
| **[QUICK_START.md](./QUICK_START.md)** | 5分で始める・最小限の手順 |
| **[SETUP.md](./SETUP.md)** | 初めてのセットアップ（AWS Cognito・S3・Secrets Manager・環境変数）。Cognito 詳細は同 doc 内「Cognito 詳細（参考）」 |
| **[ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)** | 環境変数一覧・開発/本番の設定の整理・Secrets Manager の確認方法 |

---

## デプロイ・本番環境

| ドキュメント | 内容 |
|--------------|------|
| **[DEPLOY.md](./DEPLOY.md)** | 本番デプロイ手順（開発・本番）、本番URL・CloudFront・Route 53・トラブル対処・**CloudFront 設定ガイド（画面ごとの操作）** |
| **[PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)** | 本番環境の初回構築（詳細手順） |
| **[API.md](./API.md)** | API エンドポイント一覧・認証・**API（Lambda）の dev/prod デプロイ**・デプロイ用 S3 バケット・開発/本番デプロイ詳細 |

---

## トラブルシューティング・参考

| ドキュメント | 内容 |
|--------------|------|
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | アップロードエラー・Lambda 側の確認・診断手順・よくあるエラーと解決方法 |
| **[UPLOAD_SETUP.md](./UPLOAD_SETUP.md)** | アップロード機能の詳細（S3・Presigned URL・CloudFront オプション） |
| **[LOCAL_ENVIRONMENT_OPTIONS.md](./LOCAL_ENVIRONMENT_OPTIONS.md)** | ローカルと本番の構成を揃える方針（Part 1）・LocalStack・開発用AWS・Serverless Offline（Part 2） |

---

## 設計・SEO

| ドキュメント | 内容 |
|--------------|------|
| **[DESIGN.md](./DESIGN.md)** | 既存設計図（全体構成・データフロー・API・AWS リソース・デプロイ・認証・ブログ追加時の参照） |
| **[design-diagram.html](./design-diagram.html)** | 視覚的な構成図（ブラウザで開くと Mermaid で描いた図が表示される） |
| **[SEO.md](./SEO.md)** | SEO 対策・メタタグ・構造化データ・リソースヒント |

---

## ドキュメントの探し方

- **写真の閲覧だけしたい** → [QUICK_START.md](./QUICK_START.md) で `npm run dev` まで
- **アップロード機能を使いたい** → [SETUP.md](./SETUP.md)
- **本番にデプロイしたい** → [DEPLOY.md](./DEPLOY.md) → 初回なら [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)
- **本番で表示されない・NXDOMAIN** → [DEPLOY.md](./DEPLOY.md) のトラブルシューティング
- **アップロード・Lambda でエラー** → [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **設計・構成を理解したい** → [DESIGN.md](./DESIGN.md) と [design-diagram.html](./design-diagram.html)
