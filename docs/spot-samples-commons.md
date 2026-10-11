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
  決まり文句（「…と推定されます」「Own work」「投稿者自身による著作物」「Unknown author」「Unknown Unknown」「不明」）、
  お願い文（「please credit…」「I would appreciate…」「This Photo was taken by X . Feel free…」）、署名の日時（`(UTC)`）、80字を超えるもの。
  ただし英語の決まり文句「No machine-readable author provided. X assumed …」は推定された名前 X を出す
  （2026-10-11・下の「作者の表記の整え方」）。日本語版の「…だと推定されます」とお願い文は #272 の判断どおり名前にしない。
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
- **作者の表記の整え方**（`cleanCommonsAuthor`・2026-10-11 に規則を足した。作例と代表写真・アプリの索引で同じ1本。
  確定ファイルの値は書き換えず、表示の手前で整える）:

  | 欄の書き方 | 出す表記 |
  |---|---|
  | `w:en:Colin Keigher ( talk \| contribs )`・`Pradana Aumars ( talk · contribs )`・`さかおり ( talk` | 名前だけ |
  | `en:User:Adamsan`・`nl:User:GerardM`・`ja:User:NEON / User:NEON_ja` | `Adamsan`・`GerardM`・`NEON / NEON_ja` |
  | `[[User:\|Patricia Santos]]`・`[//commons.wikimedia.org/wiki/User:Trantuonglam Trantuonglam]` | 見える字（`Patricia Santos`・`Trantuonglam`） |
  | `(The) original uploader was X at en.wikipedia`・`… at English Wikipedia .` | `X` |
  | `No machine-readable author provided. Zivax assumed (based on copyright claims).` | `Zivax`（日本語版の「…だと推定されます」は名前にしない＝#272） |
  | 署名 `-- [[利用者:あおもりくま\|あおもりくま]] （ 会話 ） 2020年11月21日 (土) 01:16 (UTC)`・`さかおり ( talk ) 07:54, 23 February 2010 (UTC)` | `あおもりくま`・`さかおり` |
  | `Foto: Reinhard Kraasch , Lizenz: CC-BY-SA 4.0 DE`・`© El Grafo / CC-BY-SA-4.0`・`© Giles Laurent , gileslaurent.com , License CC BY-SA` | ライセンスの文だけ落とす（`Reinhard Kraasch`・`© El Grafo`・`© Giles Laurent , gileslaurent.com`）。ライセンスは同じ行に別に出る。`©` は作者の求める表記なので残す |
  | 権利者の宣言 `X from ja , the copyright holder of this work, hereby publishes it…` | `X` |
  | 作者のお願い文 `This Photo was taken by X . Feel free to use my photos…`・`X You are free to use this picture …` | **名前にしない**（#272 の判断どおり。CC BY 系は出さない） |
  | `Unknown Unknown`・`Unknown author Unknown author`・`Unknown photographer` | 名前ではない（CC BY 系は出さない・PD/CC0 は「作者不明」） |
  | **URL だけ**（`https://www.flickr.com/photos/jiuguangw/`） | **そのまま残す**。Flickr から移した写真で作者を指す唯一の表記（CC BY 4.0 は作者の情報への URI での表示を認める）。Flickr のユーザー名に書き換えると、表示名ではない URL の一部を名前と取り違えるおそれがある |
  | 変えないもの | `X at Japanese Wikipedia`（作者の求める表記）・`FOTO:FORTEPAN / …`（Fortepan の求める表記）・`--sinava-- from Berlin`・`Marie-Lan Nguyen ( User:Jastrow )` |

  確定ファイルの全部（作例 16,000 余り・代表写真 2,670 行）に当てて、表示が変わったのは作例 87 枚・代表写真 67 件
  （アプリの索引も同じ 67 件。パノラマの自由で外した imjingak は数えない）。新しく出るようになった作例は無い。
  名前ではない欄の CC BY-SA の代表写真 2 件（omazaki の `Own work`・roman-forum の Wolfgang Moroder のお願い文）は
  出さなくなった（それまで代表写真には名前でない欄の見張りが無かった。PD・CC0 は「作者不明」）
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
と決めてある（`scripts/localize-spot-images.mjs` で縮小版を `public/` に置く。アプリ用の小さい版（`thumb/`）は
そのとき・本番のビルドのときに自動で作られる。揃っているかは `node scripts/spot-thumbs.mjs --check`）。作例は依頼どおり
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

