# バグ狩りの台帳（2026-09〜）

**集計: 見つけた 1 / 直した 1 / 見送った 3**

このファイルは**リポジトリの中に置く**。以前の台帳は
`/root/.claude/plans/imperative-stargazing-blanket.md`（コンテナの中）に
あったため、**セッションが変わったときに丸ごと失われた**——何十周ぶんの
「使った切り口」が消え、次の周が同じ所を掘り直す寸前だった。
**コンテナは使い捨て。残したいものは commit すること。**

---

## 直したもの

### BUG-1: ストーリーで絵を差し替えても、見張りが前の要素を握ったままだった

- **どこ**: `lib/hooks/useMediaBox.ts`
- **状態**: 修正済み（`0b223fe8` ＋ 対テストの穴を塞いだ `ff00a7b8`。PR #74 で `develop` へ）
- **何が壊れていた**: `attach` は `elRef` を差し替えるだけで、`ResizeObserver` は
  **最初に観測した要素を握り続けていた**。`StoryViewer` は絵（`attachMedia`）と
  動画（`attachVideo`）で**別の要素**を出すので、種別をまたいだ回は
  **画面から消えた方**を見張ることになる。
- **効く範囲は狭い**: 囲みと `window` は別に観測しているので、
  **絵そのものの大きさだけが変わる回**（`onLoad` を過ぎたあとの差し替わり）に
  測り直しが走らない。ストーリーの文字の位置は絵の矩形に対する割合で持つので、
  ずれたまま描かれる。
- **どう直したか**: `attach` で前の要素を `unobserve` し、新しい要素を `observe` する。
- **変異5種すべて落ちる**（どの回も「4件走ってN件落ちた」＝0件走った回は無い）:

  | 変異 | 結果 |
  |---|---|
  | 新しい要素を `observe` しない | 1 failed / 3 passed |
  | 古い要素を `unobserve` しない | 1 failed / 3 passed |
  | 付け替えの条件を常に偽 | 2 failed / 2 passed |
  | `roRef` を保持しない | 2 failed / 2 passed |
  | 相対化の引き算を落とす | 1 failed / 3 passed |

- **レビューが自分のテストの穴を捕まえた**: 最初のテストは `width`/`height` しか
  突き合わせておらず、この hook の存在理由である**囲みからの相対にする引き算**を
  落としても4件とも緑だった。鵜呑みにせず自分で変異を入れて再現してから直した。

---

## 見送ったもの（見つけたが直さないと決めた）

### 見送り1〜3: 取り消しの番人が無い非同期 effect（3本）

`await`/`.then` のあとに `set*()` する `useEffect` は **26本**。うち取り消しの
番人（`aborted`/`cancelled`/`ignore`/`signal` 等）が見当たらないのは **3本**:

    app/components/GalleryModal/index.tsx:154
    app/components/NotificationsBell.tsx:125
    app/user/profile/page.tsx:285

**直さない理由**: 3本とも**並行セッションが作業中のファイル**
（順に `claude/saves-and-map-sheet` / `claude/notifications-and-settings` ×2）。
衝突を作らないために手を出していない。

⚠️ **実在するかどうかも確かめていない。** 正規表現で「番人が見当たらない」と
数えただけで、A→B と素早く移ったときに実際に古い応答が新しい状態を上書きするか、
再現の筋は取っていない。あちらが落ち着いてから、**まず再現から**やり直すこと。

---

## 対テストがまだ無いもの（次の周の入口）

`lib/` の実装ファイルを**テストからの import 数**で数えた結果、参照数0は4本。
うち `useMediaBox` は BUG-1 で塞いだ。**残り3本は読んだが欠陥を見つけられず、
対テストも無いまま**:

    lib/utils/profileShape.ts
    lib/utils/text.ts
    lib/utils/userRows.ts

「欠陥が無い」と言い切れるほど網羅的には読んでいない。

> ⚠️ **数え方**: ファイル名の一致で数えると `mediaHosts.ts` のように
> `scripts/__tests__/mediaHostsParity.test.ts` が在るものを取りこぼす。
> **import で数えること。**

---

## 掘った切り口と、その結果

### 使用済み（コメント・コミットに証跡があるもの）

| 切り口 | 証跡 |
|---|---|
| ロケール/タイムゾーン依存の描画ずれ | `lib/utils/photoDate.ts:4`・`app/users/UserProfileClient.tsx:130` |
| 「読み込み失敗」を「0件」として描く | `app/components/FollowButton.tsx:33-45`・`lib/hooks/useFollow.ts:427` |
| 非ASCIIスラッグのURLエンコード | `lib/utils/collections.ts:237-594`・`lib/utils/text.ts` |
| 応答の形が壊れていると画面ごと落ちる | `lib/utils/apiRows.ts`・`lib/utils/profileShape.ts` |
| EXIF の向き・GPS 除去 | `49ab6d2c` `f0c60b89` |
| `sizes` の申告ずれ | `10a31458` `4e60f8d7` `c7266a1b` |
| `<Link>` の先読み | `CLAUDE.md`「表示速度で踏んだ大きい穴」・`app/__tests__/linkPrefetch.test.ts` |
| Service Worker / オフライン | `CLAUDE.md` の PWA 節 |
| 支援技術・コントラスト・タップ標的 | `landmarks` `textContrast` `chipTapSpacing` ほかのテスト |
| タグ入力（候補チップ・絞り込み） | `CLAUDE.md`「タグの入力」節・`fd085dc8` `4270363b` `e28b01cf` |
| 集約ページの `noindex` / 検索面積 | `CLAUDE.md`「集約ページの実測」節 |
| Cognito のグループ・登録・メール変更 | `1e2bae8b` `0aa61f98` `72b97ebe` `03284f64` |
| アバター/カバーの破損表示 | `d2302ca4` `5636b6a1` |
| 押せるのに必ず失敗する導線 | `903279da` `d1b62846` |

