# 登録までのどこで人が離れているかを数える（2026-10-31・journey.photo-ios#432 の 5）

「来た → 行きたいを押した → 登録した」を数える。費用は増やさない（GA4 は無料・
ログは1件あたり約 200 バイト）。Cognito の設定・DB・GSI は変えていない。

## Web（GA4 `G-7TFN1YPBE3`）

| イベント | いつ | 値 |
|---|---|---|
| `wish_tap` | 「行きたい」を押した（撮影スポット・撮影地・写真の「次の旅へ」・地図・クイズ） | `signed_in`: 0（未ログイン＝ログインへ）/ 1（保存した。外したときは送らない）、`kind`: `spot` / `location` |
| `sign_up` | 登録の確認コードが通った（もう確認済みだった回は送らない） | `method`: `email`、`from`: `wish` / `other` |

- `from` は「行きたい」から来たかどうか。行きたいのリンクだけが `/login?…&via=wish` を付け、
  ログイン画面の「新規登録」が `/signup?…&via=wish` に運ぶ（`lib/utils/analytics.ts` の `signupFromVia`）
- uid・メール・撮影スポットの slug は送らない
- GA4 の読み込み（`lazyOnload`）より前に押されたものは `window.__jpq` に積み、初期化の行で送る
- GA4 では「探索」で `page_view → wish_tap → sign_up` の目標到達プロセスを作る。
  `signed_in` と `from` はカスタム ディメンション（イベント スコープ）に登録すると絞り込める

## サーバー（正しい登録の数）

Web は `confirmRegistration` に `ClientMetadata {platform: "web", from}` を渡す。
Cognito の PostConfirmation のトリガー（`api/src/cognitoTrigger.ts`）が、
`PostConfirmation_ConfirmSignUp` の回だけ、次の1行をログに出す:

```
{"metric":"signup","platform":"web","from":"wish"}
```

値は決まったものだけ（`platform`: web / ios / unknown、`from`: wish / other / unknown）。
iOS はまだ ClientMetadata を渡していないので `unknown` になる。GA4 の `sign_up` は
広告の遮断などで漏れるので、登録の数はこちらを正とする。

### 数え方（CloudWatch Logs Insights）

ロググループ: `/aws/lambda/photo-gallery-api-prod-postConfirmation`（staging は `-staging-`）

```
fields @timestamp, @message
| filter @message like /"metric":"signup"/
| parse @message '"platform":"*","from":"*"' as platform, source
| stats count(*) as signups by bin(1d) as day, platform, source
| sort day desc
```

Lambda のログは文字の形（頭に時刻・要求 ID・INFO が付く）なので、JSON の欄は自動では
取り出されない。`parse` で取り出している。
