# 写真の無い撮影スポット 166 か所の、自由に使える写真の候補（2026-10-04 調査）

**調べただけ。台帳（content/spot-samples.json・content/spot-images.json）は変えていない。**
載せる前に、1枚ずつ目で選ぶこと（下の「品質」）。

## 対象
本番の索引（app/data/spots.json）で、表紙の写真（image）も作例（content/spot-samples.json）も無い 166 か所（targets.json）。

## 結果（いちばん確かな候補の段で分けた か所数）
| 段 | か所 | 中身 |
|---|---|---|
| 1 | 86 | Wikidata の代表写真（P18） |
| 2 | 31 | その場所の Commons の分類（P373）の写真 |
| 3 | 42 | 2km 以内で名前が当たる写真・ja/en Wikipedia の記事に使われている写真 |
| 4 | 6 | 名前の全文検索だけ（外れが多い） |
| — | 1 | 何も無い（芦津渓谷） |

候補は計 5,038 枚。ライセンスは作例と同じ決まり（CC0・PD・CC BY・CC BY-SA。NC・ND・作者が名前でないものは落とした。PD-US は判定できる分だけ落とした）。
ほかに Openverse（Flickr 等の CC）で 110 か所、OpenPhoto（自治体の CC BY 4.0）で 11 か所に候補。

## 前回 0 枚だった理由
半径 500m・台帳の座標は約1km に丸めてある。効いたのは:
1. Wikidata の P18 と P373（分類の中身）
2. 位置検索 2km ＋ 名前が当たるもの
3. Wikipedia の記事に使われているファイル

## 品質（目で見た 11 枚）
1枚目がそのまま使えたのは 8 枚。3 枚は近いが主役でない（滝でなく山、桜の堤でなく近くの道、湖でなくダム）。
全文検索だけの候補には明らかな外れ（「永源寺」という桜の品種、クロード・モネの絵）。

## ファイル
- candidates.json — スポットごとに段の順で最大20枚（title・pageUrl・thumbUrl・width・height・license・author・sources・tier）、openverse・openphoto
- research.py / research2.py / openphoto.py — 調べた処理（読むだけ・Commons には 2.5 秒に1回）
