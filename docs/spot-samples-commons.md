# 撮影地の作例（Wikimedia Commons）— ライセンスの扱い

2026-10-03 作成。撮影地ページ（`/spots/<slug>`）とアプリのスポット本文
（`/app/data/spots/<slug>.json`）に出す「作例」の決まり。

**この文書は法的な助言ではない。** 最後の判断は owner が行う（下の「owner が確かめること」）。

## 何をしているか

利用者の投稿が0枚の撮影地には写真が1枚も無い。そこで、**その撮影地の近くで撮られ、
Wikimedia Commons で自由なライセンスのもと公開されている写真**を、作者表示つきの
「作例」として最大6枚出す。

| ファイル | 中身 | 誰が書く |
|---|---|---|
| `content/spot-samples.candidates.json` | 機械が集めた候補（spotId ごと・自動で採ったもの＋点数の高い順に最大10件と、件数） | `scripts/collect-commons-samples.mjs` |
| `content/spot-samples.json` | **採用した分だけ**（spotId → 最大6枚）。画面とアプリが読むのはこれだけ | 機械が規則で選び、**人が足し引きしてよい** |

- 手で直すとき: 要らない1枚は配列から消す。候補ファイルから足すときは同じ形で書き、
  `pickedBy` に**人の名前**を書く。人が選んだ1枚は、収集を流し直しても消えない
- DynamoDB は使わない。ビルドのときに JSON を読むだけ

## 2026-10-03 に流した結果（公開済み 1,079 か所すべて）

    作例が1枚以上   797 か所 / 3,680 枚（3枚以上は 635 か所）
    0枚             282 か所
      A. 半径 500m に Commons の写真が1枚も無い        178   ← 山・滝・温泉・海岸など。台帳の座標のずれも疑う
      B. 近くに写真が多い（使える20枚以上）のに名前が1つも当たらない  23   ← **台帳の座標の誤りを疑う**
      C. 名前は当たるが、採る条件（大きさ・向かない語など）で落ちた   6
      D. 近くの写真が少なく（1〜19枚）、名前も当たらない        75
    ライセンス      CC BY-SA 1,905 / CC BY 1,496 / CC0 219 / パブリックドメイン 60
    要求            Commons と Wikidata に計 約3,100回（途中で止めた回は数を出さないので推定）・2秒に1回・429 は1回だけ

- **台帳の座標は小数2桁で切ってある**（約1km）。例: 天橋立 傘松公園は台帳 35.58,135.19 で、
  半径 500m に写真が0枚（A）。Wikidata の座標がある所はその周りも探しているが、
  `content/spot-images.json` に Wikidata の無いスポットは台帳の座標しか使えない
- **座標の確かめ（2026-10-03・レビュー）**: B の 24 か所と傘松公園を、Wikidata の P625（同じものを指す項目だけ）と
  国土地理院の地名・住所検索（番地まで当たるものだけ）に突き合わせ、根拠が一致して台帳が丸めの範囲を外れていた
  8 か所を直した（傘松公園・大石林山・霞ヶ城公園・石舞台古墳・北浜アリー・湧水庭園・瀬戸大橋記念公園・白鳥庭園）。
  石舞台古墳は Wikidata の P625 の方が誤り（約5km 南）で、国土地理院の値を使った。残りの多くは座標ではなく
  名前の当たり方（外国語の名前など）が原因。値は `lib/data/__tests__/spotsLedger.test.ts` が縛る
- 0枚の一覧の出し方: 候補ファイルの `filesFound`（見つかった数）・`usable`（使えるライセンス）・
  `named`（名前が当たった数）で分けられる

## 採るライセンス・落とす条件

**採る**: CC0 / パブリックドメイン（`Public domain`・`PD-…`）/ CC BY（版は問わない）/ CC BY-SA（版は問わない）。

**落とす**（収集のときと、表示のとき `lib/data/spotSamples.ts` の `toSpotSample` で二重に）:

- NC（非営利のみ）・ND（改変禁止）が付くもの（`CC BY-NC`・`CC BY-ND`・`CC BY-NC-SA` …どの書き方でも）
- GFDL だけのもの、`Attribution` などその他のテンプレート、ライセンスの欄が空のもの
- CC BY 系で**作者が名前でない**もの（作者表示が使う条件なので、出せない）。空のほか、
  決まり文句（「…と推定されます」「Own work」「投稿者自身による著作物」「Unknown author」「不明」）、
  お願い文（「please credit…」「I would appreciate…」）、署名の日時（`(UTC)`）、80字を超えるもの。
  パブリックドメイン・CC0 なら「作者不明」と出す。規則は `lib/utils/commonsAttribution.mjs` の
  `isPlaceholderAuthor`（収集と表示で同じ1本）
- **アメリカだけのパブリックドメイン**（PD-US 系。日本では保護期間内のことがある）。
  🔴 extmetadata の `LicenseShortName`・`License`・`UsageTerms` は、パブリックドメインなら根拠を問わず
  "Public domain"・"pd"・"Public domain" になる（2026-10-03 に作例の 60 枚で実測）＝**これでは見分けられない**。
  そこでファイルのページの**根拠のテンプレート**（`Template:PD-self`・`PD-Japan`・`PD-USGov-POTUS` …）を見て、
  確定ファイルの `licenseCode` に書く（`pdBasisOf`。部品のテンプレートは除き、日本でも通る根拠を先に選ぶ）。
  - 収集のたびに、根拠の分からないパブリックドメインの行だけを聞き直す。確定ファイルだけ直すときは
    `node scripts/collect-commons-samples.mjs --refresh-licenses`（`licenseCode` 以外は触らない）
  - **根拠の分からないパブリックドメインは表示しない**（`toSpotSample`）
  - 画面の表示は根拠を添える（`Public domain (PD-self)`）
  - 🔴 **CC BY・CC0・GFDL のテンプレートも一緒に付く PD は、PD として扱わない**（`photoLicenseOf`）。多くは
    「写っている美術品・文章が PD、写真そのものは CC BY」。写真の欄の印（Art Photo・Self-photographed・
    Own photograph）があって CC BY が1つだけなら写真は CC BY として出す（文面のリンクつき・作者は撮影者）。
    決められなければ `licenseCode` に `mixed:…` を書き、表示しない。2026-10-03: 桂浜の龍馬像 2 枚 → CC BY 3.0、
    若狭の歌碑（GFDL も付き、作者の欄が歌の作者）→ 表示しない
  - 構造化データの `creator` は `Person`。団体と分かる名前だけ `Organization`（`isOrganizationName`）
  - 2026-10-03 の取り直しの結果: PD-self 43・PD-author-FlickrPDM 8・PD-Japan 3・PD-Japan-oldphoto 2・
    PD-old 2・PD-user 1・**PD-USGov-POTUS 1（表示しない）**。`PD-user` を PD-US と取り違えていた判定も直した
- **人物の権利の印**（`Restrictions` やカテゴリの personality rights など）があるもの
- **人や催しが主役のもの**（ファイル名に Festival・Rallye・Marathon・Parade・Portrait・コスプレ・
  祭り…）。撮影地そのものが祭り（カテゴリ「祭り」・名前に祭・くんち・ねぶた…）なら落とさない
- CC BY 系で**ライセンスの文面の URL が無い**もの
- 画像が `upload.wikimedia.org` でない・出典が `commons.wikimedia.org/wiki/File:` でないもの
- 縮小版にできない元画像（下の「位置情報の扱い」）
- 写真でないもの（SVG・TIFF・PDF・GIF・動画。採るのは JPEG・PNG・WebP）

**表示側（`toSpotSample`・`spotSamples`）でも同じ規則で落とす**ので、確定ファイルに既に入っている
行にも、収集し直さずに効く（2026-10-03 時点で 3,680 枚のうち、作者の欄で 11 枚・人や催しの語で 11 枚が落ち、
表示は 3,658 枚）。

判定は代表写真（`content/spot-images.json`）と同じ関数を使う（`isAllowedLicense`・`coverLicenseOf`）。

