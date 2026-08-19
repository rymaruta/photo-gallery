# Photo Gallery — Claude 向け運用メモ

## 作業の進め方（Claude への指示）

**言語**: 日本語で答える。専門用語は噛み砕く。

**答え方**
- **推奨を1つ先に言う**。選択肢を並べるだけにしない。理由は後から短く。
- 前置き・お世辞は書かない。結論から。
- 質問は本当に必要な時だけ。**自分で調べて分かることは聞かない**。判断が分かれて手戻りが大きい時だけ聞く。

**正確さ（最重要）**
- **推測で「できています」と言わない**。テスト・ビルド・grep で確かめてから報告する。
- **ユーザーの認識が間違っていたら、遠慮せず訂正する**。
  例: 「年表はEXIFで時系列が保たれる」→ 実際は30枚中25枚がアップロード年に固まっていた、とデータで示す。
- 確認できなかったことは「確認できていない」と書く。できたフリをしない。
- 環境の制約（ネットワーク遮断など）で検証できない時は、その旨と代替の確認方法を伝える。

**実装のとき**
- コードを書く前に**既存の実装を再利用できないか探す**。同じものを二度作らない。
- 影響範囲を調べてから着手する（grep で参照箇所を洗う）。
- 変更後は必ず `npx tsc --noEmit` / `npx eslint` / `npx vitest run` / `npm run build` を通す。
- **デザインは勝手に変えない**。指示がない限り現状維持。
- スコープを勝手に広げない。やらなかったことは「なぜやらなかったか」を明記する。
- 削除作業では、参照の残骸（未使用 import・死にコード・テスト）まで掃除する。

**デプロイ**
- バックエンド（`api-user/**`）を先に反映 → 成功を確認してからフロント。APIが無い状態でUIが動く隙間を作らない。
- 反映後は GitHub Actions の結果を確認してから「完了」と言う。

**このサイトの方向性（暫定）**
- 「見つけてもらえる個人トラベルギャラリー」。**写真が主役**。
- SNS的な競争要素（レベル・称号・ランキング）は増やさない。機能は足すより減らす方向で考える。

## AWS 本番リソース一覧

| リソース | 名前 / ID |
|---|---|
| 静的サイト S3 バケット | `prod-journey-photo.com` |
| 画像アップロード S3 バケット | `prod-journey-photo-upload` |
| CloudFront ディストリビューション ID | `EYRLTGCPOS9E4` |
| CloudFront ドメイン | `d1s3dwwzgxf5ni.cloudfront.net` |
| カスタムドメイン | `journey-photo.com` |
| API Gateway (管理API) | `https://ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com` |
| API Gateway (ユーザーAPI) | `https://gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com` |
| Cognito User Pool ID | `ap-northeast-1_ZbuhDQsWz` |
| Cognito Client ID | `21cs4cd8dkttmg3snloj72u8mu` |
| DynamoDB テーブル | `prod-photo-gallery-photos` |
| AWS リージョン | `ap-northeast-1` |

## デプロイ手順

### 静的サイト（フロントエンド）

```bash
# ビルド（DynamoDB から写真データを自動同期）
npm run build

# S3 + CloudFront にデプロイ（正しいバケット名は prod-journey-photo.com）
CLOUDFRONT_DISTRIBUTION_ID=EYRLTGCPOS9E4 npm run web:deploy:prod
```

> ⚠️ `journey-photo.com` はドメイン名。S3 バケット名は `prod-journey-photo.com`（別物）。

### 管理 API（Lambda）

```bash
cd api && npx serverless@3 deploy --stage prod \
  --param="cognitoUserPoolId=ap-northeast-1_ZbuhDQsWz" \
  --param="cognitoClientId=21cs4cd8dkttmg3snloj72u8mu"
```

### ユーザー API（Lambda）

```bash
cd api-user && npx serverless@3 deploy --stage prod \
  --param="cognitoUserPoolId=ap-northeast-1_ZbuhDQsWz" \
  --param="cognitoClientId=21cs4cd8dkttmg3snloj72u8mu"
```

## ブランチ運用

- 開発ブランチ: `claude/improve-site-stability-u85Vz`
- 本番ブランチ: `main`

## 注意事項

- `app/api/` は開発専用。ビルド時に自動退避される（`scripts/prepare-static-build.js`）
- `app/data/photos.json` はビルド時に DynamoDB から自動生成される（コミット不要）
- Cognito パラメータは `.env.local` に記載（git 管理外）