## 作例から代表写真を埋める（2026-10-11）

owner の方針「検索で見つけてもらう」「写真が無くても役立つ撮影ガイド」。公開済みのうち代表写真
（`content/spot-images.json`・Wikidata の P18）が無い・場所の確認が無くて出せないスポットに、作例から1枚を
代表写真に上げた（`npx tsx scripts/promote-sample-covers.ts`。`--dry-run` で数えるだけ）。

- **上げてよいのは、写真を1枚ずつ見てその撮影地の景色と確かめた作例だけ**（`pickedBy` が "visual-review"
  か人の名前・`isReviewedPick`）。"auto"（名前の一致と距離だけ）は上げない。判定は `coverCandidateSample`
  （`lib/data/spotSamples.ts`）で、画面に出せる1枚（`toSpotSample`）・人や催しが主役でない・Commons の写真・
  横長を先に
- 行は `spot-images.json` に `method: "commons-sample"`・`pickedBy`（作例の写し）で書く。作者・ライセンスは
  画面の作例と同じ表示の形（PD は "Public domain (PD-self)"）。置き換えた P18 の記録は `replaced` に残す。
  出すかの判定は `shownSpotImage`（`pickedBy` が "auto" なら出さない）
- 縮小版は `localize-spot-images.mjs` の `localizeImage` で置く（横 960px・EXIF を残さない）。
  取りにいくのは作例が画面で既に読んでいる Commons の 1280px の縮小版だけ・3秒に1回
- `fetch-spot-images.mjs --refresh` は上げた行を上書きしない（取り直した P18 は `replaced` へ）
- **作例と代表写真で扱いが違う**（2026-10-11 レビュー）:

  | | 作例 | 代表写真（作例から上げたもの・Wikidata の P18 とも） |
  |---|---|---|
  | 画像 | Commons の縮小版を**直接読む**（こちらは複製しない） | **サイトに縮小版の写しを置く**（`public/images/spots/<slug>.jpg`・横 960px・EXIF なし） |
  | 画面 | 元の縦横比のまま（切り抜かない） | ページの頭の枠に合わせて**切り抜いて表示**（`object-cover`） |
  | 出典の行 | 「題 / 写真: 作者 / ライセンス / Wikimedia Commons」 | 同じ形の最後に「（一部を切り抜いて表示）」（英語 "cropped for display"）。CC 4.0 の「変更の表示」 |

  写しを置くのは「代表写真は外部へホットリンクしない」という前からの決まり（`SpotCoverImage.src`）。
  縮小は改変にあたらない、切り抜いて見せるのは表示の上の変更として明記する、という整理（**owner に確かめてほしい**）
- 代表写真も**題**を出す（`SpotCoverImage.title`・ファイル名から）。CC BY / BY-SA 1.0〜3.0 は題が表示の条件。
  アプリ向けの索引の `image.title` にも入る（古い `spots.json` には載せない）
- アプリ向けの本文（`/app/data/spots/<slug>.json`）の作例は、代表写真と同じ1枚を除く（画面と同じ）
- パブリックドメインのうち **PD-Detroit**（アメリカでの出版年による）と **PD-author-FlickrPDM**（Flickr の
  Public Domain Mark＝権利者の放棄ではない）は、作例でも代表写真でも出さない（`isUnusablePublicDomain`）。
  2026-10-11: 作例 14 枚（9 か所）が外れ、代表写真 2 件（las-medulas・st-michaels-mount）を別の作例に替えた
