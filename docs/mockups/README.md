# 最終版モック（2026-09・owner 提供）— 🔴 旧版

> **2026-09-26 owner 指示: これは旧版。参照しない。**
> デザインの正は Artifact「journey.photo iOS」
> （https://claude.ai/artifact/XN38zw2BHegEU7SuxgKrr6 ・黒塗りの真鍮）。
> ファイル名とシートの「最終版」は 9/21 時点の呼び名で、その後に置き換わった。
> 下の本文は当時の記録として残している（`CLAUDE.md` の「デザインの正」節）。

owner が出した「◯◯画面（最終版）」の注釈つきシート10枚。**これがデザインの一次資料**。

それまでは会話の履歴の中にしか無く、セッションが変わると読めなくなっていた
（一度 transcript の JSONL から拾い直している）。**リポジトリに置いて、
どのセッションからも同じものを見られるようにする。**

| ファイル | 画面 | 実装 |
|---|---|---|
| `01-home.jpg` | ホーム | `app/GalleryPageClient.tsx`・`app/components/TimelineCard.tsx` |
| `02-search.jpg` | さがす | `app/search/**` |
| `03-photo-detail.jpg` | 写真詳細 | `app/photo/[id]/PhotoPageClient.tsx` |
| `04-mypage.jpg` | マイページ | `app/users/UserProfileClient.tsx` |
| `05-notifications.jpg` | 通知 | `app/components/NotificationsBell.tsx` |
| `06-map.jpg` | 撮影地マップ | `app/map/**`・`app/components/PhotoMap.tsx` |
| `07-post-create.jpg` | 投稿作成 | `app/user/upload/page.tsx` |
| `08-story-create.jpg` | ストーリー作成 | `app/components/StoriesBar.tsx` |
| `09-story-view.jpg` | ストーリー閲覧 | `app/components/StoryViewer.tsx` |
| `10-spot-detail.jpg` | 撮影スポット詳細 | 未実装（スポットマスタが要る） |

## 読むときの決まり

- **架空の数字は写さない。** シートの「12.4万 フォロワー」「4.8（312件）」
  「1.2K 投稿写真」などは絵で、実データが無いものは**出さない**
  （owner の指示書 2026-09-22）。持っていない項目は**欄ごと出さない**。
- **スマホはシートのとおり。PC は別に設計する**（横に引き伸ばさない）。
- **大きさは画素から測る。** シートの端末画面の幅を 393px として比を取る。
  例: `04-mypage.jpg` は画面が x=314..677（364px）＝ 1画素 ≈ 1.08 CSS px。
  文字は字の墨の高さから逆算する（数字の大文字高 ≈ 0.72em・漢字 ≈ 0.88em）。
- 注釈（右側の1〜9）は**仕様の文**。番号と画面の場所が対応している。
