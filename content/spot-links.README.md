# 写真とスポットの紐付け（人が承認したものだけ）

`content/spot-links.json` は、**人が実際に写真を見て「この地点で撮った」と
判断した紐付け**の台帳です。`scripts/link-photos-to-spots.ts --apply` は
**ここに載っているものしか書きません**。

## なぜ機械に決めさせないか

撮影地の名前が台帳と一致しても、そこで撮った証拠になりません。

- 富士山は**20km 先からでも撮れる**（被写体の地点 ≠ 撮影の地点）
- 同じ名前の神社・公園・駅が各地にある。**台帳に1件しか無くても、
  台帳が未完成なだけ**かもしれない
- 「京都」「北海道」のような**広い地域名**が撮影地に入っていることがある

機械が出せるのは候補までです（`要確認` / `曖昧` / `対象外`）。

## 書き方

```json
[
  {
    "photoId": "uploads/<uid>/<name>.jpg",
    "spotId": "sp_takaya",
    "confirmedBy": "rymaruta",
    "confirmedAt": "2026-09-22T09:00:00Z",
    "evidence": "写真に社殿と鳥居が写っている。撮影者に確認済み"
  }
]
```

`confirmedBy` / `confirmedAt` / `evidence` は**どれも必須**です。空だと断ります。
あとから「なぜこの写真にこのスポットが付いているのか」を辿れないと、
間違いを見つけても直す手がかりがありません。

## 書き込みのときに断るもの

承認があっても、次に当たるものは書きません（`selectApplicableLinks`）。

| 断る理由 | なぜ |
|---|---|
| その写真が無い | 消された・IDの打ち間違い |
| 既に spotId が付いている | 人が直したものを巻き戻さない |
| spotId が台帳に無い | 綴りの間違い・台帳から消えた |
| いまは曖昧な候補 | 承認のあとに同名のスポットが増えた |
| 承認した先と、いまの候補が違う | 承認のあとに撮影地が書き換わった |
| いまは候補に挙がらない | 撮影地が空になった |
| 同じ写真が2回 | どちらが正しいか機械には決められない |

**承認は「あの時点の判断」**でしかないので、書く直前にもう一度突き合わせます。

## 手順

```bash
# 1. 下見（何も書かない）
PHOTOS_TABLE=prod-photo-gallery-photos npx tsx scripts/link-photos-to-spots.ts

# 2. 「要確認」に出た写真を人が見て、上の形で spot-links.json に書く

# 3. 書き込む（承認したものだけ・断ったものは理由つきで出る）
PHOTOS_TABLE=prod-photo-gallery-photos npx tsx scripts/link-photos-to-spots.ts --apply
```

書き込むときは `spotId` のほかに `spotLinkedBy` / `spotLinkedAt` /
`spotLinkEvidence` も一緒に残します。**撮影地の文字列はどれも消しません。**
