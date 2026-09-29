# Web を iOS 版（journey.photo）のデザインに揃える — 調査と方針（2026-09-27）

## 0. 前提の訂正（依頼文と事実が違ったところ）

| 依頼文 | 事実（確かめた方法） |
|---|---|
| アーティファクトの HTML は `docs/design/ios/` に配置済み | **このリポジトリのどのブランチにも `docs/design/` は無い**（106本の枝を `git ls-tree` で確認）。実物は **iOS リポジトリの `docs/design/ios-artifact/`（09-25 の写し・35画面）と `docs/design/ios-artifact-backup-2026-09-27/`（版 62ee・53画面・`DesignSystem.dc.html` を含む）** |
| 最新の作業は `check/handoff-2026-09-25` | **iOS の `main`（`3a383fd`・09-27）の方が新しく、handoff は `main` に取り込み済み**（`git merge-base --is-ancestor`）。`main` には handoff に無い `design/brass`（デザイン「黒塗りの真鍮」）が入っている。**handoff だけを見ると旧い色（黒＋白の透過・橙のアクセント）を写すことになる** |
| 色はライト／ダーク両方 | **iOS にライトは無い。** `RootView.swift:64` が `.preferredColorScheme(.dark)` で固定し、`WebTheme.swift` に「端末の明暗設定には従わない」と明記。`AccentColor.colorset` も `main` では真鍮 `#C9A66B` の1値だけ |
| トークンは Swift の Color / Font 定義から抽出 | Swift の値（`BrandPalette.swift`）とアーティファクトの `DesignSystem.dc.html` は**全色一致**。さらにシートには **Web 向けの書体の指定（「WEB」欄）まで書いてある**ので、両方を一次資料にした |
| ロゴを左寄せに | **Web は既に左寄せ**（`app/layout.tsx` のロゴの `<Link href="/">`・`justify-between` の左）で、寸法（マーク28px・serif 22px bold・間8px）もアーティファクトと一致。残る差はヘッダーの左右の余白（24px→16px）と地の色だけ（**2026-09-28 に両方対応**。余白は本文と同じ刻み＝スマホ実寸14px） |

**もう1つの重要な事実**: iOS の `WebTheme.swift` は、もともと **Web の `globals.css` を写したもの**
だった（コメントに明記）。その後 Web が紺＋青（2026-09-21 のモック）に変わり、iOS は
「0から考え直して黒＋白＋真鍮に決めた（**サイトも同じ値に揃える予定**）」と書いている
（`BrandPalette.swift`・`WebTheme.swift` の冒頭）。**今回の作業はその「予定」の実行**にあたる。

⚠️ **これは 2026-09-21 の owner の指示「モックと全く同じにしたい」（紺＋青・`docs/redesign-2026-09.md`）を
覆す。** シート自身が「紺はやめる」と書いているので新しい決定が優先と判断したが、
`docs/mockups/*.jpg`（紺＋青）は今回から**色については正ではない**。

### アーティファクト同士の矛盾（owner の判断が要る）

| 箇所 | `DesignSystem.dc.html` | `Main.dc.html`（同じ版 62ee） |
|---|---|---|
| 下部タブ | 全幅・選択中はラベルの下に **4px の真鍮の点** | **浮いたガラスのカプセル**（左右16・下22・高さ62・角丸31）・選択中は白16%の丸い面。点なし |
| 下線タブの非選択 | `#B8B8B8`（白72%） | 白60% |
| 既読のストーリーの輪 | `#666666` | 白18% |

iOS の実装はどちらでもない（標準の `TabView`・点なし）。**本書は `DesignSystem` を優先する**
（部品の規則を決めているシートで、画面の絵はそれを使った例、と読むのが自然なため）。
下部タブだけは見た目の差が大きいので、実装前に owner に確認する。

## 1. 画面の対応表

凡例: ◎ ほぼ同じ構造 ／ ○ 対応あり・構造差あり ／ ✕ 対応なし

