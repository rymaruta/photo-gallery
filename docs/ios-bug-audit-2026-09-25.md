# iOS（Safari・ホーム画面アプリ）不具合の洗い出し — 2026-09-25（37件）

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

## 追加分（2回目の洗い出し・19〜37）

1回目と重ならない範囲を見た: 日本語入力とキーボード、タッチ操作・地図・音楽、
古い iOS との互換性・アプリ内ブラウザ・ホーム画面アプリでの移動。

| # | 症状 | 起きる条件 | 重さ | 確度 | 場所 |
|---|---|---|---|---|---|
| 19 | **ロック画面やコントロールセンターで止めても、ミニプレイヤーは「再生中」のまま。▶を1回押しても鳴らない（2回押しが要る）** | マイBGMの再生中に、iOS 側で一時停止したとき（AirPods を外す・着信・Siri でも同じ） | 中 | 確認済み | `app/music/MusicContext.tsx:163-190`：`<audio>` に `onPause`/`onPlay` が無く、状態は画面から操作したときしか変わらない |
| 20 | ロック画面に曲名・ジャケットが出ず、「次へ／前へ」も効かない | 音楽の再生中 | 中 | 確認済み | `navigator.mediaSession` を使っている所が repo に0件。#19 と一緒に直すのが自然 |
| 21 | **タグを「、」や空白、全角の「，」で区切ると、全部で1つのタグとして保存される。候補チップも消える** | iPhone のかなキーボードで「桜、紅葉」と打ったとき | 中 | 確認済み（実データでは0件＝まだ誰も踏んでいない） | `app/user/upload/page.tsx:712`・`app/user/edit/page.tsx:454`・`app/admin/edit/page.tsx:210`（`split(",")`）・`lib/utils/ownValues.ts:153`（`typingFragment`） |
| 22 | テーマソングの開始・終了で「1:12」と打てず、「112」が112秒（1:52）として黙って保存される | iPhone（数字キーパッドに「:」が無い） | 中 | 確認済み | `app/user/profile/page.tsx:945,958`（`inputMode="numeric"` なのに書式は `m:ss`）・`mmssToSec`（:60-66） |
| 23 | アバター変更中のスピナーが見えず、完了まで画面が何も変わらない | タッチ端末すべて | 中 | 確認済み | `app/user/profile/page.tsx:607`：スピナーが `opacity-0 group-hover:opacity-100` の層の中にある（Tailwind v4 の `hover:` はタッチ端末では効かない）。同じ形: 曲の試聴の ▶ の印（`:873`） |
| 24 | ページを移ると、新しいページの途中が見えてから上へ流れていく | iOS 15.4 以降（iOS に限らない） | 中 | 確認済み（見た目は実機未確認） | `app/globals.css:31`（`scroll-behavior: smooth`）＋ `app/layout.tsx:221`（`<html>` に `data-scroll-behavior="smooth"` が無い）。Next 16 から、この属性が無いと遷移中のなめらかスクロールを切らなくなった |
| 25 | ストーリーの返信欄・通報欄で、カーソル移動・範囲選択・ペーストが効かない（最悪、文字が打てない） | ストーリー閲覧中 | 中〜高（起きた場合） | 要実機 | `StoryViewer.tsx:1105` の外枠の `select-none`（`-webkit-user-select:none`）が、中の `<input>`（:1600）と `ReportDialog`（:1823）に受け継がれる |
| 26 | 投稿のたびに原寸の写真を4回読み直す。iOS では WebP を試して捨てるので、PNG を1枚ぶん余計に作る。canvas も解放しない → タブが落ちやすく、#6 の「原寸で上がる」の引き金になる | 24〜48MP の写真、特に複数枚 | 中 | 経路は確認済み・落ちるかは要実機 | `app/user/upload/page.tsx:772,820,878,881`・`lib/utils/image.ts:197,240,364,389,433` |
| 27 | パスワードを変えても、iOS のパスワード管理（キーチェーン）が新しいパスワードを覚えない → 次のログインで古いパスワードが入って失敗する | 設定画面でのパスワード変更 | 低〜中 | 要実機 | `app/user/settings/page.tsx:404-438`：`<form>` も `autocomplete="username"` の欄も無い |
| 28 | Instagram の欄で先頭が大文字になる・自動修正で別の綴りに変わる。全角の「＠」が消えない | iPhone のキーボード | 低〜中 | 確認済み | `app/user/profile/page.tsx:759-767`（`autoCapitalize`/`autoCorrect`/`spellCheck` が無い）。タグ欄も同じ |
| 29 | 入力中、固定表示のシートやモーダルのボタン（「通報する」「退会する」）がキーボードの下に隠れる | 通報・退会・ストーリー返信 | 低 | 要実機 | `visualViewport` を使っている所が repo に0件。`ReportDialog.tsx:91`・`DeleteAccountModal` |
| 30 | 旅行プランで、ドラムを回しているだけで場所が追加されるおそれ | iPhone の選択ドラム | 低 | 要実機 | `app/trips/TripsClient.tsx:376-379`：`onChange` の時点で追加している |
| 31 | 焦点の枠を長押ししてから動かすと、画像のメニューが出てドラッグが途切れる | 投稿画面の焦点選択 | 低 | 要実機 | `app/components/CropFramePicker.tsx:100`：`<img>` に `WebkitTouchCallout:"none"` が無い |
| 32 | 地図の上ではページがスクロールしない。タイルがぼやける。位置情報を断ったときの案内が iOS の設定の場所と合わない | `/map`・写真の地図 | 低 | 確認済み | `app/components/PhotoMap.tsx:198`・`app/map/MapPageClient.tsx:303`（`detectRetina` 無し） |
| 33 | 検索欄の消去ボタンが2つ並ぶ。キーボードの「検索」を押しても何も起きず、キーボードが結果を隠したまま残る | 検索欄3か所 | 低 | 要実機 | `FilterBar.tsx:367`・`app/users/search/page.tsx:80`・`app/map/MapControls.tsx:106`（`<form>` も `enterKeyHint` も無い） |
| 34 | パスワード再設定の確認コードで、数字キーパッドではなく全文字のキーボードが出る | ログイン画面 | 低 | 確認済み | `app/login/page.tsx:333-343`（`inputMode="numeric"` が無い。登録と設定には付いている） |
| 35 | ユーザー検索を開いてもキーボードが出ない（もう1回タップが要る） | 画面を移って開いたとき | 低 | iOS の仕様 | `app/users/search/page.tsx:36`：`useEffect` の中で `focus()` している |
| 36 | ストーリーの曲の試聴が、指定した「好きな部分」ではなく頭から鳴るおそれ | ストーリー作成 | 低 | 要実機 | `StoriesBar.tsx:584`：曲の情報を読む前に `currentTime` を書いている |
| 37 | （将来の回帰の種）Safari で変換確定の Enter を止めているのは `keyCode === 229` の方なのに、コメントでは「保険」扱いになっている | — | 低 | 確認済み | `lib/utils/ime.ts:16`。誰かが `isComposing` だけに簡略化すると、Safari で確定の Enter が送信になる |

