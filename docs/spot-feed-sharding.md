# 撮影スポットの置き場を分ける（2026-10-07）

撮影スポットを全世界の数千〜1万件以上に増やすための設計。アプリはいま
`/app/data/spots.json`（1ファイル・1,079行・約 924KB・テストの上限 950KB）を1回で読んでいるので、
このままでは増やせない。

## 何をどこに置くか

| 置き場 | 中身 | 誰が読む |
|---|---|---|
| `/app/data/spots.json` | **2026-10-07 の公開行（1,079件）に固定**。形も上限も今のまま | 古いアプリ |
| `/app/data/spot-feed/index.json` | **軽い索引（全件）**。区分ごとにまとめた行 | 新しいアプリ（最初に読む） |
| `/app/data/spot-feed/<区分>.json` | **区分ごとの詳細**。行は `spots.json` の行と同じ中身（`toSpotFeedItem`） | 新しいアプリ（要る区分だけ後から） |
| `/app/data/spots/<slug>.json` | 本文（今のまま） | アプリ・Web |

書き出すのは `lib/data/spotFeedShards.ts`（ルートは `app/app/data/spot-feed/[file]/route.ts`）。
`spots/` の下に置かなかったのは、本文の `spots/<slug>.json` と名前がぶつかる（`index` という slug・
`fr` という slug）ため。

### 索引（`index.json`）

```json
{ "v": 1,
  "shards": [
    { "key": "jp-kanto", "count": 160, "bytes": 136288, "hash": "136288-…",
      "spots": [ { "spotId": "…", "slug": "…", "name": "…", "nameEn": "…", "reading": "…",
                   "aliases": ["…"], "region": { "prefecture": "…", "city": "…" },
                   "coords": { "lat": 0, "lng": 0 }, "category": "…", "stage": "published",
                   "seasons": ["spring"], "times": ["goldenHour"], "hasImage": true } ] } ] }
```

- 行の項目は**画面が要るものだけ**（iOS の利用者を全部洗った結果）:
  - 地図のピン・リスト: `coords`・`name`・`region`・`stage`・`category`
  - 名前で探す（地図・さがす・投稿の場所・ストーリーの候補）: `name`・`nameEn`・`reading`・`aliases`
    （別名は今まで `spot-search.json` を別に読んでいた。索引に入れて1本にした）
  - 季節・時間帯で絞る（さがす・ホームの季節の札と段・見頃のお知らせ・旅行プランの候補）:
    `seasons`・`times`（**種類だけ。文は詳細**）
  - 写真のある場所だけ出す札（ホーム・旅行プランの候補）: `hasImage`（**有無だけ。URL と出典は詳細**）
  - 近くの撮影地・行きたい場所の鍵: `coords`・`slug`・`spotId`
- 入れないもの: 概要・写真（URL・作者・ライセンス）・季節/時間帯の文・`draftedAt`・`verifiedAt`・
  時刻帯（`timeZone`・別の枝で台帳に足す）。どれも**その場所を開いた・札に出したときだけ要る**ので詳細に置く。
  時刻帯は `toSpotFeedItem` に載れば詳細にそのまま載る（索引の地図・検索・絞り込みは要らない）
- 作例の有無は、今の画面が使っていないので入れていない（要る画面ができたら足す）
- 区分ごとの `hash` は詳細のファイルの指紋（長さ + FNV-1a 64 ビット。iOS の
  `ValidatorStore.fingerprint` と同じ式）。**アプリは端末の控えの指紋が同じなら取りに行かない**——
  索引が 304 で返った回は、区分の往復も0本
- `v` は形を互換なしに変えるときだけ上げる。**アプリは知らない版なら古い `spots.json` に戻る**

### 区分の切り方

- 日本は**地方**（8区分: `jp-hokkaido`・`jp-tohoku`・`jp-kanto`・`jp-chubu`・`jp-kinki`・
  `jp-chugoku`・`jp-shikoku`・`jp-kyushu`）、海外は**国**（ISO の2文字: `fr`・`it`…）
- 2026-10-07 判断: 県（47）だと今は1区分 約20件で要求が細かすぎる。地方なら1区分 約130件・約110KB
- 区分の鍵は**アプリにとって意味の無い札**（アプリは索引の `shards[].key` だけを見る）。
  区分が上限（**500KB**・テストが見張る）を超えたら、**サーバーだけで割り直す**（日本は県・
  大きい国は州）。アプリの変更は要らない

## 大きさ（2026-10-07 の実測・minify）