- 人が確かめた Wikidata の代表画像（`reviewedBy`）を持つ行は、作例から上げない（`isPromotionTarget`）
- **2026-10-11 の埋め足し**: 公開 1,782 か所のうち代表写真が無かった 145 か所（作例が "auto" か Flickr だけ 139・作例なし 6）の
  作例を1枚ずつ見て、その場所の景色と確かめた1枚を "visual-review" にし、上げた（113 か所）。作例に良い1枚が無い
  所は Commons を名前で探し、同じ規則（`parseCommonsPages`・大きさ・3:1 まで・注意書きなし）を通った1枚を
  "visual-review" の作例として足してから上げた（7 か所）。人の目で外した写真（`spot-samples-excluded.json`）は使わない。
  代表写真 1,637 → 1,757 / 1,782。残り 25 か所は付けていない:
  - 🔴 **古いアプリの `spots.json` の上限（1,000,000 バイト・`spotFeedShards.test.ts`）に収めるため**、確かめた中で
    弱い 16 か所は上げなかった（米子水鳥公園・日立駅・リトルワールド・岡村島・亀老山・橋立鍾乳洞・氷川神社の参道・
    都井岬・筒賀の大銀杏・高尾山・那谷寺・生石高原・大石林山・シベリウス公園・玉造温泉・霧降ノ滝）。固定の行で
    代表写真が1件増えるたびに約 270 バイト増える。上げた後の大きさは 999,633 バイト（残り 367 バイト）＝
    **固定の行にこれ以上代表写真を足すと上限を超える**。足すなら上限か古い `spots.json` の中身（例: 画像の出典
    URL）を先に決める
  - Commons に使える写真が無い（芦津渓谷・大源太湖・花園渓谷・星野村の茶畑・真栄田岬）、図柄が映画・アニメの絵
    （行田の田んぼアート）、駐車場・看板しか無い（海洋堂ホビー館）、外観の良い写真が無く展示物の写真は人の目で
    外してある（九州陶磁文化館）、建物の著作権が切れていないフランスの建物（ロンシャンの礼拝堂・ル・コルビュジエ）
- **2026-10-11 の海外 753 か所**（#357 で公開した米州・オセアニア・南アジア・中東・アフリカ 452 と
  ヨーロッパ 301。作例も代表写真も無かった）: 作例を集め、代表写真を付けた。
  - 作例: `collect-commons-samples.mjs` と同じ収集（`collectSpotCandidates`・`parseCommonsPages`・`pickSamples`・
    人の目で外した写真は使わない）。753 か所は `spot-images.json` に Wikidata の行が無いので、台帳の
    `aiCheck.sources` にある Wikidata の Q-ID を探す手がかり（P18・P373・P180・座標）に使った（`spot-images.json` には書かない）。
    **流し直したのは 753 か所だけ**で、ほかのスポットの候補・確定の行は変えていない（`--slug` で流すと確定ファイルを
    全件選び直し、候補ファイルの人が外した写真も書き換わるため、一度だけの小さな台本で 753 か所分だけを足した）。
    要求は Commons と Wikidata に計 約2,140 回・2秒に1回・429 は 0 回。palenque だけは P373 のカテゴリに PDF が混ざり
    API が失敗したので、カテゴリを除いて集め直した
  - 確定ファイルに 753 か所・4,475 枚（画面に出るのは 4,348 枚。アメリカ政府の PD などは表示で落ちる。根拠の決まらない PD の 2 枚は確定ファイルから外した）。
    候補ファイルにも 753 か所を足した（約 6MB 増）
  - 代表写真: 作例の上位を縮小版（横 330px）で1か所ずつ目で見て、その場所の景色と確かめた1枚を "visual-review" にし、
    上げた（**731 か所**。米州など 436・ヨーロッパ 295）。上位3枚に良い1枚が無い所は候補の 10 枚まで見て選び、
    うち 34 枚は候補から "visual-review" の作例として足した（`bigEnough`・3:1 まで・注意書きなしを通るものだけ）。
    古い `spots.json`（固定の 1,079 行）には入っていないので、大きさは 999,633 バイトのまま
  - 付けなかった 22 か所:
    - 著作権の残る現代建築・作品（パノラマの自由が無い国、または作品そのもの）15: UAE の 6 か所（エミレーツ・パレス・
      ドバイフレーム・フェラーリ・ワールド・ヤス・マリーナ・サーキット・シャールジャ・ジュメイラ・モスク）、
      エジプトの大エジプト博物館・新アレクサンドリア図書館、モロッコのハサン2世モスク（1993）、フランスのパレ・デ・フェスティバル（1982）・
      オペラ・バスティーユ（1989）・シテ・ド・レスパス（1997）、マドローダム（模型が作品）、イマジン・ピース・タワー（現代美術）、
      サルベーション・マウンテン（作品そのもの・アメリカは美術にパノラマの自由が無い）
    - その場所と分かる良い写真が無い 5: フォート・バンクーバー、エーア湖国立公園、マダバ、アジュルン（城の写真が無い）、ブダペスト東駅（駅舎の正面が無い）
    - 景色の写真がアメリカ政府の PD だけ（日本では使わない）2: ボエジャーズ国立公園、モンロー砦
  - 代表写真 1,757 → 2,488 / 2,535。画像は代表 731 枚 約 89MB・小さい版 731 枚 約 9.7MB
