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

**バグ修正のリズム（2026-08-20 の反省から）**

まとめて直すほど回帰が増える。実測:

| コミット | 直した数 | あとで見つかった回帰 |
|---|---|---|
| 20件を1コミット | 20 | 7 |
| 10件を1コミット | 10 | 4 |
| 16件を1コミット | 16 | 6（**37%**） |

しかも「大きく直す → あとでまとめてレビュー」を繰り返したので、
回帰の発見が1〜2コミット遅れ、その間にさらに積み上げていた。

だから:

- **1コミットは5〜8件まで。** それ以上は分ける。
- **直したら、次に進む前にその差分のレビューを1本かける。**
  「あとでまとめて」にしない。レビューを待つ間に別の修正を積まない。
- レビューには**「直前のコミットも回帰を出している。この差分にもあると
  思って読め」**と伝える。実際そのつもりで読ませた方が見つかる。
- 指摘は鵜呑みにしない。**必ず自分でコードを読んで再現の筋を確かめる**。
  実際、ファズ試験の前提が誤っていた・`new URL` の挙動を読み違えていた、
  という誤報が混ざっていた。
- **テストは「修正前の状態で落ちること」を毎回確かめる。**
  `git show <commit>^:<path> > <path>` で差し戻して実行し、戻す。
  この手順を省いた回で、キーの綴り違いで**何も検証していないテスト**を
  書いていた（実装を消しても通る状態だった）。

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
  - **オフラインは「一度見たページが開く」ところまで**（2026-08-27）。
    以前は何もキャッシュしないどころか起動のたびに Cache Storage を全消しし、
    機内モードでブラウザのエラー画面になっていた。今の `public/sw.js` は:
    - ページ（ナビゲーション）は**必ずネットワーク優先**。落ちたときだけ
      「同じURLの控え → トップページ」の順で出す
    - `_next/static/**`（中身がハッシュ名）だけキャッシュ優先
    - それ以外（API・画像CDN・別オリジン）には**手を出さない**
    - `activate` で消すのは自分の旧バージョンだけ
    **画像はまだキャッシュしていない**ので、機内モードでは枠だけが出る。
    上限管理（追い出し）が要るため別枠。ここが次の一歩。
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

## AWS ステージングリソース一覧

2026-08-20 に `provision-env.yml` で作成。本番と同じ構成で、接頭辞だけが違う。

| リソース | 名前 / ID |
|---|---|
| 静的サイト S3 バケット | `staging-journey-photo.com` |
| 画像アップロード S3 バケット | `staging-journey-photo-upload` |
| CloudFront ディストリビューション ID | `EF2TFEBBP24DL` |
| CloudFront ドメイン | `d15fn3rcaiymu9.cloudfront.net` |
| カスタムドメイン | なし（既定ドメインのみ・`robots.txt` で全拒否） |
| Cognito User Pool ID | `ap-northeast-1_DSQ16c6vO` |
| Cognito Client ID | `1qjl9c8gmqidigps55jhv4foi` |
| API Gateway (管理API) | `https://rfq22dzchf.execute-api.ap-northeast-1.amazonaws.com` |
| API Gateway (ユーザーAPI) | `https://y9f8ajacc2.execute-api.ap-northeast-1.amazonaws.com` |
| Cognito プール名 | `staging-journey-photo-client-spa` |
| DynamoDB テーブル | `staging-photo-gallery-photos` / `staging-photo-gallery-users`（オンデマンド） |

- **本番の写真はコピーしていない**。空から始める（GPS 入りの写真を複製しないため）。
- ユーザーも空。staging で使うには新規登録が必要。
- CloudFront には**本番の API Gateway オリジンを引き継いでいない**
  （コピーすると staging の `/api/*` が本番APIに届くため）。
- 環境を増やすときは `provision-env.yml` を `envName` 指定で実行する（冪等）。

## デプロイ手順

### 静的サイト（フロントエンド）

```bash
# ビルド（DynamoDB から写真データを自動同期）
npm run build

# S3 + CloudFront にデプロイ（正しいバケット名は prod-journey-photo.com）
# SITE_URL が無いと配信チェックと 5xx 時の再インバリデーションが飛ぶ（デプロイ自体は完了）
CLOUDFRONT_DISTRIBUTION_ID=EYRLTGCPOS9E4 SITE_URL=https://journey-photo.com npm run web:deploy:prod
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
- **定期ビルド（cron）は現在停止中**。Actions の枠が逼迫したため
  （2026-08 に 1,804/2,000 分を消費）。写真を追加したら Actions から
  `Deploy Site` を手動実行する。枠がリセットされたら戻すか判断する。
- **staging のフロント反映も手動実行**（1回8分と重いため）。
  `develop` への push で自動なのは API だけ。

## 注意事項

- **本番値のフォールバックは置かない**。テーブル名・バケット名・Cognito・
  ディストリビューションIDは全て環境変数で渡し、未設定なら止める
  （`api/src/env.ts`・`api-user/src/env.ts`・`scripts/lib/env.js` の `requireEnv`）。
  設定ミスは「本番を触る」ではなく「動かない」に倒す。
- `app/api/` は開発専用。ビルド時に自動退避される（`scripts/prepare-static-build.js`）
- `app/data/photos.json` はビルド時に DynamoDB から自動生成される（コミット不要）
- Cognito パラメータは `.env.local` に記載（git 管理外）
