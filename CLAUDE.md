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
      - **「写真は必ず別オリジン（opaque）」ではない。** 保存されている値は
        実測（`app/data/photos.json` の30枚）で **19枚が `journey-photo.com`**・
        11枚が CloudFront の既定ドメイン。
        **2026-09-13 以降、画面に描くURLは全部サイトのドメインに揃う**
        （`lib/utils/seo.ts` の `publicImageUrl` を `Thumb`・`ModalImage`・
        写真ページ本体・地図・ストーリー・先読みの各入口で通す）＝
        **実際に飛ぶ要求は同一オリジンだけ**になった。
        ただし**保存側は直っていない**——`api-user/src/upload.ts` の
        `canonicalUploadUrl` は `CLOUDFRONT_URL` を土台にし、`deploy-api.yml` は
        本番にその既定ドメインを渡すので、**これから上がる写真も既定ドメインで
        保存される**。`normalize-image-urls` を流しても次の投稿からまた割れる
        ので、出す側で揃えるこの経路が恒常的な受け皿
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

## タグの入力（2026-09-13・owner の「決まったのを選ぶ方が楽？」への答え）

**候補チップは「選ぶ」もの。** 一覧の絞り込み（`FilterBar`）と同じ形で、
`role="switch"` ＋ 選択中は白地 ＋ **押し直すと外れる**（`lib/utils/ownValues.ts`
の `toggleTag` / `hasTag`）。以前は足すだけだったので、**既に付いているタグの
チップは押しても無反応**だった。

**打ちかけの文字で候補を絞る**（`suggestTags`）。実データを数えると:

    タグの種類（`collectOwnValues(photos).tags`）  59
    何も打たずに選べる                            12
    打ち切る手前で候補に出る                      **58 / 59**

- **数えるときは `collectOwnValues` を通すこと。** 生の異なりは62だが
  `tagKey` が `自然/nature`・`風景/landscape`・`建物/architecture` を畳むので
  **画面が扱うのは59**。自前の正規化で数えて doc を6か所間違えた
- **打ち終わったら絞りを解く**（最後の欠片が候補と丸ごと同じなら
  「選び終えた1つ」）。そうしないと1つ選んだ瞬間に他の候補が消える
- **チップを押すときは打ちかけの欠片を落とす**（`dropFragment`）。
  落とさないと `sau` と打って `sauna` を押したときに `"sau, sauna"` になり、
  **`sau` が写真のタグとして保存される**（絞りの目的と逆になる）

**残る本当の問題は、地名をタグに書いていること**（finland・helsinki・paris…）。
実データで**タグ4種が owner 自身の撮影地の語と同じ**（山中湖・バルセロナ・
パリ・フランス）。撮影地欄へ移すと `/location/*` が厚くなる＝**owner の作業**。

## 表示速度で踏んだ大きい穴（2026-09-13・実測）

**Next の `<Link>` の先読みを、公開ページでは全部切ってある。** 静的書き出し
（`output: export`）なので先読みが引くのは**行き先のHTML（1本およそ55KB）と
セグメントの `.txt` 数本**で、`scripts/deploy-static-site.js` は
**どちらも `no-cache, no-store` で配る**（`isHtmlOrTxt`）——つまり
**リンクが画面に出入りするたびに毎回落とし直す**。

    先読みの要求数（スクロール込み・実測）
                トップ  写真ページ  /tag/finland  /users/<id>
      修正前      142        75          114          137
      修正後        0         0            0            0

    写真ページ1訪問（生・サーバが実際に書いたバイト）
      修正前  RSC 50件/117KB ＋ HTML 15件/700KB ＋ JS 25件/1,055KB ≈ 1.87MB
      修正後  RSC  0件       ＋ HTML  3件/129KB ＋ JS 15件/  594KB ≈ 0.82MB

- 代償は**最初のタップが +83ms**（往復80msを足した A/B の中央値）。
  ただし**無条件ではない**——回線を絞って（1.6Mbps）**すぐ押す**と符号が
  逆転し、**先読みなしの方が94ms速い**
- **JS が減るのは初回訪問だけ**（`_next/**` は `immutable`＋SW がキャッシュ優先）。
  毎回効くのは `no-store` の HTML と `.txt` のぶん
- **ログインした人しか描かれない画面（11件）だけ免除**。
  見張りは `app/__tests__/linkPrefetch.test.ts`——`app/**` の `<Link>` を
  全部数え、免除に無いものが先読みしていれば落ちる
- **`prefetch={false}` は hover / touchstart の先読みも止める**
  （`next/dist/client/app-dir/link.js` の `prefetchEnabled`）。
  遷移が遅いと感じたら `router.prefetch` を `onTouchStart` で撃つのが次の一手

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

## 本番の設定（2026-09-12 に実測して更新）

### ✅ `REBUILD_DISPATCH_TOKEN` は設定済み（2026-09-12）

owner が fine-grained PAT を登録し、本番の API デプロイ（run 249）で
**8/8 の関数に入った**ことを `maintenance` の `diagnose` で確認した:

    → 再ビルドのトークンを持つ関数 8/8
    → 読み取り専用ロールの関数 7/7 ・ トークンが余計に付いた関数 0