- **パノラマの自由が無い国の現代建築**（2026-10-11・#362 の UAE の判断を既存の代表写真にも当てた）:
  写真のライセンスが自由でも、写っている建物・作品の著作権（建築家・作者の死後 50〜70 年）は別にある。
  パノラマの自由（公共の場に恒久的に置かれた建物・作品を撮った写真を自由に使える決まり）が無い国では、
  **建物・作品が主役の写真**は権利者の許しが要る。Commons の決まり（2026-10-11 に読んだもの）:
  - `Commons:Copyright rules by territory/United Arab Emirates` の FOP: **使える定めなし**（放送だけ）。
    1993 年3月より前に建った建物だけ使える
  - `Commons:Copyright rules by territory/South Korea` の FOP: **非営利に限る**＝Commons では使えない扱い
    （著作権法 35 条2項4号「複製物の販売のため」は除かれる）。橋は独特な造形でなければ使える
  - 国ごとの表 `Commons:Freedom of panorama/table`: 建物に赤（使えない）の国は 107。代表写真のある国では
    フランス・イタリア・ギリシャ・バチカン・韓国・ベトナム・インドネシア・スリランカ・ヨルダン・UAE・モロッコ・
    エジプト・アイスランド・スロベニア・カンボジア・フィリピン・ジョージア・ラオス・ウズベキスタン・ネパール・
    南アフリカ・タンザニア（代表写真 480 件）

  探し方: 上の国の代表写真 480 件から、自然・遺跡の分類を除き、要約に 20 世紀以降の年や「タワー」「現代」
  などのあるもの、建物・橋・展望台・博物館などの分類のものを機械で抜き（約 150 件）、縮小版を目で見て
  「著作権の残る建物・作品が写真の主役か」を決めた。古い建物（作者の死後 70 年を過ぎたもの）・建物が
  遠景の景色・山は残した。**25 件の代表写真を外した**（`content/spot-cover-exclusions.json`＝`NO_FOP_COVER_EXCLUSIONS`・`lib/data/spotImages.ts`。
  理由を1件ずつ書いてある）:
  - UAE: ブルジュ・ハリファ
  - 韓国: Nソウルタワー・ロッテワールドタワー・東大門デザインプラザ・臨津閣・汝矣島公園（主役が高層ビル群）・
    海東龍宮寺（主役が現代の石塔）
  - ベトナム: ランドマーク81・京南ランドマーク・ドラゴン橋・統一会堂・戦争証跡博物館・スイティエン公園（門の造形）
  - インドネシア: イスティクラル・モスク・赤道記念碑（1990 年の覆いの建物）
  - アイスランド: ペルトラン　南アフリカ: アパルトヘイト博物館　ウズベキスタン: 国立歴史博物館（1970）
  - ジョージア: 至聖三者大聖堂（2004）　フィリピン: マニラ大聖堂（1958 の再建）　ネパール: ナラヤンヒティ宮殿
  - フランス: トゥール・モンパルナス・ミヨー橋・ルーヴル（主役がピラミッドの夜景）・シャイヨ宮（1937）

  外したスポットは建物そのものが撮影地で、建物が主役でない別の1枚には替えられないので、**替えずに外した**
  （代表写真 2,488 → 2,461 / 2,535。作者の欄の 2 件を含む）。行は `spot-images.json` に残し（`local` だけ消す）、
  縮小版とサムネは消した。`shownSpotImage` が出さず、`coverCandidateSample` が作例から上げ直さず、`localize-spot-images.mjs` も置き直さない。
  残したもの（迷ったもの）: 広安大橋（2002・普通の吊り橋で夜景の照明つき。韓国の橋の扱い）・ハン川橋（景色の中）・
  ガルーダ・ウィシュヌ・ケンカナ（石灰岩の切り通しの広場で像は写っていない）・エッフェル塔（昼の写真。夜の照明は別の権利）・
  エギーユ・デュ・ミディ（山）。
  🔴 **作例はまだ同じ建物の写真を出している**（例: ブルジュ・ハリファの作例 6 枚・#362 で外した UAE の 6 か所の作例も）。
  作例の扱いは owner に確かめる（下の「owner が確かめること」）