| iOS 画面（アーティファクト） | Web の対応 | 状態 |
|---|---|---|
| 01 ホーム `Main` | `/` → `app/GalleryPageClient.tsx`・`TimelineCard.tsx` | ○ |
| 01b ホーム（テーマ参加済み）`MainThemeJoined` | なし（今日のテーマの機能が無い） | ✕ |
| 02 写真の詳細 `PhotoDetail` | `/photo/[id]` → `PhotoPageClient.tsx` | ○ |
| 03 旅の一冊 `TripBook` | なし | ✕ |
| 04 マップ `Map` | `/map` → `MapPageClient.tsx`・`MapControls.tsx` | ○ |
| 04b マップ（場所を選んだ）`MapPlace` | `MapSpotSheet.tsx`・`MapPhotoSheet.tsx` | ○ |
| 05 マイページ `MyPage` | `/users/[id]`（本人）→ `UserProfileClient.tsx` | ○ |
| 11 探す `Search` | `/search` → `DiscoverSections.tsx`・`FilterBar.tsx`・`ColorJourney.tsx` | ○ |
| 12 タグ・色・機材の写真 `TagPhotos` | `/tag/[t]`・`/camera/[c]`・`/category/[c]` → `CollectionPageClient.tsx` | ○ |
| 13 スポット `SpotDetail` | `/spots/[slug]` → `SpotGuideClient.tsx`（撮影地は `/location/[l]`） | ○ |
| 14 写真ビューア `PhotoViewer` | `GalleryModal/*` | ◎ |
| 15 お知らせ `Notifications` | `NotificationsBell.tsx`（パネル） | ◎ |
| 16 旅の記録 `Trips` | なし | ✕ |
| 旅行プラン `TripPlans`・`TripPlanDays`・`TripPlanPick` | `/trips` → `TripsClient.tsx` | ◎（Pick は Web では `<select>`） |
| 21 投稿の選択 `PostSheet` | `PostSheet.tsx` | ◎ |
| 22 新規投稿 `Upload` | `/user/upload` | ○ |
| 23 曲を選ぶ `SongPicker` | 独立画面なし（各画面に埋め込みの曲検索） | ○ |
| 24 ストーリーを作る `StoryComposer` | `stories/StoriesBar.tsx`（下書きモーダル） | ○ |
| 25 ストーリー `StoryViewer` | `stories/StoryViewer.tsx` | ◎ |
| 26 ストーリーの反応 `StoryInsights` | StoryViewer 内のパネル | ○ |
| 31 ユーザーのプロフィール `UserProfile` | `/users/[id]`（他人） | ○ |
| 32 プロフィールの編集 `ProfileEdit` | `/user/profile` | ○ |
| 33 写真を編集 `EditPhoto` | `/user/edit?id=` | ○ |
| 34 フォロー一覧 `FollowList` | `FollowingSheet.tsx`（シート） | ○ |
| 35 お気に入り `Favorites` | `/favorites` | ◎ |
| 36 アルバム `Albums` | `/user/albums` | ○ |
| 37 アルバムの招待 `Invite` | `/j` | ◎ |
| 38 ハイライト `HighlightPlayer` | `HighlightsRow` → StoryViewer | ◎ |
| 39 親しい友達 `CloseFriends` | なし | ✕ |
| 41 ログイン `SignIn` | `/login` | ◎ |
| 42 はじめる前に（同意画面）`LegalGate` | なし | ✕ |
| 43 設定 `Settings` | `/user/settings` | ○ |
| 44 パスワードを変える `ChangePassword` | 設定の中に埋め込み | ◎ |
| 45 ブロックした人 `BlockedUsers` | `user/settings/BlockedUsers.tsx`（埋め込み） | ◎ |
| 46 アカウントの削除 `DeleteAccount` | `DeleteAccountModal.tsx` | ◎ |
| 47 通報 `Report` | `ReportDialog.tsx` | ○（「この人をブロックする」が無い） |
| サイトメニュー `SiteMenu` | `HeaderNav.tsx` のドロワー | ◎ |
| ストーリーの派生（`StoryMine`・`StoryReplies`・`StoryViewerMenu`・`StoryDeleteConfirm` ほか） | `stories/*` | ◎〜○（個別には未精査） |
| 案の比較用（`MapOptionA/B/C`・`SpotPinOptions`・`VerifiedBadgeOptions`・`MyPageNoCover`） | — | 対象外（画面ではなく選択肢の見本） |

