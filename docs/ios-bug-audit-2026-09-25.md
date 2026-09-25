# iOS（Safari・ホーム画面アプリ）不具合の洗い出し — 2026-09-25

コードを読んで洗い出した。**実機の iPhone では確かめていない**。本番サイトにも
この環境からは接続できなかった（ネットワーク制限）。確度の書き方:

- **確認済み** — コードを自分で読み、不具合が起きる流れを確かめた（一部は最小の再現ページを Chromium で測った）
- **要実機** — コード上の流れは確かめた。ただ、起きるかどうかは iOS の振る舞い次第なので iPhone で試す必要がある

## 一覧（直す順）

| # | 症状 | 起きる条件 | 重さ | 確度 | 場所 |
|---|---|---|---|---|---|
| 1 | ヘッダー・写真モーダルのボタンが時計・電池の帯（ステータスバー）の下に潜る | ホーム画面から起動したとき | 高 | 確認済み | `app/layout.tsx:151`（`black-translucent`）・`:334`（`sticky top-0 h-[64px]`、`safe-area-inset-top` を足していない）／`GalleryModal/ModalControls.tsx:84,122,135`（`top-2`）／連動: `HeaderNav.tsx:210`・`NotificationsBell.tsx:1038`（`top-[64px]` 決め打ち） |
| 2 | 入力欄をタップすると画面が拡大され、そのまま戻らない | スマホ幅のすべての入力欄（16px 未満） | 高 | 確認済み | 根本原因: `app/globals.css:159`（639px 以下で基準の文字が 14px → `text-base` も 14px）／特に踏まれるもの: `FilterBar.tsx:374`（検索欄 13px）・`login/page.tsx`・`signup/page.tsx:15`・`StoryViewer.tsx:1600`（返信欄）・`map/MapControls.tsx:118`（15px）ほか |
| 3 | ストーリーの BGM が2本目から鳴らない。音をオンにした動画は最初のコマで止まり、先へ進まない | 音をオンにして、次のストーリーへ自動で進んだとき | 中〜高 | 要実機 | `StoryViewer.tsx:1134`（`<video key={item.id}>`）・`:1205`（`<audio key=…>`）で要素を毎回作り直す → タップ無しで音あり再生 → iOS が拒否。`play()` の失敗は `catch(()=>{})` で握りつぶしている（`:701`・`:723`） |
| 4 | ヘッダーが約1画面分スクロールすると一緒に流れて消える。ページ末尾（フッター最終行）が下部タブバーの裏に入る | 長いページ全般（iOS 以外でも起きる） | 中 | 最小再現で確認・本番は未測定 | `globals.css:37`（`html,body{height:100%}`）＋ `layout.tsx:315`（`min-h-screen flex`）→ `body` の箱が画面の高さで止まる。`globals.css:88` の `padding-bottom` は効かない（`Footer.tsx:46-50` のコメントも同じことを実測している） |
| 5 | ストーリーを上下に払っても、閉じる操作とメニューが出ない | ストーリー閲覧中 | 中 | 要実機 | `StoryViewer.tsx:1333,1341`：`touchAction:"manipulation"` なので指の動きをブラウザが取る → `pointercancel` が来る。受け手が無く、`pointerleave` がキャンセル時点（数px）の座標で判定する → しきい値 70px に届かない。正しく組んである例: `UserProfileClient.tsx:1622` |
| 6 | 縮めていない原寸の写真（48MP・十数MB）がそのまま公開される | canvas が作れないとき（iOS のメモリ上限） | 中 | 経路は確認済み・きっかけは推定 | `lib/utils/image.ts:244,248`（`getContext`/`toBlob` が null なら元ファイルを返す）→ `:322` で JPEG は EXIF だけ消して通す（画素の上限は約2.7億）。canvas は解放していない。サムネ・代表色・ぼかしは元ファイルから別々にデコードしている（`app/user/upload/page.tsx:772,820,878,881`） |
| 7 | トーストが下部タブバーに重なり、表示中はタブが押せない | トーストが出たとき | 中 | 確認済み | `Toast.tsx:81`（`bottom` が `--bottom-bar-h` を見ていない） |
| 8 | 投稿画面の入力（題・キャプション）が消える | カメラ・写真の選択から戻ったとき、またはバックグラウンドにいる間に、iOS がメモリ不足でページを破棄した場合 | 中 | 要実機 | `app/user/upload/page.tsx`：途中の入力を保存しておく仕組みが無い |
| 9 | 圏外の受け皿ページに「再読み込み」が無く、電波が戻っても元のページへ戻れない | ホーム画面から起動・圏外で開いたとき | 中 | 確認済み | `public/offline.html:45`（`<a href="/">` だけ） |
| 10 | 撮った写真に位置情報が無く、撮影地が自動で入らない（何も表示されない） | 「写真を撮る」で撮ったとき（iOS が GPS を落とす） | 低〜中 | iOS の仕様 | `app/user/upload/page.tsx:1406`・`:572-603`。コードの誤りではない。「位置情報がありませんでした」と一言出す程度の対応 |
| 11 | 下から出るシートの下端のボタンが、ホームへ戻る帯（ホームインジケーター）と重なる | iPhone X 以降 | 低〜中 | 確認済み | `ReportDialog.tsx:91`・`user/albums/page.tsx:394`・`GalleryModal/ModalCaption.tsx:196` |
| 12 | 戻るで復元したページが、ログアウト後もログイン中の見た目のまま | 素の `<a>` で移動 → 行き先でログアウト → 戻る | 低 | 要実機 | `app/auth/context.tsx`：`pageshow`（`persisted`）の扱いが無い |
| 13 | 「ホーム画面に追加」ヒントの出し分けが実態と合わない | LINE / Google アプリ内（追加できないのに出る）、iPad・iOS 版 Chrome（追加できるのに出ない） | 低 | 確認済み | `lib/utils/pwa.ts:5-14`。ヒントは Safari とホーム画面アプリでログインが別になることも伝えていない |
| 14 | 写真を拡大して横に見回すと、次の写真へ送られる | 写真モーダルで2本指で拡大した後 | 低 | 要実機 | `lib/hooks/useSwipe.ts`：`visualViewport.scale` を見ていない |
| 15 | 端までスクロールすると画面全体がゴムのように弾む | キャプション・通報・通知パネル | 低 | 確認済み | `overscroll-behavior` が repo のどこにも無い |
| 16 | 写真モーダルのボタンのぼかしが効かない（見た目だけ） | iOS 17 以前 | 低 | 確認済み | `ModalControls.tsx:17`（インラインの `backdropFilter` に `-webkit-` の接頭辞が無い） |
| 17 | ホーム画面アプリで、新しい `sw.js` がなかなか届かない | 再開を繰り返して長く使うとき | 低 | 要実機 | `ServiceWorkerRegister.tsx:13`：`registration.update()` を呼ばない。ページはネットワーク優先なので実害は小さい |
| 18 | 共有を閉じた後のリンクのコピーが失敗しうる | 共有シートで断られた後 | 低 | 要実機 | `lib/utils/share.ts:26-65` |