**自動では採らない**（候補には残る）: 人物の権利などの注意書き（Commons の `Restrictions`・カテゴリ）が
付いたもの、人や催しが主役のもの、名前（正式名・別名・slug）がファイル名・題・説明のどれにも入らないもの、
小さいもの（長い辺 1000px 未満・短い辺 600px 未満）、極端な横長（3:1 超）。

## 作者表示の出し方

CC BY / CC BY-SA の表示条件（TASL: 題・作者・出典・ライセンス）に沿って、**1枚ごとに写真のすぐ下へ**:

    <題> / 写真: <作者> / <ライセンス名（文面へのリンク）> / Wikimedia Commons（ファイルのページへのリンク）

- 題は Commons のファイル名から `File:` と拡張子を除いたもの
- 作者名は Commons の **`Attribution`（作者が求める表記）→ `Artist`** の順に、HTML を平文にしたもの。
  **`Credit` は使わない**（「投稿者自身による著作物」など出所の説明で、名前ではない）。
  extmetadata は英語で取る（日本語だと作者の欄に「…と推定されます」が付く）。
  飾り（「( talk )」「User:」「photo:」「This photo was taken with <カメラ>」）は落とし、名前は崩さない
- 節の見出しは「作例（Wikimedia Commons より）」。撮影者はこのサイトの利用者ではないと添える
- パブリックドメイン・CC0 は表示の義務は無いが、同じ形で出す（作者不明なら「作者不明」）
- 構造化データ（JSON-LD）は `ImageObject` に `name`（題）・`license`・`acquireLicensePage`・`creditText` を書く。
  `creator` は作者が分かるときだけで、型は `Person`（団体と分かる名前だけ `Organization`）。
  パブリックドメインの `license` は Public Domain Mark（`https://creativecommons.org/publicdomain/mark/1.0/`）。
  **入れるのは画面に出している作例の全部**（自動で選んだものも。2026-10-03 のレビューで、人が選んだ1枚
  だけにしていたのをやめた——画面に出す以上、出典の表示は構造化データでも同じにそろえる）
- 読み込めなかった1枚（Commons で消えた・差し替わった）は、画面でその1枚を出典ごと隠す
- アプリ向けの本文 JSON の `samples` も、1枚ごとに `title`・`author`・`license`・`licenseUrl`・`sourceUrl` を持つ。
  アプリは写真の下にこれらを出すこと（いまの iOS はこの項目を読まない＝出していない）

## CC BY-SA の扱い

- **写真を改変しない。** 切り抜かず元の縦横比のまま表示し、色・文字入れもしない
  （縮小は Commons 自身のサムネイルを使う）。改変していないので「改変したら同じライセンスで
  公開する」（継承）の条件は掛からない、という整理
- ページ全体（文章・ほかの写真）を CC BY-SA にする必要は無い、という整理（写真を並べて載せる
  だけで、写真と一体の新しい著作物を作っていない）。**ここは owner に確かめてほしい**

## 位置情報の扱い

- 画像は **Commons の縮小版の URL をそのまま表示**する（こちらで複製して配らない）。
  2026-10-03 に1枚だけ調べた範囲では、1280px の縮小版の EXIF は 76 バイトで GPS は
  入っていなかった。**縮小版なら GPS が必ず消える、とは確かめていない**（1枚だけ・全件は見ていない）
- **元画像は表示に使わない。** API は元の幅が頼んだ幅（1280）以下だと縮小版ではなく元画像の URL を
  返す（2026-10-03 の確定ファイルで 138 枚）。元画像は EXIF（GPS を含みうる）が丸ごと残るので、
  元より小さい標準の幅（960・500…）の縮小版の URL に替える（収集側 `standardThumbOf`・
  表示側 `toSpotSample` の両方。確定ファイルの 138 枚も表示のところで替わる）
- 画面・アプリが出す位置は**台帳の撮影地の座標**（約1km に丸めたもの）だけ。写真そのものの
  撮影位置（EXIF の GPS・Commons の座標）は、候補にも確定にも書かない（探した中心からの距離だけ）
- 元画像に GPS が入っていても、それは撮影者が Commons で公開した情報で、こちらは再配布しない

## これまでの方針との違い（要確認）