### 2026-09-21 の周で掘った3本

#### ① 実ビルド `out/` 全体の内部リンク実体検査 → **0件**

    走査した HTML        147
    内部リンクの出現     8,231
    内部リンクの異なり     209
    解決できない異なり      32  → **全部 `/uploads/**` と `/profiles/**`**

**その32件はバグではない。** 画像アップロード用の S3 バケットを CloudFront が
配る経路で、`out/` には元から入らない。**計測器の誤りだった。**
除くと**ページのリンクは0件が壊れている**。

計測器の変異テストもした——`out/index.html` に `href="/location/存在しない場所"`
を1本入れると 32→33 になり、そのURLを名指しで報告した。つまり「0件」は
測れていないのではなく、本当に0件。

**ついでに測った（どれも異常なし）**: 孤児ページ21件のうち11件は
`/category/自然` `/tag/風景` 等の**日本語スラッグ**だが、調べると
**意図した canonical の別名**で全部が英語の正規URLを向いている。
`sitemap.xml`(53件) には英語の正規URLしか載っていない。

#### ② 実ブラウザで全147ページを開いて例外を数える → **0件**

    開いたページ          147
    pageerror             **0**
    console.error         37 → **全部が2種類の "Failed to fetch"**（環境の産物）
    同一オリジンの要求失敗  2 → ログイン誘導の client-side redirect（`ERR_ABORTED`）
    水和しなかった         1 → `/offline`（`public/offline.html`＝SW の受け皿。設計どおり）

既存の `scripts/e2e-smoke.mjs` は6種類の画面しか開かず、しかも console.error を
**⚠️として出すだけで落とさない**（`collectPageIssues`）。全面掃きは今回が初。

#### ③ テストが一度も直接参照していないモジュールを読む → **1件（BUG-1）**

上の「対テストがまだ無いもの」を参照。

### 未使用の候補

- **画面の上限とサーバーの上限の食い違い**（`maxLength` と `api-user/src/sanitize.ts`）。
  タグの50字（`e28b01cf`）は塞がれているが、他の欄は数えていない
- **楽観更新の巻き戻し漏れ**（失敗したのに数字が戻らない）
- **比較関数の安定性**（`.sort(` 40か所・`localeCompare` 26か所）。
  一貫しない比較は静的ビルドの出力が回ごとに変わる
- `profileShape` / `text` / `userRows` の対テスト

---

## 測り方の落とし穴（2026-09-21 に実際に踏んだ3件）

1. **`out/` に無い＝壊れている、ではない。** `/uploads/**` `/profiles/**` の32件を
   「実在する404」と報告しかけた。中身を読んで止まった。
2. **`| grep` の後ろの `$?` は grep の終了コード。**
   `npx eslint ... | grep -v ...; echo "rc=$?"` が `rc=1` を出したが eslint 自身は 0。
   **終了コードを見たいならパイプを通さずファイルへ落としてから読むこと。**
3. **`npm run verify` を「緑」と読み違えかけた。** バックグラウンド実行の通知が
   `exit code 0` と出したのは末尾の `tail` のもので、**verify 自身は 1**。
   型検査2本が落ちていた。

## この環境での実ビルド手順（実際に通ったもの）

```bash
mv app/api _api_build_backup
NEXT_PUBLIC_SITE_URL=https://journey-photo.com \
NEXT_PUBLIC_CLOUDFRONT_URL=https://d1s3dwwzgxf5ni.cloudfront.net \
NEXT_PUBLIC_API_BASE_URL=https://ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com \
NEXT_PUBLIC_USER_API_BASE_URL=https://gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com \
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_ZbuhDQsWz \
NEXT_PUBLIC_COGNITO_CLIENT_ID=21cs4cd8dkttmg3snloj72u8mu \
NEXT_PUBLIC_AWS_REGION=ap-northeast-1 NEXT_PUBLIC_ENV_NAME=prod \
npx next build
rm -rf app/api && mv _api_build_backup app/api
```

- **`npm run verify` は `api/node_modules` と `api-user/node_modules` が無いと
  型検査2本で落ちる**（素通りしないのは正しい）。このコンテナでは `serverless` の
  postinstall が外に出られないので **`npm ci --ignore-scripts`** で入れること
- クローンが shallow のときは `git remote set-branches origin '*'` を先に打つ
  （打たないと `origin/develop` が作られず `fatal: not a commit`）
- **Playwright の版ずれ**: リポジトリは build 1228 を欲しがるがコンテナは 1194。
  `playwright install` は打たず
  `chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" })`