| | 1行 | 1,079件（今） | 1万件 | 3万件 |
|---|---|---|---|---|
| 索引 | 約 374B（gzip 約 92B） | 404KB（gzip 100KB） | 約 3.7MB（gzip 約 0.9MB） | 約 11MB（gzip 約 2.8MB） |
| 詳細（全区分の和） | 約 857B | 924KB | 約 8.6MB | 約 26MB |
| 区分1つ（日本の地方） | | 1〜150KB | 約 1.2MB → 県で割る | |

- 本番の CDN は JSON を brotli で配っている（2026-10-07 に `content-encoding: br` を確かめた）
- **1万件までは索引1本で持つ**（テストの上限: 1行 400B・索引 4MB・gzip 1MB）。
  1万件を大きく超える（3万件）ときは**索引も地域で割る**: `index.json` を地域の索引の一覧にし、`v` を 2 に上げる
  （v1 しか知らないアプリは古い `spots.json` に戻る＝壊れない）

## 古いアプリの扱い

- `spots.json` は**行を固定**（`content/spots-feed-legacy.json`・`spotId` の一覧・1,079件）。
  2026-10-07 判断: 「上限に収まるぶんだけ選ぶ」にしなかったのは、選び方が台帳の増減で揺れると
  古いアプリで昨日あった場所が今日消えるため
- 中身（文・写真・時刻帯）は今の台帳のまま。下書きに戻した行は落ちる。新しく公開した行は載らない
- テストが見張る: 固定の一覧が 1,079件のまま・今の上限（2026-10-08 から 1,000,000 バイト。写真の小さい版 `thumbUrl` を足して 983,719）に収まる・固定の後に公開した行は載らない
- 2026-10-07 の台帳では、書き出した `spots.json` が変更前と1バイトも違わないことを確かめた

## 写真の小さい版（`image.thumbUrl`・2026-10-08）

アプリは地図・一覧で写真を 40pt の丸に出す。そこへ横 960px の元（平均 約139KB）を落とさないよう、
**短い辺 240px**（縦横比のまま・切り抜かない）・品質 70・プログレッシブの JPEG を隣に置く。

| | 場所 | 例 |
|---|---|---|
| 元 | `public/images/spots/<slug>.jpg` | `https://journey-photo.com/images/spots/akanko.jpg` |
| 小さい版 | `public/images/spots/thumb/<slug>.jpg` | `https://journey-photo.com/images/spots/thumb/akanko.jpg` |

- 写真の行（`spots.json`・`spot-feed/<区分>.json`・今日の一問の `photo`）の `image` に
  **`thumbUrl`（`url` と同じ絶対 URL の形）を、ファイルが在るときだけ**出す（`lib/data/spotThumbs.ts`）。
  サイトに置いていない写真（`url` が Commons を指す行）には付かない。古いアプリは知らない鍵として読み飛ばす
- 作るのは `scripts/spot-thumbs.mjs`（`sharp`・外部への通信なし）。787枚で約24秒、作り済みなら約1秒
  - `node scripts/spot-thumbs.mjs` 無い・形の合わないものだけ作る／`--force` 全部／`--check` 書かずに調べる
  - **本番のビルド（`npm run build` = `scripts/prepare-static-build.js`）が `next build` の前に流す**。
    写真を足した PR がサムネを忘れても、デプロイで作られて配られる。作れなかった回は `thumbUrl` が出ないだけ
  - 作ったものはコミットしておく（デプロイで作り直さずに済む）。テスト（`scripts/__tests__/spotThumbs.test.ts`）が
    コミット済みのサムネの寸法と、元の無いサムネが無いことを見張る
- 大きさ（2026-10-08 の実測・787枚）: 合計 10,876,016 バイト（平均 13.8KB・中央 13.5KB・最大 32KB）。
  元（787枚・109.5MB）の約 10%
- 索引への影響: 写真のある行に約 76 バイト。固定の `spots.json` は 924,164 → 983,719 バイト（gzip +6.7KB）

## iOS がいつ何を読むか（`OfficialSpotService`）

1. **索引**を条件付きで取る（今の `ConditionalGet`・端末の控え・60秒の控え・圏外は前回のぶん）
2. **404 なら古い `spots.json`** を今までどおり読む（新しい置き場をまだ出していない Web）。
   `v` が知らない版・中身が読めないときも同じ
3. 詳細は**要る区分だけ後から**: 開いた場所・地図に見えているピン・ホームの札と段・行きたい場所・
   旅行プランのスポット。指紋が合う控えがあれば通信しない
4. **詳細の和が小さいうち（1.5MB 以下）は、索引のあと全区分を読む**（今の 1,079件なら約 0.9MB で、
   今の `spots.json` と同じ量）。画面の見え方は今と同じ。和が上限を超えたら、要る区分だけになる
5. 本文 `spots/<slug>.json` は今のまま、場所を開いたときに読む