代表写真（`SpotCoverImage.src`）は「**サイト内に置いたものだけ・外部へのホットリンクはしない**」
と決めてある（`scripts/localize-spot-images.mjs` で縮小版を `public/` に置く）。作例は依頼どおり
**Commons のサムネイルを直接読む**形にした。理由は (1) 複製しないので元画像の位置情報を
こちらが配らない (2) 全国で約数千枚を `public/` に置くとリポジトリとデプロイが重くなる。
代わりに、Commons 側が消す・差し替える・止まると、その1枚は割れる。サイト内に置く方へ
寄せるなら、代表写真と同じ道具で置ける。

## 候補ファイルの大きさ

- 候補ファイル（約 7MB）は**次の収集から**説明（`description`）と種類（`mime`）を残さない
  （点数を付けるのに使うだけ）。2026-10-03 の分はそのまま（収集し直していない）
- 差分が大きく読めないので、`.gitattributes` に次の1行を足して**差分を出さない**扱いにする案:

      content/spot-samples.candidates.json -diff linguist-generated=true

  まだ足していない（GitHub の PR 画面で中身が畳まれるので、owner が候補を PR で見たいなら足さない方がよい）

## 通信の作法

CLAUDE.md の「Wikipedia / Wikidata の API は叩きすぎない」に従う: 2秒に1回まで・1本だけ・
連絡先入りの User-Agent・429 は待って取り直す。**済んだ spotId は飛ばす**ので、止まっても
同じコマンドで続きから走る。

## Commons 以外の出どころ: Flickr（2026-10-04）

確定ファイルの1枚に `source` を書くと、Commons 以外の写真として読む。**`source` の無い行は今まで通り
Wikimedia Commons**（既存の行は変えない）。いま読めるのは Flickr だけ。

```json
{
  "title": "写真の題（Flickr の題）",
  "source": { "name": "Flickr", "url": "https://www.flickr.com/photos/<人>/<写真ID>/" },
  "thumbUrl": "https://live.staticflickr.com/<server>/<写真ID>_<secret>_b.jpg",
  "width": 1024, "height": 683,
  "author": "作者名", "license": "CC BY 2.0", "licenseUrl": "https://creativecommons.org/licenses/by/2.0/",
  "pickedBy": "人の名前"
}
```

- ライセンスは **CC BY・CC BY-SA・CC0 だけ**（Public Domain Mark・「著作権の制限なし」・NC・ND は表示しない）
- 出典のリンクは **Flickr の写真のページ**（Flickr の決まり）。表示は「題 / 写真: 作者 / ライセンス / Flickr」、
  JSON-LD は `creditText` の最後が Flickr・`acquireLicensePage` が写真のページ
- 画像は `live.staticflickr.com` だけ（`SAMPLE_IMAGE_ORIGINS`）。写真のページと画像の写真ID が食い違えば出さない
- 画面とアプリ向けの本文（`/app/data/spots/<slug>.json`）の1枚には、Commons 以外のときだけ
  `source: { name, url }` が付く（`sourceUrl` と同じ URL）

## サイトに置く出どころ: 環境省・県の観光協会など（2026-10-04）

作例が 3 枚以下の公開済み撮影地に、公的な素材を足した。**どの提供元も画像への直リンクを禁じている**
（環境省「他のホームページ中に組み込まれるようなリンクはしない」、福岡・熊本は名指しで禁止）ので、
Commons・Flickr と違い**サイトに複製を置く**。

- 置き場: `public/samples/<slug>/<n>.jpg`。幅 1280px 以下（元が大きいものだけ縮小）・EXIF と XMP を消す
  （環境省の 890px の写真は縮小せず、APP1 などのメタデータの区画だけを外した＝画素は元のまま）
- 行の形: `source: { name: <提供元>, url: <写真のページ> }`・`title`（提供元の題）・`thumbUrl`（上のパス）・
  `width`・`height`・`resized`（縮小したら true）。**作者・ライセンス・出典の文・規約のページは行に書かせず**
  `lib/data/spotSamples.ts` の `HOSTED_SOURCES` から出す