**これで写真の公開・削除・非公開が数分でサイトに反映される。**
それまでは静的HTMLが**最大7日**残っていた（定期ビルドが週1のため）。

**トークンの中身**: fine-grained PAT / `rymaruta/photo-gallery` のみ /
Repository permissions は **Contents: Read and write** だけ /
**期限 2026-12-11**（90日）。

**⚠️ 期限が来たら静かに壊れる。** 切れると `rebuild.ts` は警告を1行出して
先へ進むので、画面にも診断にも何も出ないまま「最大7日残る」状態に戻る。
そのための見張りが `.github/workflows/token-health.yml`:

- **週1（月曜 09:00 JST）にトークンを実際に使ってみる**。駄目ならワークフローが
  赤くなり、GitHub が既定で owner にメールを送る
- **残り14日を切ったら赤くする**（GitHub が応答に返す残り期限のヘッダを読む）
  ＝切れてからではなく**切れる前**に気づける
- ビルドは起きない——`deploy.yml` が待ち受けているのは `types: [site-rebuild]`
  だけなので、別の名前（`token-healthcheck`）で dispatch すると GitHub は
  204 を返すだけ。**本番と同じ口**で権限まで確かめられる
- **`event_type` を待ち受けている名前に変えてはいけない**（毎週8分のビルドが走る）。
  `scripts/__tests__/tokenHealth.test.ts` が全ワークフローの `types:` を
  読み取って突き合わせている

**スケジュールは既定ブランチでしか走らない。** この仕組みが動き出すのは
`token-health.yml` が `main` に入ってから。

### ✅ Google Search Console（2026-09-12 に画面で確認）

- **プロパティ登録済み**——`journey-photo.com` の**ドメイン プロパティ**
  （DNS で所有権確認済み）。`http/https`・`www` あり/なし・全サブドメインを
  まとめて見る形。**メタタグでの確認は不要**なので
  `NEXT_PUBLIC_GSC_VERIFICATION` は空のままでよい（`publicEnvWiring.test.ts`
  の免除理由がそのまま当てはまる）
- **サイトマップ2本とも送信済み・成功**（2026/08/19）。再送信は不要
  （`robots.txt` に2本とも書いてあるので Google は自動でも見つける）

      sitemap.xml         成功しました   検出されたページ数 50
      sitemap-images.xml  成功しました   検出されたページ数 32

- **「約140ページ」は誤り。正しくは 50。** ビルドが作る HTML は約140だが、
  サイトマップに載せるのは**薄い集約ページを除いたぶんだけ**
  （`isIndexableCollection` に届かないページは `noindex`＋サイトマップから除外）。
  この 50 は**送信当時（集約16ページ）の数**で、内訳はおおよそ
  写真30 ＋ 集約16 ＋ プロフィール2 ＋ 固定ページ。
  **この数がこのサイトの「検索での面積」**で、増やす作業＝集約ページを
  厚くして検索に出せるようにすること。
  2026-09-12 の作業で**集約が 16 → 20** になったので、次のビルド以降は
  54 前後になる見込み（Search Console の再クロール待ち・未確認）

### 集約ページの実測（2026-09-12・リポジトリ本体の関数で数えた）

作業前（`255e8af5` より前）:

    location   全14ページ  検索に載る(3枚以上): 4   載らない: 10
    tag        全62ページ  検索に載る: 7            載らない: 55
    category   全 6ページ  検索に載る: 3            載らない:  3
    camera     全 4ページ  検索に載る: 2            載らない:  2   → 合計 16

作業後（タグの日英統合＋撮影地の線を2枚に）:

    location   全14ページ  検索に載る(**2枚以上**): 7   載らない: 7
    tag        全59ページ  検索に載る: 8                載らない: 51
    category   全 6ページ  検索に載る: 3                載らない: 3
    camera     全 4ページ  検索に載る: 2                載らない: 2   → 合計 **20**

**線は種別で違う。** タグ・カテゴリ・機材は3枚（`MIN_INDEXABLE_COUNT`）、
**撮影地だけ2枚**（`MIN_INDEXABLE_LOCATION`）。撮影地は固有名詞で、その写真は
このサイトにしか無いため。**1枚では載せない**——1枚の撮影地ページは
その写真の個別ページと中身が同じになる（題に撮影地が入り、説明という
固有の文章も持つ側が強い）。

**自前で数え直さないこと。** 撮影地だけは `photosInCollection` が
「緩い一致」で数える（「パリ」「パリ, フランス」「オペラ・ガルニエ（パリ）」を
寄せる）ので、完全一致で数えると**全部 noindex に見えて結論を誤る**
（実際に一度誤った）。

### 写真の中身（2026-09-12 実測・SEO の本丸）

    公開写真   30枚
    撮影地     17/30（13枚が空）
    説明       中央値 60文字・27/30 が100文字未満
    題         中央値 6文字・撮影地が入っているのは 2/30
    撮影日      8/30
    alt        30枚中2枚（残りは題がそのまま alt になる）

**技術側はほぼ詰め終わっている。順位を動かすのは owner が書く中身。**
狙うのは「高屋神社 雲海」「ネモフィラ 見頃 撮影」のような具体語で、
「旅行 写真」のような語では30枚のサイトは勝てない。

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