**iOS に対応が無い Web のルート**: `/category`・`/camera`・`/location`・`/spots`・`/spots/area/[area]`
の一覧ページ、`/signup`、`/terms`・`/privacy`（iOS はリンクで開く）、`/users/search`（iOS は探すの「人」）、
`/users?id=`、`/user/drafts`・`/user/archive`・`/user/highlights`、`/saves`・`/saved-spots`
（iOS はマイページのタブ）、`/admin/*`。**これらは SEO の面積（CLAUDE.md）なので消さない**。見た目だけ揃える。

## 2. デザイントークン（抽出結果）

**出どころ**: iOS `main`（`3a383fd`・2026-09-27）の
`Sources/JourneyPhoto/Core/Design/BrandPalette.swift`・`WebTheme.swift`・`JPFont.swift` と、
アーティファクト版 62ee の `docs/design/ios-artifact-backup-2026-09-27/DesignSystem.dc.html`
（「黒塗りの真鍮」2026-09-25）。**Swift とシートの値は全色一致**（突き合わせ済み）。

**規則（シートの1行）**: 白＝位置と選択、真鍮＝合図と手がかり。写真の上には白しか置かない。

### 2.1 色（ダークのみ）

| トークン（Web） | 値 | iOS 名 | 用途 | 比（下地に対して） |
|---|---|---|---|---|
| `--color-bg` | `#000000` | `background` | 下地（純黒・紺はやめる） | — |
| `--color-bar` | `#000000` | 同上 | ヘッダー（アーティファクトは `#000`） | — |
| `--color-surface` | `#121212` | `surface` | カード・チップ（白 7%） | — |
| `--color-surface-2` | `#1A1A1A` | `surface2` | 入力欄・副ボタン（白 10%） | — |
| `--color-line` | `rgb(255 255 255 / 0.12)` | `border` | 装飾の髪線（部品の縁には使わない） | 1.27 |
| `--color-outline` | `#666666` | `outline` | 入力欄・枠線ボタンの縁 | 黒 3.66 |
| `--color-text-2` | `#B8B8B8` | `muted2`（白72%） | 副文 | 黒 10.59 |
| `--color-text-3` | `#999999` | `faint`（白60%） | 注記・@名 | 黒 7.37 |
| `--color-chip-text` | `#D4D4D4` | `chipText` | 未選択チップの文字 | — |
| `--color-primary` | `#EBEBEB` | `primary`（白92%） | 写真を持つ画面の主ボタン・選択中チップ | 墨 16.74 |
| `--color-ink` | `#07090A` | `ink` | 白・真鍮の塗りに載せる文字 | — |
| `--color-accent` | `#C9A66B` | `accent`（真鍮） | 文字・点・輪・リンク・眉ラベル・フォーカス枠 | 黒 9.15 |
| `--color-accent-strong` | `#E3C98F` | `accentStrong` | リンクを押している間 | — |
| `--color-accent-fill` | `#B8955A` | `accentFill` | 写真の無い画面の主ボタン1つ（**上は墨**） | 墨 7.11／白 2.81✕ |
| `--color-accent-deep` | `#796440` | `accentDeep` | 白を載せる真鍮（トグル・地図の印） | 白 5.66 |
| `--color-accent-soft` | `#201B11` | `accentSoft` | 案内の帯（選択は担わない） | — |
| `--color-danger` | `#F0565A` | `danger` | 削除・通報・エラーの文字 | 黒 6.18 |
| `--color-danger-fill` | `#C8323A` | `dangerFill` | アカウント削除の確定だけ（白文字） | 白 5.29 |
| `--color-success` | `#7FC489` | `success` | トーストのアイコンだけ | — |
| `--color-location` | `#9CC3E6` | `location` | 地図の現在地だけ（黒 2px の縁） | — |