- 表示: 「題 / 規約が求める出典の文 / 規約の名前（文面へ）/ 提供元（写真のページへ）/ 加工の表記」。
  前書きは「自由なライセンス」と言わず「提供元の利用規約に従って掲載」と書く
- 構造化データ: `license` は規約の文面（環境省は PDL1.0 の文面）、`acquireLicensePage` は規約のページ、
  `creator` は団体、`creditText` は出典の文
- 画像の URL は `publicImageUrl` を通したこのサイトの URL（本番は `https://journey-photo.com/samples/…`）。
  アプリ（`/app/data/spots/<slug>.json`）も同じ値を読む

| 提供元（`source.name`） | 規約 | 出典の文 |
|---|---|---|
| 環境省 | PDL1.0（https://www.env.go.jp/nature/nationalparks/terms/ ） | 出典：「○○の写真」（環境省）。縮小したら「を加工して作成（journey.photo が縮小）」 |
| 山口県観光連盟 | 写真のページ内の利用規約 | 写真提供：山口県観光連盟（規約にクレジットの決まりは無い） |
| 福岡県観光連盟 | https://www.crossroadfukuoka.jp/business/photo/guide | 写真提供：福岡県観光連盟（必須） |
| 熊本県観光連盟（申請不要の写真だけ） | https://kumamoto.guide/photos/guide-free | 写真提供：熊本県観光連盟（「©」の置き換えとして許されている） |
| 香川県観光協会 | 写真のページ内の利用規約 | 提供：（公社）香川県観光協会（任意） |
| 宮崎県観光協会 | https://www.kanko-miyazaki.jp/business/photo/guide | 写真提供：宮崎県観光協会（任意） |
| やまなし観光推進機構 | https://www.yamanashi-kankou.jp/gallery/use.html | 写真提供：やまなし観光推進機構（必須） |

**入れなかったもの**: ひょうご観光本部（規約は「申請不要」だが、元の大きさの画像はお申込みフォームを
通さないと落とせない）、和歌山（成果物の提出が要る・二次利用禁止）、愛媛（掲載した現物を送る）、
広島（営利目的は禁止）、茨城（加工禁止）、岡山・宮城（規約がこの使い方を禁止）、東北観光推進機構（目的の縛り）。
人が主役の写真（モデルが写ったもの）・撮影地と違うと読めるもの（「星野村の棚田」を茶畑に、環境省の
「熊野古道」を松本峠に）も外した。

**owner が確かめること**: 県の素材はほぼ全部「その県の観光 PR のため」に限っている。撮影地図鑑はそれに
当たると読んで入れたが、確実にするなら各団体に一報するとよい（福岡・ひょうご・広島などは使った URL を
知らせるよう求めている＝努力義務）。環境省の写真の右下の「Photo by Ministry of the Environment」は
提供元自身の表記なので残した（第三者のクレジットではない）。

## owner が確かめること（法的な最終確認）

1. **作者表示の形**（「写真: 作者 / ライセンス / Wikimedia Commons」）で、CC BY / BY-SA の表示条件を満たすと判断してよいか
2. **CC BY-SA の写真を並べて載せても、ページ全体に継承が及ばない**という整理でよいか
3. **題はファイル名でよいか。** CC BY / BY-SA の 2.0〜3.0 は題（作品名）の表示を求める（4.0 では求めない）。
   確定ファイルには 2.0〜3.0 の写真が多く混ざるので題を出すことにしたが、Commons のファイル名を
   題とみなしてよいかは owner に確かめてほしい
4. **人物が写る写真**（肖像権・パブリシティ権）と、**建物・美術品の写真**（日本の著作権法 46 条の範囲・寺社の撮影規約）を商用サイトに出してよいか。Commons のライセンスは撮影者の著作権だけを扱い、写っている側の権利は扱わない
5. **自動で選んだ作例**が本当にその撮影地の写真か（名前の一致で選んでいるので、隣の寺や別の季節の催しが混ざりうる）。マージ前に一覧で見てほしい
6. **ホットリンク**（Commons のサムネイルを直接読む）でよいか（上の「これまでの方針との違い」）
