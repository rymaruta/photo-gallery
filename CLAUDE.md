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
- **いつか App Store に出したい**（時期未定）。ただし今の主戦場は検索流入なので、
  優先度は「SEO・表示速度・安定性 > アプリ化」。
  - **インストールはできる**（`manifest.webmanifest` が `display: standalone`、
    `ServiceWorkerRegister.tsx` が `/sw.js` を登録）。ホーム画面に追加すれば全画面で動く。
  - **ただしオフラインは0点**。`public/sw.js` は何もキャッシュしないどころか、
    起動のたびに Cache Storage を全消しする。機内モードで開くとブラウザの
    エラー画面になる。「PWA として成立している」とは言えない状態。
  - 出すときは Capacitor で包む想定。審査で効くのはガイドライン 4.2
    （Webサイトを包んだだけは通らない）なので、ネイティブのカメラ・プッシュ通知・
    オフラインのどれかが要る。5.1.1(v) のアプリ内アカウント削除は
    `DeleteAccountModal` で既に満たしている。
  - つまり **PWA の完成度を上げる作業がそのままアプリ化の準備になる**。
    オフライン動作・Service Worker の更新・カメラ・共有まわりの不具合は
    「Webの改善」ではなく「アプリ化の前提」として扱ってよい。

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

### API（Lambda）

**基本は GitHub Actions（`deploy-api.yml`）に任せる。** ブランチから環境を決めて
必要なパラメータを全部渡す。手で叩くとパラメータの渡し忘れが起きる
（以前はテーブル名がリテラルの本番値で、`--stage` を変えても本番を読み書きしていた）。

どうしても手元から流す場合は、**全パラメータが必須**:

```bash
cd api && npx serverless@3 deploy --stage prod \
  --param="photosTable=prod-photo-gallery-photos" \
  --param="usersTable=prod-photo-gallery-users" \
  --param="uploadBucket=prod-journey-photo-upload" \
  --param="cloudfrontUrl=https://d1s3dwwzgxf5ni.cloudfront.net" \
  --param="cognitoUserPoolId=ap-northeast-1_ZbuhDQsWz" \
  --param="cognitoClientId=21cs4cd8dkttmg3snloj72u8mu" \
  --param="cognitoPoolName=prod-journey-photo-client-spa"
```

> ⚠️ `cognitoPoolName` は `existing: true` の PostConfirmation トリガーが
> **書き換えにいくプール名**。間違えると別環境のプールのトリガーを奪い、
> そちらの新規登録が壊れる。

`api-user` は `cognitoPoolName` 以外の同じパラメータが必要（トリガーを持たないため）。

## 環境とブランチ運用

| 環境 | ブランチ | 反映先 |
|---|---|---|
| 本番 | `main` | `journey-photo.com` |
| ステージング | `develop` | CloudFront の既定ドメイン（検索避けあり） |

```
feature/xxx  →(PR)→  develop  →(自動)→ staging で確認
                        ↓ (PR)
                       main    →(自動)→ 本番
```

- **本番へ直接 push しない。** まず `develop` に入れて staging で確かめる。
- AWS のリソースは全て環境名が接頭辞に付く（`prod-*` / `staging-*`）ので、
  コンソールで並べたときに一目で区別できる。
- ワークフローはブランチから環境を決める（`config` ジョブ）。
  値が1つでも欠けたら**デプロイを失敗させる**。以前は欠けると本番値に
  フォールバックしていて、緑のまま本番を向いてしまっていた。
- 定期ビルド（cron）は本番だけ。

## 注意事項

- **本番値のフォールバックは置かない**。テーブル名・バケット名・Cognito・
  ディストリビューションIDは全て環境変数で渡し、未設定なら止める
  （`api/src/env.ts`・`api-user/src/env.ts`・`scripts/lib/env.js` の `requireEnv`）。
  設定ミスは「本番を触る」ではなく「動かない」に倒す。
- `app/api/` は開発専用。ビルド時に自動退避される（`scripts/prepare-static-build.js`）
- `app/data/photos.json` はビルド時に DynamoDB から自動生成される（コミット不要）
- Cognito パラメータは `.env.local` に記載（git 管理外）