**ライトの値は存在しない。** iOS は `WebTheme` で「端末の明暗設定には従わない」と
明記し、`RootView.swift:64` で `.preferredColorScheme(.dark)` を固定、
アーティファクトも全画面が黒地。`AccentColor.colorset`（システム部品の tint）は
`main` では真鍮 `#C9A66B` の1値だけ（handoff の時点では明暗2値の橙
`#F29C66`/`#F9AD7A` だった）。**ライトを Web で作ると iOS に無いデザインを発明することになるので作らない**
（トークンを `:root` の変数に寄せておけば、iOS がライトを持った日に1か所で足せる）。

### 2.2 書体

| 役割 | iOS | Web（シートの「WEB」欄の指定） |
|---|---|---|
| 見出し | Shippori Mincho B1 Bold（18pt 未満に使わない） | **h1 だけ** Shippori 700 を自己ホスト。節の見出しは端末の明朝（0 KB） |
| 本文・ボタン | SF Pro＋ヒラギノ角ゴ | `system-ui`（**Inter を外す**） |
| 数字・眉ラベル | IBM Plex Mono 400/500 | IBM Plex Mono |
| ワードマーク | New York Bold 22・白1色・字間 -0.025em | `ui-serif, Georgia, serif` 700 22px（アーティファクトの指定） |

文字サイズ（シート）: 写真の題 30／画面の題・名前 26／カードの題 22／格子の題 18（明朝の下限）／
本文 17／ボタン・作者名 15 Semibold／注記 12／眉ラベル Mono 11・字間 0.16em・大文字。
アーティファクト全体の頻度: 12・13・11・15・10・14・16・18px。字間は 0.02em（タブのラベル）・
0.04em・0.16em（眉）・-0.025em（ワードマーク）。

### 2.3 余白・角丸・影・寸法

| 種類 | 値 |
|---|---|
| 画面の左右の余白 | 16px（ヘッダー `padding: 54px 16px 0`） |
| 押せるものの最小 | 44px（`minTapTarget`） |
| 写真の格子 | 隙間 4px・角丸なし・スマホ2列 |
| 角丸 | 丸（999px: ボタン・チップ）／22px（カード）／16px（シートの面）／12px（入力欄・小カード）／10px・8px |
| 主ボタン | 高さ 52px・左右 24px・16px 600 |
| 副ボタン（枠線） | 高さ 44px・`1px solid #666`・15px 600 |
| チップ | 高さ 32px・左右 14px・13px |
| 下部タブ | 浮いたカプセル（左右16・下22・高さ62・角丸31・`rgba(40,40,42,0.62)`＋blur 22px・縁 白14%・影 `0 8px 24px rgba(0,0,0,.45)`）。選択中は白16%の丸い面＋600 |
| 影 | `0 8px 20px rgba(0,0,0,.65)`（浮く部品）／`0 2px 6px rgba(0,0,0,.5)`（小）／`0 0 0 2px #000`（点・バッジの縁） |
| ストーリーの輪 | 2px 真鍮＋黒 3px の隙間（見た後は `#666`） |

## 3. 共通部品の差分