- 見張り: `lib/data/__tests__/spotCoverFromSamples.test.ts`（上げた行が作例の確定ファイルの
  確かめた1枚と一致・縮小版が在る）
- 構造化データの代表写真は作者・ライセンスつきの `ImageObject`（`coverImageObject`）。
  画像サイトマップ（`/sitemap-images.xml`）にも撮影地ページの代表写真と作例を載せる

## owner が確かめること（法的な最終確認）

1. **作者表示の形**（「写真: 作者 / ライセンス / Wikimedia Commons」）で、CC BY / BY-SA の表示条件を満たすと判断してよいか
2. **CC BY-SA の写真を並べて載せても、ページ全体に継承が及ばない**という整理でよいか
3. **題はファイル名でよいか。** CC BY / BY-SA の 2.0〜3.0 は題（作品名）の表示を求める（4.0 では求めない）。
   確定ファイルには 2.0〜3.0 の写真が多く混ざるので題を出すことにしたが、Commons のファイル名を
   題とみなしてよいかは owner に確かめてほしい
4. **人物が写る写真**（肖像権・パブリシティ権）と、**建物・美術品の写真**（日本の著作権法 46 条の範囲・寺社の撮影規約）を商用サイトに出してよいか。Commons のライセンスは撮影者の著作権だけを扱い、写っている側の権利は扱わない
5. **自動で選んだ作例**が本当にその撮影地の写真か（名前の一致で選んでいるので、隣の寺や別の季節の催しが混ざりうる）。マージ前に一覧で見てほしい
6. **ホットリンク**（Commons のサムネイルを直接読む）でよいか（上の「これまでの方針との違い」）
7. **パノラマの自由が無い国の現代建築の作例**（2026-10-11）。代表写真は 25 件外した（上の「パノラマの自由が無い国の現代建築」）が、
   同じ建物の作例（ブルジュ・ハリファ・#362 で代表写真を付けなかった UAE の 6 か所など）は出したまま。作例も外すか
