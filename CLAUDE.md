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
  - **オフラインは「一度見たページと、一度見た写真が出る」ところまで**
    （ページ 2026-08-27 / 写真 2026-09-08）。
    以前は何もキャッシュしないどころか起動のたびに Cache Storage を全消しし、
    機内モードでブラウザのエラー画面になっていた。今の `public/sw.js` は:
    - ページ（ナビゲーション）は**必ずネットワーク優先**。落ちたときだけ
      「同じURLの控え → トップページ」の順で出す
    - `_next/static/**`（中身がハッシュ名）だけキャッシュ優先
    - **写真（`/uploads/**` の画像要求）は別の入れ物に控える**
      （`journey-photo-img-v1`・80件で古い順に追い出し・容量で断られたら
      半分捨ててやり直す）。件数で切るのは、別オリジンから来る写真の応答が
      opaque＝大きさを読めないため
      - **「写真は必ず別オリジン（opaque）」ではない。** 実測（`app/data/photos.json`
        の30枚）で **19枚が `journey-photo.com`＝同一オリジン**・11枚が
        CloudFront の既定ドメイン。`normalize-image-urls` を流すと前者に寄る
      - 中身が読める回（同一オリジン）は **`content-type` が `image/` で
        あることまで見る**。キャプティブポータル（ホテル・空港の Wi-Fi）は
        画像の要求にも 200 で HTML を返すので、これが無いと**その HTML が
        「写真」として控えられ、キャッシュ優先・寿命なしなので再読込しても
        割れたまま**になる
      - opaque は種別を確かめようが無いので通す。毒を食った場合の出口は
        画面側——画像の読み込みに失敗したら `dropCachedPhoto()`
        （`lib/utils/photoCache.ts`）がその URL の控えを捨てる
    - **アバター・カバー（`profiles/<uid>`）は控えない。** 固定キーで中身が
      差し替わる側で、サーバーもアップロードも `no-store` を付けている。
      控えると変更が永久に届かない
    - それ以外（API・曲のアートワーク・別オリジン）には**手を出さない**
    - `activate` で消すのは自分の旧バージョンだけ。**写真の入れ物は
      ページ側のバージョン（`CACHE_VERSION`）を含まない**——含めると
      無関係な理由の版上げで全端末の写真の控えが消える
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
- 環境を増やすときは `provision-env.yml` を `envName` 指定で実行する。
  **冪等なのは「作る」ところだけで、設定は収束しない**——既にあるリソースは
  「既にあります」で素通りする。特に Cognito の `AliasAttributes` は
  作成後に変更できないので、間違った設定で作ったプールは作り直すしかない
  （Pool ID と Client ID が変わる）。

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
  --param="cloudfrontDistributionId=EYRLTGCPOS9E4" \
  --param="cognitoUserPoolId=ap-northeast-1_ZbuhDQsWz" \
  --param="cognitoClientId=21cs4cd8dkttmg3snloj72u8mu" \
  --param="cognitoPoolName=prod-journey-photo-client-spa"
```

> ⚠️ `cloudfrontDistributionId` を渡し忘れても**デプロイは成功する**
> （`serverless.yml` の既定が `''`）。落ちるのは削除時のエッジの掃除だけで、
> 消した写真が最大1年 公開URLに残る（LEFT-4）。GitHub Actions は前から
> 渡しているので、手で流すときだけの落とし穴。

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
- **定期ビルドは週1**（日曜 03:00 JST）。2026-08 に枠が逼迫して止めていたが、
  9/1 のリセット後に**毎日ではなく週1で再開**した（1回8分＝月32分・枠の1.6%）。
  毎日に戻さないのは、目的が「新しい写真の個別ページとサイトマップ」で
  写真の追加が月に数枚だから。削除・非公開の掃除は API の
  `repository_dispatch` が叩くので定期ビルドに頼っていない。
  写真を足した直後に出したいときは `Deploy Site` を手動実行する。
- **API は push で自動デプロイに戻した**（2026-09-01）。`api/**` か
  `api-user/**` を触った push で走る（main→本番 / develop→staging）。
  止めていた間、**API の修正を push しても どこにも反映されないまま
  「デプロイ済み」と思い込む**状態になっていた（実際に踏んだ）。
- **staging のフロント反映は手動実行**（1回8分と重いため）。
  `develop` への push で自動なのは API だけ。

## 本番で分かっている未設定・制約（2026-09-01 に AWS から読んで確認）

### ⚠️ `REBUILD_DISPATCH_TOKEN` が設定されていない（**owner の作業が要る**）

診断（`maintenance` の `diagnose`）で、再ビルドを頼む5つの関数すべてに
トークンが入っていないことを確認した:

    updatePhoto / deletePhoto（api）
    updatePhotoVisibility / deleteMyPhoto / deleteAccount（api-user）

デプロイのログも `再ビルド依頼: repo=rymaruta/photo-gallery token=(なし)` と
出ている。**リポジトリの Secrets に `REBUILD_DISPATCH_TOKEN` が無い**。

**何が起きるか**: 写真を削除・非公開にすると、DynamoDB の行と S3 の実体は
消えるが、**静的HTMLのページが残る**。次のビルドまで公開されたまま
——定期ビルドは週1（日曜 03:00 JST）なので、**最大7日**。
`api-user/src/rebuild.ts` は警告を1行出して先へ進むので、削除そのものは
成功して見える（＝静かに残る）。

**直し方（owner）**: `repo` スコープ（または `contents: write` の fine-grained）
を持つ PAT を作り、リポジトリの Secrets に `REBUILD_DISPATCH_TOKEN` として
登録する。次の API デプロイで5関数に入る。設定できたか確認するには
`maintenance` の `diagnose` をもう一度流す（`!!` が消える）。

### Lambda の同時実行が **アカウント全体で 10**

    総枠: 10 / 未予約: 10

AWS が未予約に最低 10 残せと言うので、**どの関数も1つも予約できない**
（`musicSearch` の `reservedConcurrency` を本番に出して UPDATE_FAILED になり、
api-user のデプロイが丸ごと巻き戻った——2026-09-01）。
同時に走れる Lambda が全部で10本という上限でもあるので、人が増えたら
**AWS のサポートに引き上げを頼む**のが先。上げたら `musicSearch` の予約
（`deploy-api.yml` の `musicSearchReserved`）を戻してよい。

## 注意事項

- **本番値のフォールバックは置かない**。テーブル名・バケット名・Cognito・
  ディストリビューションIDは全て環境変数で渡し、未設定なら止める
  （`api/src/env.ts`・`api-user/src/env.ts`・`scripts/lib/env.js` の `requireEnv`）。
  設定ミスは「本番を触る」ではなく「動かない」に倒す。
- `app/api/` は開発専用。ビルド時に自動退避される（`scripts/prepare-static-build.js`）
- `app/data/photos.json` はビルド時に DynamoDB から自動生成される（コミット不要）
- Cognito パラメータは `.env.local` に記載（git 管理外）