| 部品 | iOS／シート | Web の現状 | 規模 |
|---|---|---|---|
| ヘッダー | 地 `#000`・左右16px・ロゴ左・右に「探す」（ホームだけ）・お知らせ・メニュー（各44px・アイコン22px 線1.7・箱なし）・未読は8pxの真鍮の点＋黒2pxの縁 | **2026-09-28 に揃えた**: 地 `#000`・左右は本文と同じ刻み（スマホ `px-4`＝root 14px なので実寸14px・本文と揃える方を優先）・アバターを外した・探す／お知らせ／メニューを箱なしの44pxの丸い面＋アイコン22px 線1.7（`headerIcon.ts`）。未読は8pxの真鍮の点＋黒2pxの縁（数は読み上げの説明「未読 N 件」へ・2026-09-29）。残り: 「探す」はホームだけにするか（Web は全ページで `/users/search` へ。行き先も iOS と違う） | 小 |
| 下部タブ | ホーム／探す／投稿／マップ／マイページ。選択＝白（点かカプセルかは §0 の矛盾→§7 で案B） | **2026-09-28 に揃えた**: 浮いたカプセル（幅480で止める）・選択＝白＋白16%の面＋塗りのアイコン＋太字・非選択 白72%（`BottomNav.tsx`・`globals.css` の `.tabbar-capsule`）・ラベルも「探す」（英語は「My Page」。日本語は「マイページ」のまま）に。残り: PC 幅でヘッダーへ移す | 済（残り小） |
| 下線タブ | 15px・選択 白600＋2px の下線・非選択 `#B8B8B8` | ほぼ一致（`GalleryPageClient.tsx:566-584`・非選択 白60%） | 小 |
| ホームのカード | 写真を端まで・角丸なし・下に黒78%の幕・題は明朝22・「名前 · 2日前」・右下にいいねの丸（Mono 11） | 枠つきカード・上にアバター行・下に ♡/コメント/シェア/保存の行（`TimelineCard.tsx:148-285`） | 大 |
| 写真の格子 | 2列・隙間4px・角丸0 | スマホは一致（`GalleryGrid.tsx:111`） | なし |
| ボタン | 主＝白92%＋墨（写真のある画面）／真鍮＋墨（写真の無い画面の1つ）／枠線 `#666`／文字だけ＝真鍮 | 主＝青＋白文字が71か所（`bg-accent-fill text-white`） | 中（第1段で色、第2段で使い分け） |
| チップ | 高さ32・`#1A1A1A`＋白12%の縁・`#D4D4D4`／選択中 `#EBEBEB`＋墨600 | 選択中＝青＋白・非選択 白7%で縁なし（`FilterBar.tsx:271-324`） | 小 |
| アバター・輪 | 外寸62・2px の真鍮の単色＋黒3px の隙間・既読 `#666` | 64px＋2.5px の**Instagram 風グラデ**・既読 `#3a3a3d`（`stories/ring.ts`・`StoriesBar.tsx:1220`） | 小 |

## 4. 画面ごとの差分と規模（狭い画面）

**色・書体は第1〜2段で全画面まとめて変わる**ので、ここは構造の差だけ。

| 画面 | 主な差分 | 規模 |
|---|---|---|
| ホーム | ストーリーの輪の列がホームに無い（マイページへ移設済み・`GalleryPageClient.tsx:594`）・**今日のテーマのカードが無い**（iOS は端末で日付から決める `DailyTheme.swift`＝API 不要）・カードの形（§3） | **大** |
| 探す | 範囲タブ（すべて／写真／人／タグ／撮影地）が無い・節の順と題（「注目スポット」「色から探す」「機材から探す」）・「いまの季節の写真」が無い | 中 |
| タグ・色・機材 | 並べ替えタブ（人気／新着／撮影日）が無い・カードに撮影地と@作者 | 中 |
| マップ | iOS は全面の地図＋浮いた検索欄＋「みんな／自分の足あと／行きたい」＋「このエリアを検索」＋下の NEAR YOU カード。Web は文書の流れの中の地図（`h-[62vh]`）＋地図／リスト切替 | **大** |
| マップ（場所を選んだ） | 経路のボタン・「この付近で撮られた写真」 | 中 |
| マイページ | タブが **投稿／旅の記録／行きたい場所／お気に入り**（Web は投稿／年表）・「訪れた国・地域 · 距離」・居住地 | **大** |
| 他人のプロフィール | タブ 投稿／マップ・数字の順（フォロワー／フォロー中／写真） | 中 |
| 写真の詳細 | 撮影情報（絞り/SS/ISO の3格子＋CAMERA/LENS/FOCAL）のあとにタグ・末尾が「この近くで撮られた写真／地図で見る」（Web はコメント／関連写真のタブ） | 中 |
| 写真ビューア | ほぼ同じ | 小 |
| 撮影スポット | 見出しの下に **行きたい／地図で見る／シェア** の3ボタン・写真の節を上へ。Web にしか無い撮影ガイドの節は**残す**（SEO の本文） | 中 |
| 旅の一冊・旅の記録 | Web に無い。iOS は端末で計算（`TripBook.swift`・`TripShelf.swift`）＝**API 不要で作れる** | **大**（新規画面） |
| 旅行プラン | 一致。場所の選択が iOS はシート | 小 |
| お知らせ | 一致（Web はパネル） | 小 |
| 同意画面 | Web に無い。iOS は端末内に同意の版を持つだけ（`LegalConsent.swift`・`UserDefaults`）＝**API 不要**。ただし Web は「ログインせず見られる公開ギャラリー」なので、**出す場所（初回ログイン時か投稿前か）は owner の判断** | 中 |
| ログイン | ロゴと標語「旅の写真を、一冊の記録に。」 | 小 |
| 設定 | 節の構成と文言。iOS だけの項目（プッシュ通知・写真の控え）は Web に置けない／意味が違う | 中 |
| 新規投稿 | 公開範囲（誰に見せるか）・曲・アルバムの行 | 中 |
| 写真を編集 | 公開範囲の3択 | 中 |
| 親しい友達 | 画面が無い | 中 |
| 通報 | 「この人をブロックする」のチェック | 小 |
| フォロー一覧 | 全画面・タブ切替・行ごとのフォローボタン | 小〜中 |
| プロフィールの編集 | カバー・居住地・Instagram | 中 |
| アルバム | 招待リンクを貼って参加する欄 | 小 |
| その他（ストーリー作成・反応・曲選び・削除・ブロック・パスワード） | 独立画面か埋め込みかの差。中身はほぼ同じ | 小 |

