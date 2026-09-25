# iOS アプリを App Store に出すまで（2026-09-25 時点）

**この文書は「何が済んでいて、何が残っているか」を実測で書いたもの。**
推測で「できているはず」を書かない。確かめていないことは「未確認」と書く。

⚠️ **ネイティブの工程は macOS と Xcode が要る。** この文書を書いた環境は
Linux なので、`ios/` の生成・ビルド・署名・App Store Connect への提出は
**owner の Mac でしかできない**。私が作れて確かめられるのは、Web 側の配線・
サーバー・手順書まで。

---

## 1. いまリポジトリに在るもの・無いもの（2026-09-25 に実測）

| | 状態 |
|---|---|
| Capacitor | **無い**。`package.json` の依存も `capacitor.config.*` も 0件 |
| `ios/` / `.xcodeproj` | **無い**。`claude/journey-photo-ios-app-*` の4本を含め、どのブランチにも 0件 |
| PWA の土台 | `manifest.webmanifest` が `display: standalone`・`public/sw.js` あり |
| アイコン | 192・512・maskable-512。**1024×1024 が無い**（App Store の必須） |
| Web Push | **使っていない**（`Notification.requestPermission` も `PushManager` も 0件）。プッシュの経路はネイティブ1本 |

「iOS アプリ」と名の付いたブランチは**全部サーバー側の作業**。ネイティブの
殻は一度も作られていない。

## 2. 審査で効く項目（確かめた結果）

| ガイドライン | 状態 | 根拠 |
|---|---|---|
| **5.1.1(v)** アプリ内のアカウント削除 | ✅ 満たす | `app/components/DeleteAccountModal.tsx` ＋ `DELETE /user/account`（`api-user/serverless.yml` の `deleteAccount`） |
| **1.2** UGC の安全策 | ✅ 満たす | 通報（`api-user/src/report.ts`・写真とストーリー）／ブロック（`block.ts`・両向き）／規約の禁止条項（`app/terms/page.tsx`）／公開の連絡先（同 `mailto:`） |
| **4.8** Apple でサインイン | **不要** | ログインは Cognito のメール＋パスワードだけ。外部のソーシャルログインが1つも無いので、この条項に当たらない |
| **4.2** 最低限の機能 | 🔴 **未達** | 「Web サイトを包んだだけ」では通らない。越える手はプッシュ通知（下） |
| **App Privacy**（申告） | 未着手 | App Store Connect 上の作業。owner のみ |

**4.2 が唯一の技術的な関門。** カメラは Web の `capture="environment"` で
既に動く（`app/user/upload/page.tsx`）ので、差別化になるのはプッシュ通知。

## 3. プッシュ通知（PR #63）— サーバーは揃った

`pushNotification` が**通知を作る唯一の場所**で、そこ1か所から APNs へ送る。
口ごとに配線すると経路が増えたときに必ず漏れるため。

### 端末を登録する口

```
POST /user/devices        Authorization: Bearer <Cognito の ID トークン>
  { "token": "<APNs の端末トークン・16進32〜200文字>" }
  → 200 { "ok": true }
  → 400 端末のトークンが不正です / 401 認証が必要です / 500 登録できませんでした

DELETE /user/devices      Authorization: Bearer <同上>
  { "token": "<同上>" }
  → 200 { "ok": true }   ※無いトークンを外せと言われても 200
                            （ログアウトの後始末なので止めない）
```

- **トークンは小文字で送る**（サーバーも畳むが、揃えておくと事故が減る）
- **1人10台まで**（`DEVICES_MAX`）。溢れたら「いま登録した1台以外」から落とす
- **登録のたびに持ち主が付け替わる**。同じ端末で別の人がログインすると、
  前の人の集合から自動で外れる（`deviceOwnerId` の逆引き）
- ログアウト時は `DELETE` を**必ず呼ぶ**。呼べなくても上の付け替えが救うが、
  次に誰かがログインするまでの間は前の人に届く

### 届く通知の形

```json
{
  "aps": {
    "alert": { "loc-key": "NOTIF_LIKE", "loc-args": ["旅人A"] },
    "sound": "default",
    "badge": 3
  },
  "type": "like", "photoId": "…", "byId": "…"
}
```

- **文面はサーバーで作らない。** 相手の言語を知らないので、鍵（`loc-key`）だけ
  送って端末に任せる。**`Localizable.strings` に4つ要る**:

      NOTIF_LIKE          "%@ さんがあなたの写真にいいねしました"
      NOTIF_COMMENT       "%@ さんがコメントしました"
      NOTIF_FOLLOW        "%@ さんがあなたをフォローしました"
      NOTIF_STORY_REPLY   "%@ さんがストーリーに返信しました"

  （文言は例。`%@` に `loc-args[0]` が入る）
  **足さないと iOS は鍵の文字列をそのまま通知に出す**（`NOTIF_LIKE` と表示）。
  通知の種類を足すときは `notify.ts` の `LOC_KEYS` と両方に足すこと。

