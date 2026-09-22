# `content/` — 人が書くもの

**ここに在るのは、人が手で書いてコミットするファイルだけ。**

`app/data/*.json`（`photos.json` / `photo-index.json` / `profiles.json`）と
混ぜないために分けてある。あちらは **`npm run build` のたびに
`scripts/sync-photos-from-ddb.js` が DynamoDB から作り直す**
（＝手で書いた行を置いても次のビルドで消える）。

| | `app/data/` | `content/`（ここ） |
|---|---|---|
| 誰が書くか | ビルド（DynamoDB から） | 人 |
| ビルドで上書きされるか | **される** | されない |
| 直し方 | 本番のデータを直す | このファイルを直して PR |

## `spot-master.json`

撮影スポット（`/location/<スラッグ>`）の、**写真からは導き出せない情報だけ**。
形と規則は `lib/data/spotMaster.ts` と `docs/spot-master.md` にある。

```jsonc
[
  {
    "slug": "香川県-観音寺市-高屋神社",  // /location/<スラッグ> と同じ綴り
    "reading": "たかやじんじゃ",          // ふりがな（導出できない）
    "summary": "…",                      // 人が書いた概要（生成しない）
    "aliases": ["天空の鳥居"]            // 表記ゆれ（任意）
  }
]
```

**空の配列でよい。** 書かれていない項目は**画面に枠ごと出ない**
（`spotMaster.test.ts` と `SpotPageClient.test.tsx` が固定している）。