### 文言（iOS の `L("…")` と違うもの・主なもの）

iOS の文言は `Localizable.strings`（権限の説明だけ・11行）ではなく、**コード内の `L("日本語", "English")` 952か所**と
`Labels.swift` が実体。目立つ差:

| 場所 | iOS | Web |
|---|---|---|
| 下部タブ | 探す／My Page（英） | 探す／My Page（英）（2026-09-28 に揃えた。日本語はどちらも「マイページ」） |
| ヘッダー | 探す・お知らせ・メニュー | ユーザーを探す・通知・メニューを開く |
| ホームのタブ（英） | Latest | New |
| 探す | 探す・色から探す・機材から探す・注目スポット | 写真をさがす・色でさがす・機材からさがす・写真の多い撮影地 |
| マイページ | 写真をつないだ距離・訪れた国・地域 | 総移動距離 |
| 写真の詳細 | 共有・通報する・編集／削除（別々）・この近くで撮られた写真・コメントを書く | シェア・この投稿を通報する・この写真を編集・削除・関連写真・コメントを追加… |
| 設定 | パスワードを変える・問い合わせ・アカウントの削除 | パスワードを変更・お問い合わせ・退会（アカウント削除） |

⚠️ **「さがす」→「探す」は `app/__tests__` の文言テストや SEO の題に波及しうる**ので、文言は画面ごとの段で
その画面のテストと一緒に直す（一括置換しない）。

## 5. Web 側だけで完結しない差分（API は変えない）

**調べた結果、ほとんどは API 側に既にある。** 「公開範囲」「親しい友達」「限定公開の一覧」は
`api-user` が実装済み（`api-user/src/closeFriends.ts`・`restrictedFeed.ts`・`upload.ts`・`photoUpdate.ts` が
`audience` を扱う）で、**Web が呼んでいないだけ**。`app/user/upload/page.tsx:1954` の
「データにもAPIにも無い」というコメントは古い。

本当に Web だけでは埋まらないもの:

| 差分 | 理由 | 提案 |
|---|---|---|
| 招待画面の「N枚」 | サーバーが写真の枚数を返さない（消えた写真の ID を持ち続けるので数えると嘘になる・`app/j/page.tsx:132`） | 出さない（今のまま） |
| プッシュ通知の切り替え | ネイティブの通知。Web の設定画面に置いても効かない | 置かない（Capacitor で包むときに足す） |
| 写真の控え（データとストレージ） | iOS の端末保存。Web の相当は Service Worker（別物） | 置かない |
| 絞った写真の画像を `private/` へ移す | Lambda に `private/` の権限が無く、CloudFront に `/private/*` の振る舞いも無い見込み。権限だけ足すと移した画像が 404 になる（`docs/restricted-image-delivery.md` の「もう1つ」・2026-09-28） | owner が `setup-private-delivery.sh --apply` を流してから、権限と投稿時の移動を入れる。**それまで絞った写真の画像は URL を知っていれば取れる**（iOS も同じ） |
| 投稿時の曲 | `/upload/save` が `song` を受け取らない（`upload/page.tsx` のコメント。iOS も投稿後に付ける経路のはず・未確認） | 投稿後に写真ページで付ける今の経路のまま |