### 情報のみ（不具合ではない）

- `manifest.webmanifest` の `share_target` と `shortcuts` は iOS では効かない（Android 専用）。
  `app/user/upload/page.tsx:228` のコメント「iOS の共有シート経由」は誤り。
  App Store に出すなら、ネイティブの共有拡張が要る（ガイドライン 4.2 の材料にもなる）。
- `min-h-screen`（100vh）が admin・user 配下などに残っている。読み込み中の表示が少し下にずれる程度。
- Safari は `toBlob('image/webp')` に PNG を返すので、1枚ごとにむだな PNG を1回作って捨てている（結果は正しい。遅いだけ）。

## 問題なしと確かめたもの（誤報にしないための記録）

- **写真を開いている間の背景スクロール固定**: `lib/utils/scrollLock.ts` が `position:fixed` 方式で止め、閉じたら元の位置に戻す
- **タップの 300ms 遅延・ダブルタップ拡大**: `body` の `touch-action: manipulation` で止まっている
- **長押しで出る画像メニュー**: `WebkitTouchCallout:none` で止めている
- **下端の safe-area**: BottomNav・MiniPlayer・地図のシート・投稿画面の帯は対処済み
- **HEIC**: `accept="image/*"` なので iOS が JPEG に変換して渡す。向き（Orientation）も保たれる
- **日付**: `Date.parse` に頼らない（Safari で Invalid Date になる経路は無い）
- **Service Worker**: リダイレクトの扱い、写真の控えの件数上限、切り替え時の後片付けは問題なし
- **Safari で動かない API**（`requestIdleCallback`・Fullscreen・`vibrate` など）は使っていないか、有無を確かめてから使っている
- **ストーリー画面の上端**: `StoriesBar`・`StoryViewer` は `safe-area-inset-top` を足している（#1 はこれを他の画面へ広げていないだけの取りこぼし）

## 次の一手

1. **#1・#2・#7 は実機を待たずに直せる**（CSS だけ・確認済み）。1コミットで扱える件数に収まる。
   ただし #2 は見た目の文字サイズが変わる。「デザインは勝手に変えない」に当たるので、
   入力欄だけ `font-size: max(16px, 1em)` にするのが最小の変更。
2. **#3・#5 は iPhone で症状を見てから直す**（ストーリーを音ありで3本流す／上下に払う）。
3. **#4 は iOS に限らない**。直すと全ページの高さの計算に効くので、単独のコミットにして
   本番と同じデータの形でビルドしてから、実ブラウザで確かめる。