### 2回目で「問題なし」と確かめたもの

- **日本語入力の確定 Enter**: Enter で実行する欄は、すべて `isImeKey` で止めている。コメント欄は Ctrl/⌘+Enter だけ
- **ログイン・登録の自動入力**: `autocomplete`（email / current-password / new-password / one-time-code）は揃っている
- **日付入力**: iOS の日付ピッカーで消去して `""` になった場合も、タイムゾーンのずれも扱えている
- **並べ替え**: HTML5 の Drag and Drop は使っていない（iOS で使えない操作は無い）
- **古い iOS でエラーになる JS**: アプリのコードには無い。Tailwind の CSS も古い Safari 向けの代わりの値を持っている
- **アプリ内ブラウザ（Instagram・LINE）**: ストレージ・SW・共有はどれも、無い場合に備えてある
- **ホーム画面アプリの「戻る」**: 履歴が無いときはホームへ戻すので、行き止まりにならない

### 前提として知っておくこと

- **対応する iOS の下限は 16.4**（Next 16 の既定。browserslist の指定が無いため）。
  iOS 15（iPhone 6s・7・初代 SE はここで止まる）と 16.0〜16.3 は、フレームワークの時点で対象外。
  実際に画面が止まるかは、ビルド済みの JS が無いので確かめていない。

## 次の一手（2回目を踏まえて）

1. **確認済み・CSS や属性だけで直るもの**: #1・#2・#7・#22・#23・#24・#34。
   5〜8件ずつ2コミットに分ける（1コミットは5〜8件まで）。
2. **音楽（#19・#20）はまとめて1コミット**。実機でロック画面から操作して確かめる。
3. **iPhone で見てから直すもの**: #3・#5・#25（ストーリー）、#26（投稿のメモリ）。
4. **#21（タグの「、」）は、区切りを決める共通の関数を1つにまとめてから直す**
   （画面3か所と `ownValues.ts` の4か所で使うため）。

## 次の一手（1回目）

1. **#1・#2・#7 は実機を待たずに直せる**（CSS だけ・確認済み）。1コミットで扱える件数に収まる。
   ただし #2 は見た目の文字サイズが変わる。「デザインは勝手に変えない」に当たるので、
   入力欄だけ `font-size: max(16px, 1em)` にするのが最小の変更。
2. **#3・#5 は iPhone で症状を見てから直す**（ストーリーを音ありで3本流す／上下に払う）。
3. **#4 は iOS に限らない**。直すと全ページの高さの計算に効くので、単独のコミットにして
   本番と同じデータの形でビルドしてから、実ブラウザで確かめる。