- `badge` は**アプリ内の未読数と同じ数**（`visibleUnread`。保存件数で丸め、
  ブロックした相手のぶんを除く）。ベルの数と食い違わない
- 押したときの行き先は `type` と `photoId` / `byId` で決める

### 鍵（owner の作業）

| 要るもの | どこで作る | どこへ入れる |
|---|---|---|
| `.p8` の秘密鍵 | Apple Developer → Keys → APNs | GitHub Secrets の `APNS_PRIVATE_KEY` |
| Key ID | 同上（鍵を作ると出る） | `deploy-api.yml` の `apnsKeyId` |
| Team ID | Apple Developer のメンバーシップ | `apnsTeamId` |
| Topic | アプリの Bundle ID | `apnsTopic` |
| Host | `api.sandbox.push.apple.com`（Xcode から直接入れたビルド）<br>`api.push.apple.com`（TestFlight と App Store） | `apnsHost` |

- **5つで1組。** 1つでも欠けると `apnsConfigured()` が false になり、
  **ログも出さずにプッシュだけ止まる**（通知はアプリ内に積まれる）。
  見張りは `scripts/__tests__/apnsKeyScope.test.ts`
- 🔴 **`apnsHost` を必ず渡す。** 既定値は置いていない（置くと staging から
  本番の APNs を向き、sandbox のトークンが 400 を受けて**消える**）
- **鍵は「送る4関数」にだけ配る**（`likePhoto` / `postComment` / `followUser` /
  `postStoryReply`）。provider に置くと未認証で呼べる口にも配られる
- 初回デプロイのあと、**実機で 200 が返ることを一度確かめる**
  ——`.p8` の改行を Lambda の環境変数まで通す経路は、まだ実測していない

## 4. 残っている工程

### A. Web 側（macOS 不要・私が作れる）

1. **端末トークンを登録する橋渡し。** Capacitor の `PushNotifications` から
   受け取ったトークンを `POST /user/devices` に送る。ログアウト時に `DELETE`。
   ネイティブでないとき（ブラウザ）は何もしない形にする
2. **許可を求める画面。** いきなり OS のダイアログを出さない（断られると
   設定アプリからしか戻せない）。何が届くかを1画面で説明してから頼む
3. **`Localizable.strings` の文言**（上の4つ）を owner に決めてもらう

### B. ネイティブ（**macOS と Xcode が要る**）

4. Capacitor を入れて `ios/` を作る。`webDir` は `out`（`output: export` の
   書き出し先）
5. Bundle ID を決め、Apple Developer に App ID を登録。
   **Push Notifications の capability を入**にする
6. `@capacitor/push-notifications` を入れ、`AppDelegate` で
   `didRegisterForRemoteNotificationsWithDeviceToken` を配線
7. アイコン（**1024×1024 を作る**）と起動画面
8. 実機ビルド → `apnsHost` を sandbox にして**通知が届くことを確認**
9. TestFlight → `apnsHost` を本番へ切り替えて再確認

### C. 提出（owner のみ）

10. Apple Developer Program の登録（年 $99）
11. App Store Connect でアプリを作る。**App Privacy の申告**
    （集めているもの: メールアドレス・写真・位置情報・端末トークン）
12. スクリーンショット・説明文・年齢制限（UGC があるので 12+ 以上が妥当）
13. 審査へ提出

## 5. 順番の推奨

**B より先に A を終わらせる。** 「通知が実際に届く」ところまでサーバーと
Web を通してから殻を作る。逆にすると、審査に出せない殻だけができる。

**4.2 の答えをプッシュ通知に賭けるなら、審査に出す前に実機で届くことを
確かめておく。** 届かない状態で出すと「Web サイトを包んだだけ」で弾かれ、
やり直しに1〜2週間かかる。

## 6. この文書で確かめていないこと

- **`.p8` の改行を Lambda の環境変数まで通す経路**（`apns.ts` は `\n` の
  エスケープ形にも対応しているが、実際のデプロイで試していない）
- **実機で APNs が 200 を返すか**（鍵が無いので試せない）
- **Capacitor が `output: export` の書き出しをそのまま包めるか**
  （`out/` を `webDir` にする想定だが、`_next/` の相対パスまで確かめていない）
- **Lambda の同時実行がアカウント全体で10本**という制約の下で、通知の送信
  （最大2秒）が本筋の応答を詰まらせないか。混んだときの形は「500」ではなく
  **同時実行の上限に当たって 429/503**。将来 SQS に逃がす前提を置いておく