## 6. 着手順（提案）

各段は **1コミット5〜8件まで・コミットごとに差分レビュー・`npm run verify` 緑** で進める（CLAUDE.md）。

1. **第1段 色トークン**（本 PR で実施）— `@theme` を真鍮のパレットに差し替え。塗りの上の文字を墨へ。
   直書きの紺・青（地図のピン・`themeColor`・マニフェスト）を追従。値を縛るテストを新しい規則に書き換え
2. **第2段 書体トークン** — 本文を system-ui に（Inter を外す）・数字を Plex Mono・h1 を Shippori。
   `fontStack.test.ts` の書き換えを伴う。**明朝の webfont は日本語で数MB**なので、表示速度（CLAUDE.md の
   最優先）との釣り合いを測ってから入れる
3. **第3段 共通部品**（2026-09-28 着手: 下部タブ・ヘッダーは済。§3 の表を参照）— 残りは
   チップ・ボタンの白／真鍮の使い分け・ストーリーの輪
4. **第4段 ホーム** — カードの形・ストーリーの列・今日のテーマ
5. **第5段 残りの画面**（規模の小さい順）: 探す → タグ → 写真の詳細 → スポット → マイページ → マップ →
   新規画面（旅の一冊・旅の記録・同意画面・親しい友達）

**PC 幅**: 下部タブは `md:` 以上で隠し、同じ5項目をヘッダーの中の横並びに出す
（左サイドバーは写真の格子の幅を削るので採らない）。これは第3段で行う。
**ジェスチャー**: iOS のスワイプ（ストーリー送り・写真送り・シートを下げて閉じる）は、Web では既に
ボタン＋矢印キー＋Escape で代替している（`ModalKeyboardHelp.tsx`）。新しい画面も同じ作法にそろえる。

## 7. owner の決定（2026-09-27）

見た目の比較は https://claude.ai/artifact/8fxwyp2hVD2aQhKAqZYpBa （案ごとの絵）。

| 判断 | 決定 | 意味 |
|---|---|---|
| 下部タブの形 | **案B 浮いたカプセル**（`Main.dc.html`） | 左右16・下22・高さ62・角丸31・`rgba(40,40,42,.62)`＋blur 22px・縁 白14%。選択中は白16%の丸い面＋ラベル600。**§0 の「DesignSystem を優先」はタブについてだけ覆る** |
| 同意画面を出す場所 | **案A 初めてログインしたとき** | 見るだけの人には出さない。同意の版は端末（`localStorage`）に持つ＝iOS の `LegalConsent`（`UserDefaults`）と同じ形・API 変更なし |
| 紺＋青のモック | **黒＋真鍮に置き換えてよい** | `docs/mockups/*.jpg` は**色については正ではない**（配置・部品の手本としては残る） |

**実装で §7 の値から外したところ（2026-09-28・owner の「確認は不要」の委任で判断）**:
透けた写真を `brightness(0.6)` で暗くし、非選択のタブを白60% → 白72%（DesignSystem の非選択 `#B8B8B8`）にした。
§7 の値（62%・ぼかしだけ・白60%）のままだと、**真っ白な写真の上で非選択のラベルが 2.62:1・選択中の10pxラベルが 3.23:1**
（基準 4.5:1）。変更後は最悪でも 4.93:1・5.06:1。暗い写真の上では見た目は変わらない（黒は暗くしても黒）。
`saturate(160%)` は比較用アーティファクトの案B の絵がそう書いている値。戻すなら `.tabbar-capsule` の1行。
