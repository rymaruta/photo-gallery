# Journey Photo API — 接続方法とコード

**別のプロジェクトからこの API を叩くための資料。** 実装（`api/` `api-user/`
`lib/utils/api.ts` `lib/auth/cognito.ts`）と `serverless.yml` から起こしてある。
**数字も口の一覧も、書く前に実際のファイルを数えた**——推測で書いた行は無い。

最終更新: 2026-09-24

---

## 1. API は2つある

| | 用途 | 本番の URL |
|---|---|---|
| **ユーザーAPI**（`api-user/`） | 利用者が使う口すべて（投稿・いいね・コメント・フォロー・ストーリー…）。**73口** | `https://gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com` |
| **管理API**（`api/`） | 公開の写真一覧と、管理者だけの編集・削除。**7口** | `https://ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com` |

- どちらも **API Gateway HTTP API + Lambda**（`nodejs22.x` / `ap-northeast-1`）
- **CloudFront は経由しない。** 画面は execute-api を直接叩く
  （`scripts/fix-cdn-error-pages.js` が「CloudFront の `/api/*` を通る通信は無い」と明記）。
  つまり応答の `s-maxage` は**共有キャッシュに読まれていない**——効くのは
  ブラウザ個別のキャッシュだけ
- **CORS は `cors: true`**（全オリジン許可）。ブラウザから直接呼べる

⚠️ **同じパスが両方にある。** `GET /photos/{id}` は管理API（公開・1枚取得）、
`PUT /photos/{id}` はユーザーAPI（本人の編集）。**base URL を取り違えると
404 になり、その失敗は握り潰されて画面が空になる**（`lib/utils/api.ts` の
`userPublicFetch` のコメントがこの事故を記録している）。

### ステージング

| | URL |
|---|---|
| ユーザーAPI | `https://y9f8ajacc2.execute-api.ap-northeast-1.amazonaws.com` |
| 管理API | `https://rfq22dzchf.execute-api.ap-northeast-1.amazonaws.com` |

**staging には写真もユーザーも入っていない**（空から始めた）。試すには新規登録が要る。

---

## 2. 接続に要る値

`.env` に置く名前は、このリポジトリの画面が読んでいるものと同じにしてある
（`process.env.NEXT_PUBLIC_*` を grep して一覧化）。

```bash
# どこを叩くか
NEXT_PUBLIC_API_BASE_URL=https://ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com
NEXT_PUBLIC_USER_API_BASE_URL=https://gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com

# 認証（Cognito）— この2つは公開してよい値（SPA 用の識別子）
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_ZbuhDQsWz
NEXT_PUBLIC_COGNITO_CLIENT_ID=21cs4cd8dkttmg3snloj72u8mu
NEXT_PUBLIC_AWS_REGION=ap-northeast-1

# 画像の配信元（保存された URL の組み立てに使う）
NEXT_PUBLIC_CLOUDFRONT_URL=https://d1s3dwwzgxf5ni.cloudfront.net
NEXT_PUBLIC_SITE_URL=https://journey-photo.com
```

⚠️ **Cognito のクライアントにシークレットは無い**（SPA 用なので設定していない）。
だから Pool ID と Client ID は公開してよい。**IAM のアクセスキーは要らない**
——API は Cognito の JWT だけで守っている。

⚠️ **画像の URL は2つのホストに割れている。** 保存されている値は実測で
`journey-photo.com` 19枚 / CloudFront の既定ドメイン 11枚。画面に出すときは
`lib/utils/seo.ts` の `publicImageUrl` でサイトのドメインに揃えている。
**別プロジェクトでも同じ正規化を通すこと**（通さないと接続が1本増える）。

---

## 3. 認証

**Cognito User Pool の JWT（ID トークン）を `Authorization: Bearer <token>` で送る。**
API Gateway の JWT オーソライザが検証する（`api-user/serverless.yml`）:

```yaml
httpApi:
  cors: true
  authorizers:
    cognitoAuthorizer:
      type: jwt
      identitySource: $request.header.Authorization
      issuerUrl: https://cognito-idp.ap-northeast-1.amazonaws.com/${cognitoUserPoolId}
      audience:
        - ${cognitoClientId}
```

- **送るのは ID トークン**（`session.getIdToken().getJwtToken()`）。アクセストークンではない
  ——`audience` がクライアントIDで、その主張を持つのは ID トークンの方
- 期限切れは API Gateway が **401** を返す。画面はそれを
  「セッションの有効期限が切れています。ログインし直してください」に置き換えている
- **投稿できるかは JWT の `cognito:groups` で決まる。** 新規登録時に
  PostConfirmation トリガーが `user` グループへ入れる。グループが無い人は
  ログインはできるが投稿の画面に入れない（`useMemberGate`）

### メールアドレスがログインID

プールは `AliasAttributes: ["email"]`・`AutoVerifiedAttributes: ["email"]`・
`AttributesRequireVerificationBeforeUpdate: ["email"]`（2026-09-16 に本番を実測）。

---

## 4. 最小のクライアント（コピーして使える）

Next.js に依存しない形にしてある。依存は `amazon-cognito-identity-js` だけ。

```bash
npm i amazon-cognito-identity-js
```

```ts
// journey-api.ts
import {
    CognitoUserPool, CognitoUser, AuthenticationDetails,
    type CognitoUserSession,
} from "amazon-cognito-identity-js";

const USER_API = process.env.NEXT_PUBLIC_USER_API_BASE_URL!;   // gu7kxwdc5l...
const ADMIN_API = process.env.NEXT_PUBLIC_API_BASE_URL!;       // ionr4ik01e...

const pool = new CognitoUserPool({
    UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
    ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
});

/** ログイン。成功すると SDK が localStorage にトークンを置く */
export function signIn(email: string, password: string): Promise<CognitoUserSession> {
    const user = new CognitoUser({ Username: email, Pool: pool });
    const auth = new AuthenticationDetails({ Username: email, Password: password });
    return new Promise((resolve, reject) => {
        user.authenticateUser(auth, {
            onSuccess: resolve,
            onFailure: reject,
            // 管理者が作ったアカウントの初回ログイン。自前で新しいパスワードを出す
            newPasswordRequired: () => reject(new Error("新しいパスワードの設定が必要です")),
        });
    });
}

/** いまのセッション（期限切れならリフレッシュトークンで自動更新される） */
export function currentSession(): Promise<CognitoUserSession | null> {
    const user = pool.getCurrentUser();
    if (!user) return Promise.resolve(null);   // 端末に何も無い＝未ログイン
    return new Promise((resolve) => {
        user.getSession((err: Error | null, s: CognitoUserSession | null) => {
            resolve(err || !s?.isValid() ? null : s);
        });
    });
}

export async function idToken(): Promise<string | null> {
    return (await currentSession())?.getIdToken().getJwtToken() ?? null;
}

const TIMEOUT_MS = 20_000;

/** 打ち切り付きの fetch。**API Gateway 自身は29秒で切る**ので、その手前で諦める */
async function withTimeout(url: string, init?: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(new DOMException("応答がありません（20秒）", "TimeoutError")), TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: ac.signal });
    } finally {
        clearTimeout(t);
    }
}

/** 認証あり（ユーザーAPI） */
export async function userFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await idToken();
    if (!token) throw new Error("認証が必要です。ログインしてください。");
    return withTimeout(`${USER_API}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });
}

/** 認証なし（ユーザーAPI の公開6口） */
export const userPublicFetch = (path: string, init?: RequestInit) =>
    withTimeout(`${USER_API}${path}`, init);

/** 認証なし（管理API の公開2口＝写真一覧・写真1枚） */
export const publicFetch = (path: string, init?: RequestInit) =>
    withTimeout(`${ADMIN_API}${path}`, init);

/** エラー応答から、そのまま画面に出してよい日本語の一文を取り出す */
export async function readApiError(res: Response, fallback: string): Promise<string> {
    try {
        const data = await res.json();
        const m = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : "";
        if (!m) return fallback;
        // API Gateway の 401 は英語の定型（"Unauthorized"）なので置き換える
        if (res.status === 401) return "セッションの有効期限が切れています。ログインし直してください";
        return m;
    } catch {
        return fallback;
    }
}
```

⚠️ **本家にあってこの写しに無いもの**（要るなら `lib/utils/api.ts` を読む）:

- **トークン取得そのものの打ち切り**（10秒）。`getSession` は期限切れトークンで
  Cognito へ通信し、ライブラリ側に時間切れが無い。入れないと**返らない回線で
  `fetch` に到達すらせず固まる**
- **本文の読み取りの打ち切り**。`fetch` が返るのはヘッダが来た時点。しかも
  **本文の途中で `abort` すると理由が捨てられて `AbortError` になる**（Chromium で実測）
  ので、中断ではなく `res.json()` を競走させて守っている
- **「未ログイン」と「通信できない」の区別**。キャプティブポータル（ホテル・
  空港の Wi-Fi）では前者に見えるが、言われたとおりログインし直そうにもその通信も通らない

---

## 5. エンドポイント一覧

### 管理API（`NEXT_PUBLIC_API_BASE_URL`）— 7口

| | パス | 認証 | 中身 |
|---|---|---|---|
| GET | `/photos` | **不要** | 公開写真の一覧。`?userId=` で絞れる。`Cache-Control: public, s-maxage=60`。**絞った写真と非公開の項目は落としてから返す** |
| GET | `/photos/{id}` | **不要** | 写真1枚 |
| GET | `/admin/photos` | 管理者 | 非公開・下書きも含む全件 |
| PUT | `/photos/{id}` | 管理者 | 編集 |
| DELETE | `/photos/{id}` | 管理者 | 削除（S3 の実体・CloudFront の無効化・再ビルド依頼まで） |
| POST | `/upload/presigned-url` | 管理者 | — |
| POST | `/upload/save` | 管理者 | — |

⚠️ 管理者の判定は `cognito:groups` に `admin` があるか（`api/src/auth.ts` の `isAdmin`）。

### ユーザーAPI（`NEXT_PUBLIC_USER_API_BASE_URL`）— 81口

**認証が要らないのは7口だけ**（`PublicReadRole`＝読み取り専用のロールで動く。`/feed` だけは索引を読むので専用の `PublicFeedRole`）:

| | パス | 中身 |
|---|---|---|
| GET | `/profile/{userId}` | 公開プロフィール |
| GET | `/users/search` | ユーザー検索 |
| GET | `/invites/{token}` | 招待リンクの下見（ログイン前に中身を見せる） |
| GET | `/photos/{id}/like` | いいね数（`s-maxage=30`）。**公開範囲を絞った写真は 404**（閲覧者が分からないため。ログイン中は `/user/likes/{id}` の `count` で読む） |
| GET | `/photos/{id}/comments` | コメント一覧（`s-maxage=15`）。**公開範囲を絞った写真は 404**（閲覧者が分からないため。`/user/comments/{id}` で読む） |
| GET | `/users/{uid}/follow` | フォロー数（`s-maxage=30`） |
| GET | `/feed` | 公開写真の一覧をページで（`s-maxage=30`・下の「公開写真のページ」）※2026-10-03 追加・**本番未反映** |

残り75口はすべて `Authorization: Bearer <IDトークン>` が要る:

**アップロード**
`POST /upload/presigned-url` / `POST /upload/save` / `DELETE /upload/discard` /
`POST /profile/avatar/presigned-url`

**自分のもの**
`GET,PUT /user/profile` / `GET /user/photos` / `GET /user/likes` /
`GET /user/likes/{id}` / `GET /user/saves` / `GET /user/saves/{id}` /
`GET /user/comments/{id}`（コメント一覧。絞った写真も見せてよい相手なら読める・S-1）/
`GET /user/following` / `GET,PUT /user/notifications` / `GET /user/blocks` /
`GET /user/close-friends` / `PUT,DELETE /user/close-friends/{id}` /
`DELETE /user/account`

**写真**
`PUT,DELETE /photos/{id}` / `POST,DELETE /photos/{id}/like` /
`POST,DELETE /photos/{id}/save` / `POST,DELETE /photos/{id}/comments`（と
`DELETE /photos/{id}/comments/{commentId}`）/ `POST /photos/{id}/report` /
`GET /user/inspired/{id}`（「この写真を見て撮影」の元の写真の要約。決まりと形は `docs/inspired-by.md`）※2026-10-14 追加・**本番未反映**

**フォロー・ブロック**
`POST,DELETE /users/{uid}/follow` / `GET /users/{uid}/following` /
`GET /users/{uid}/followers` / `POST,DELETE /users/{id}/block`

**ストーリー**
`GET,POST /stories` / `DELETE /stories/{id}` / `POST /stories/{id}/view` /
`GET /stories/{id}/viewers` / `GET,POST /stories/{id}/replies` /
`POST /stories/{id}/vote` / `POST /stories/{id}/keep` / `GET /stories/archive`

**ハイライト**
`POST /highlights` / `PUT,DELETE /highlights/{id}` /
`GET /highlights/{userId}` / `GET /highlights/{userId}/{id}`

**共同アルバム**
`GET,POST /albums` / `PATCH,DELETE /albums/{id}` /
`POST,DELETE /albums/{id}/invite` / `POST /invites/{token}/join`

**行きたい場所・旅行プラン**
`GET,POST /user/spots` / `DELETE /user/spots/{slug}` /
`GET,POST /user/trips` / `PUT,DELETE /user/trips/{planId}`

**旅のトランク** ※2026-10-17 追加・**本番未反映**（`api-user/src/trunk.ts`・2行 `trunk#<uid>`（持ち物）と
`trunkledger#<uid>`（悪用の歯止めの台帳: 指紋・束・節目・硬貨の控え・日ごとの数）。2行は TransactWriteItems で一度に書く。
台帳が `trunk#` の中にある古い形も読み、次に書くときに分ける。退会では2行とも消す）
`GET /user/trunk` / `PUT /user/trunk/model` / `PUT /user/trunk/settings` /
`POST /user/trunk/labels/{id}/stick` / `DELETE /user/trunk/labels/{id}` /
`POST /user/trunk/labels/{id}/reroll` / `POST /user/trunk/labels/{id}/reroll/choose` /
（次の版・2026-10-17）`PUT /user/trunk/labels/{id}/place` / `POST /user/trunk/labels/{id}/unstick` /
`POST /user/trunk/gacha` / `POST /user/trunk/parts/exchange` / `PUT /user/trunk/equip` /
（人のトランク・2026-10-18）`GET /users/{uid}/trunk`

- 公開の投稿1件（束 `groupId` は1件）ごとに、`POST /upload/save` の成功のあとでラベルを1枚「手持ち」に配る。
  応答に `label`（配った1枚・配り済みならその1枚・配らなければ `null`）と、配らなかった理由
  `labelSkipped` を足す: `draft`（下書き・ストーリー）/ `notNew`（機能を出す前に作った写真・一度公開した写真）/
  `off`（受け取らない設定）/ `samePost`（同じ束に配り済み）/
  `duplicate`（同じ写真の指紋に配り済み）/ `daily`（その日3枚配った）/ `full`（手持ちが上限）/
  `storage`（1行の容量がいっぱい）/
  `timeout`・`error`（配りが間に合わなかった。届いていれば `GET` に出る）
- ラベル: `{ id(=写真id), photoId, kind: milestone|timeslot|season|place, place{name, latin?, country?},
  season?: spring|summer|autumn|winter, timeslot?: dawn|dusk|night,
  milestone?: first|posts10|posts50|posts100|firstCountry, seed(整数), at, foil?, pos? }`。絵はアプリが `seed` と `kind` から描く
- `GET` → `{ model, effectiveModel, pocket, stuck, limit, isPro, rerolls{left, month}, pendingReroll?, receiveLabels,
  coins, parts, fragments, equipped, showTrunk, ticket, posts }`（`showTrunk`・`ticket` は 2026-10-18 に足した。下の「人のトランク」）。
  更新の口は同じ形から `posts` を除いたものを返す。失敗は `{ error, code }`
  （`notFound` / `full` / `storage` / `proOnly` / `pendingReroll` / `noRerollsLeft` / `noPending` / `badSeed` / `badModel` / `badRequest` / `busy` /
  `badPlace` / `notStuck` / `noCoins` / `badPart` / `owned` / `notEnoughFragments` / `badKind` / `notOwned`）
- 型: 無料 `leather`・`canvas`・`aluminum`・`steamer`、Pro `urushi`・`kori`・`sleeper`・`clipper`・`captain`・`starchart`。
  Pro をやめたら `effectiveModel` は最後に選んだ無料の型（既定 `leather`）。`model` は残る
- 作り直し（Pro・日本時間の月に3回・繰り越しなし）: `reroll` で候補3つ（`pendingReroll.seeds`）、
  `reroll/choose { seed }` で確定（今の `seed` を選んでもよい・回数は戻らない）。foil は保つ
- 投稿から24時間以内に写真を消す・非公開にすると、そのラベルは取り消す（手持ちでも貼ったものでも）。
  束は、束の写真が1枚も公開で残らなくなったときだけ取り消す
- 写真の編集（`PUT /photos/{id}`）で下書き → 公開にした回も同じ判定で配り、応答に `label`・`labelSkipped` を足す。
  配るのは**一度も公開されたことが無く**（写真の `firstPublishedAt` が無い）、機能を出した日
  （2026-10-17）より後に作られた写真だけ
- ⚠️ **指紋（EXIF の撮影日時・機種・大きさ）と束（`groupId`）はアプリが送る値。** 改造したアプリなら
  どちらも好きに変えられるので、そのときに効く歯止めは**1日3枚だけ**
- 節目（`first`・`posts10/50/100`・国ごとの `firstCountry`）は一度きり。束（`groupId`）も一度きり（手持ちから消しても戻らない）

*次の版（2026-10-17 owner 承認）*

- **自分の手で貼る**: 貼ったラベルは置き場 `pos { x, y, rot }` を持てる（x・y はトランク正面の 0〜1 の割合、
  rot は -30〜30 度。両端を含む。外れ・数でない・3つそろわないは 400 `badPlace`）。保存は x・y が小数3桁、
  rot が小数1桁に丸める（応答も丸めた値）。`pos` が無いラベルはアプリがおまかせで置く
  - `POST /user/trunk/labels/{id}/stick` の本文に任意で `{ x, y, rot }`。本文が無ければ今までどおり（置き場なし）。
    貼り済みへの再送は何もしない（置き場も変えない）
  - `PUT /user/trunk/labels/{id}/place { x, y, rot }` → 貼ったラベルの置き直し。手持ちのラベルは 409 `notStuck`、
    どこにも無ければ 404。一括のおまかせ並べは、アプリがこれを順に呼ぶ（専用の口は無い）
  - `POST /user/trunk/labels/{id}/unstick` → はがして手持ちのいちばん上へ（置き場は消える）。手持ちが上限
    （無料30・Pro150）なら 409 `full`。手持ちに在れば何もしない。24時間の取り消し・指紋の台帳は今までどおり
- **硬貨**（`coins`・0〜99）: 公開の投稿1件（束は1件）につき1枚。ラベルと同じ歯止め（指紋・束・1日3件・
  `notNew`・下書き）を通った投稿にだけ配る。**手持ちがいっぱい（`full`）でも、受け取らない設定（`off`）でも配る**
  （受け取らない設定はラベルのこと）。99 枚なら配らない。**お金では買えない**（買う口は無い）
  - `POST /upload/save` と写真の編集（下書き → 公開）の応答に `coin`（この投稿で配った枚数 0/1）を足す。
    写真の編集で配る判定を通らなかった回（公開にしていない等）は `label` と同じく項目ごと出ない（無ければ 0）
  - **硬貨の数は `GET /user/trunk` の `coins` を正とする。** 応答の `coin` は「この要求で配った枚数」なので、
    配り済みの再送では 0 になる（時間切れ `timeout` のあとに届いていることもある）
  - 「1日3件」は**ラベルか硬貨のどちらかを配った投稿**の数。硬貨だけ配った投稿も指紋・束の台帳に載る
    （同じ写真を上げ直しても、硬貨もラベルも来ない）
  - 投稿から24時間以内の削除・非公開で、ラベルと同じ線で硬貨も取り消す: まだ硬貨を持っていれば1枚減らす。
    0 枚（もう使った）なら何もしない。硬貨は見分けが付かないので、「使ったか」は枚数で見る
- **カプセル**: `POST /user/trunk/gacha` → 硬貨を1枚使い、段を引いてから、その段の部品を等確率で1つ。
  段の出やすさは ふつう 70%・めずらしい 25%・とてもめずらしい 5%（0〜99 の乱数で 0〜69 / 70〜94 / 95〜99）。
  乱数は `crypto.randomInt`。持っていない部品なら `parts` へ、持っていれば `fragments` +1。
  応答 `{ part: { id, kind, rarity, name }, duplicate, fragments, coins }`。硬貨が 0 なら 409 `noCoins`
  - 段ごとの部品の数（台帳から）: ふつう 54・めずらしい 42・とてもめずらしい 12。1点あたりの確率は段の確率 ÷ 段の数
    （例: とてもめずらしいの1点は 5% ÷ 12 ≈ 0.42%）
- **交換**: `POST /user/trunk/parts/exchange { partId }` → かけら5つで、持っていない部品1つ。
  応答は `GET` と同じ形（`posts` なし）＋ `part`。持っていれば 409 `owned`、足りなければ 409 `notEnoughFragments`、
  知らない id は 400 `badPart`
- **付ける**: `PUT /user/trunk/equip { handle?, corner?, lock?, lining?, tag?, charm?, key?, pins?: [最大3], patches?: [最大2] }`。
  本文に在る場所だけ変える。`null` で外す（`pins: null` は全部外す）。持っている部品だけ（無ければ 409 `notOwned`）、
  知らない id は 400 `badPart`、場所と kind が合わなければ 400 `badKind`、数の越え・同じ id の二度付けは 400 `badRequest`。
  型（`model`）とは別に持つ。Pro 限定の部品は無い
  - 応答の `equipped` は場所を全部並べる: `{ handle, corner, lock, lining, tag, charm, key: id|null, pins: id[], patches: id[] }`
- **部品の台帳** `api-user/src/data/trunkParts.json`（iOS も同じファイルを読む）:

      {
        "version": 1,
        "source": "Parts.dc.html（…）",
        "kinds": ["handle", "corner", "lock", "lining", "tag", "pin", "patch", "charm", "key"],
        "rarityNames": ["ふつう", "めずらしい", "とてもめずらしい"],
        "rarityWeights": [70, 25, 5],
        "parts": [ { "id": "handle.1", "kind": "handle", "rarity": 0, "name": "茶の革" }, … 108 件 ]
      }

  id は `<kind>.<1〜12>`。番号と段は板 `Parts.dc.html` の各行の並び順どおり（板の `handles`→`handle`・
  `corners`→`corner`・`locks`→`lock`・`linings`→`lining`・`tags`→`tag`・`pins`→`pin`・`patches`→`patch`・
  `charms`→`charm`・`keys`→`key`）。絵の指定（色・形）は台帳に持たない（アプリが板から描く）。
  **id の番号は変えない**（持ち物として保存される）。部品を足すときは各 kind の後ろに番号を足す
- 退会では `trunk#<uid>` と `trunkledger#<uid>` の2行を消すので、硬貨・部品・かけら・付けた部品・台帳も一緒に消える

*人のトランク（2026-10-18 owner「トランクはマイページに載せたい。他の人のトランクの中身とか見れたら楽しい」・板 TheirTrunk・TheirInside・TrunkPrivacy）*

- **見せる設定**: `PUT /user/trunk/settings { receiveLabels?, showTrunk?, ticket? }`。本文に在る項目だけ変える
  （1つも無い・真偽でない・形が違うは 400 `badRequest`／乗車券の形は 400 `badTicket`）。応答は `GET` と同じ形（`posts` なし）。
  - `showTrunk`（既定 `true`）: `false` の間は人の口が 404。行に書くのは `trunk#<uid>`（rev 条件・今までの設定と同じ書き方）
  - `ticket`: **わたしの乗車券**（すれちがいで交換する本人の1枚。今までは端末の中だけにあった）
    `{ photoId, note?: 20字・80バイト, origin?: 6字・24バイト, destination?: 6字・24バイト, face?: 0〜255（0 はマルス券）, showsFrom?: 真偽（既定 true） }`。
    `null` で外す。改行・制御文字は落とし、前後の空白を取る（**上限を越えたら切り詰めず 400**）。
    写真は**本人の公開写真だけ**（下書き・ストーリー・公開範囲を絞った写真・ほかの人の写真・無い写真は 409 `ticketNotPublic`）
- **読む**: `GET /users/{uid}/trunk`（**ログインした人だけ**）→

      { userId, model, stuck: [ラベル], equipped, posts?,
        inside: { badges, card: { pro } | null, ticket: { photoId, note, origin, destination, face, showsFrom } | null } }

  - `model` は見せている型（`effectiveModel`。Pro をやめた人の Pro の型は出さない）。`equipped` は `GET` と同じ形
  - `stuck` は**貼ったラベルだけ**（置き場 `pos` つき）。1枚は `{ id, kind, place, season?, timeslot?, milestone?, seed, at, foil?, pos?, where }`:
    `id` は**この返答の中の番号**（`s` ＋ 貼った古い順の番号 `s0`・`s1`…）。**写真の id からは計算できない**（写真の id は出さない）。
    画面がラベルを並べ・選ぶためだけのもので、返答をまたいで同じラベルを指す使い道は無い（新しく貼られても前の番号は変わらないが、
    はがす・取り消すとそれより新しい番号はずれる）。`at` は日付だけ（`YYYY-MM-DD`）、
    `where` は「その土地で撮ったその人の写真」を引く手がかり `{ location }`（土地の名前が空なら `null`）。
    アプリは `GET /photos?userId=<uid>`（公開写真の口・管理 API）の結果から、`location` を `,、，/()（）` で割った先頭が
    `where.location` と同じ写真（無ければ `location` に `where.location` を含む写真）を出す。公開していない写真はそもそも来ない
  - **確かめた物だけ見せる**（2026-10-18 判断・`api-user/src/trunkPlace.ts`）: 人の口が地名と `where` を出すのは、
    印 `placeOk`（保存は短い鍵 `o: 1`）のあるラベルだけ。印の無いラベルと、**地名がもともと空のラベル**は、同じ形
    `{ id, kind, seed, foil?, pos?, place: { name: "" }, where: null }` で返す（日付・季節・時刻・節目も落とす。伏せた印の欄も出さない）
    ——伏せたラベルから「いつの投稿が今は見えないか」が分からないよう、2つを見分けられないようにする。
    アプリは「地名が空なら地名なしの形で描く」（`kind`・`seed` は残すので絵は描ける。「はじめての国」でも国名は出さない）。
    **外し忘れても漏れない側**（印が無ければ伏せる）。本番にもう在るラベルも印が無いので、台本で足すまで伏せたまま。
    **自分の口では地名がそのまま見え、確かめたラベルには `placeOk: true` が付く**
    - 印を付けてよいのは、ラベルの写真が**本人の・誰にでも見える公開の写真**（公開の一覧と同じ `feed.ts` の `isPublicListPhoto`。
      下書き・ストーリー・closeFriends・フォロワー限定は違う）で、**撮影地（`placeOf`）が今もラベルの地名と同じ**とき
    - 付ける: 公開の投稿で配ったとき（`POST /upload/save`・下書き → 公開・再送）。絞った範囲で配ったラベルには付かない
    - 付け直す（付ける／外す）: 写真の編集（`PUT /photos/{id}`）で公開・公開範囲・撮影地・座標・スポットに触れたとき
      （`refreshLabelPlaceQuietly`。今の写真を1回強い読みで読み、公開の一覧に載るか・撮影地が変わったときだけ trunk の2行を読んで書く）、
      再送（配りの書き込みに相乗り）。**撮影地を書き換えたら、新しい撮影地で公開のままでも伏せたまま**（ラベルの地名は配ったときのもので、
      書き換えと食い違うため）。元の撮影地に戻せばまた付く
    - **付けたら、書いたあとに写真を強い読みで読み直して確かめる**（配る・付け直す・再送のどれでも）。書くまでのあいだ（競合のやり直し・
      Lambda の凍結）に絞られた・非公開にされた・撮影地が変わったなら、その場で外し直す。外す側は確かめない（外し過ぎても漏れない）
    - 本人の `GET /user/trunk` で、外し損ねた印を外す（読んでいる本人の写真の一覧と突き合わせる＝読みは増やさない）: 印つきなのに
      写真が公開でない・撮影地が違う・一覧に無い（配ってから1時間を過ぎたもの。索引の遅れで、投稿直後の印を外さないため）。付けはしない
    - `POST /upload/save` の再送で書き直した回（公開 → 下書き・絞る・撮影地の変更）も付け直す。写真の差し替え（`replace`）も付け直しの対象
    - 外す: 写真の削除・公開 → 非公開（`revokeLabelQuietly`・24時間以内ならラベルごと取り消す・同じ書き込み）、公開範囲を絞った、
      撮影地を変えた・消した、**管理 API（`api`）の削除と非公開と撮影地の変更**（`api/src/trunkLabelPlaceDrop.ts`・trunk# を rev 条件で置き直す。
      外すだけ）。束のラベルは、誰にでも見える公開の兄弟が同じ撮影地で残っていれば印を残す（絞った兄弟は数えない）
    - 本番にもう在るラベルに印を足す台本: `scripts/backfill-trunk-place-ok.js`（写真は強い読み・競合したら行も写真も読み直す。`--estimate` で表の大きさから見積もり（Scan しない）、
      引数なしは読むだけ＝何枚に付く／外れるかを出す、`--apply` で書く。判定は同じ `trunkPlace.ts`。流すのは owner の承認のあと）
    - 退会は行ごと消すので印も消える
  - `posts` は古び方の段に使う、**誰にでも見える公開の投稿**の数（束は1件・絞った・下書き・ストーリーは数えない）。**自分の口（`GET /user/trunk`）の
    `posts` は今までどおり**（下書き・ストーリーを除いた投稿。絞った写真も数える＝iOS の古び方・節目と同じ）。**人の写真を全部読まないための控え**で、本人が `GET /user/trunk` を開いたときと、
    投稿してラベルか硬貨を配ったときに書く（消したあとは本人が開くまで古い数のまま）。控えが無い行は項目ごと出さない
  - `inside.badges` は公開プロフィールの `badges` と同じ整え方（`sanitizeBadges`。無ければ `{}`）
  - `inside.card` はサポーター番号を持つ人だけ `{ pro }`（`pro` は今 Pro か）。**番号・始めた年月・月数は出さない**
    （名前と @ は公開プロフィールから描く）
  - `inside.ticket` は置いた写真が今も本人の公開写真のときだけ。Pro でなければ `face` は 0（マルス券）。「発」の居住地は公開プロフィールの `homeLocation`
  - **出さない物**: 硬貨・手持ち・上限・作り直し・受け取りの設定・見せる設定・部品箱・かけら・新しいラベルの印・ラベルの数（数えれば分かるのは貼った枚数だけ）・
    受け取った乗車券（サーバーに無い。端末の中だけ）
  - **404 `notFound`（理由は区別しない）**: 見せない設定・見る人と相手のどちらかがブロックしている・退会した（プロフィールが無い・墓石）・
    トランクの行がまだ無い・`uid` が人の id の形でない。**自分を読んだとき**は見せない設定・ブロックを見ずに同じ形を返す（人からの見え方の確かめ）
  - 読みは GetItem だけ（相手のプロフィール・`trunk#`・ブロックの印2つ・乗車券の写真1枚）。台帳の行・人の写真の一覧は読まない。書かない
  - 道筋は trunk 関数に1つ足しただけ（関数・統合・許可・ロール・テーブル・GSI は増やさない）

**光と天気の知らせ（Pro）** ※2026-10-09 追加・**本番未反映**
`GET /user/light-forecast`——「行きたい場所」の公式スポット（`SPOT-<slug>`）の、今日から7日の
光の時刻（現地の時計）と見込み（朝焼け・夕焼け・夜景 × `high`/`mid`/`low`、天気
`clear`/`partlyCloudy`/`cloudy`/`rain`）。**Pro でなければ 403**、WeatherKit の鍵
（SSM パラメータ `/journey-photo/<stage>/weatherkit/key-id`・`private-key`）が無ければ **503**。
応答の形は `api-user/src/lightForecast.ts` の注記。応答の `attribution`（Apple Weather）は
画面に出すこと（Apple の求め）。前の晩の知らせ（毎日 20:00 日本時間）を受け取るかは
`PUT /user/profile` の `lightAlert`（真偽・既定 `true`）

**外部サービスの代理**
`GET /music/search`（Apple Music）/ `GET /geocode/search`・`GET /geocode/reverse`
（Nominatim。**1秒間隔・30日の控え**——規約なので、別プロジェクトから
Nominatim を直に叩かずここを通すこと）

**絞った公開範囲**
`GET /feed/restricted`

公開範囲を絞った写真（`audience` が `followers`・`closeFriends`）には、未認証の
`GET /photos/{id}/like`・`GET /photos/{id}/comments` が **404** を返す（閲覧者が
分からないため）。ログイン中に見せてよい相手（本人・フォロワー・親しい友達）が読む口:

- コメント … `GET /user/comments/{id}`（応答は未認証の口と同じ `{ items, count }`）
- いいね数 … `GET /user/likes/{id}` の `count`

`GET /user/likes/{id}` の応答（`Cache-Control: private, no-store`）:

```jsonc
{ "liked": true, "count": 4 }  // count は写真を見てよい相手のときだけ
{ "liked": true }              // 見せない相手・下書き・ストーリー・無い写真・数を読めなかった
```

- `liked` … 自分のいいねの印が在るか。**写真が見えなくても返す**（本人が解除の導線を出すのに要る）
- `count` … いいね数（0以上の整数）。**無いときは数を表示しない**（0 と読まない）。
  見せない相手でも 404 にはしない（`liked` を返すため）
- `DELETE /photos/{id}/like` も、見せない相手には数を返さず 404

### 公開写真のページ（`GET /feed`）

`api-user/src/feed.ts`。`photos.json` と同じ項目の写真を、**新しい順に決まった枚数ずつ**返す。

    GET /feed?limit=30&cursor=<前の応答の nextCursor>

| クエリ | 意味 |
|---|---|
| `limit` | 1〜60。省くと 30、60 を超えたら 60 に丸める。数でない・0 以下は **400** |
| `cursor` | 前の応答の `nextCursor` をそのまま。**中身を読まない・作らない**（不透明な文字列）。壊れた・書き換えた値は **400** |

    200 { "items": Photo[], "nextCursor": string | null }

- `nextCursor` が `null` なら終わり。**`items` が `limit` より少なくても `nextCursor` があれば続きがある**
  （ふるいで落ちる行が続いたとき、1回で読む上限で打ち切って続きを回す）。`items` が空で `nextCursor` だけ返ることもある
- 返すのは公開中の写真だけ（非公開・ストーリー・公開範囲を絞った写真は出ない）。表示名は**いまの名前**
- 失敗は `{ "error": "<日本語の一文>" }`（400: `limit が不正です` / `cursor が不正です`、500: `取得に失敗しました`）
- 索引 `publicFeed-createdAt-index` を読む。**本番にこの索引が無いあいだは 500 になる**（2026-09-16 の診断では本番に無かった）
- カーソルの形は正しくても DynamoDB がキーとして受け付けなかった（`ValidationException`）ときは **400** `cursor が不正です`
- ロールは専用の `PublicFeedRole`（ログ・この索引の Query・users テーブルの GetItem だけ）。共有の `PublicReadRole` には索引の権限を足さない
- 🔴 **本番に出す前に確かめること**（どちらかが欠けると、500 になるか、公開写真が一覧から黙って抜ける）:
  1. 索引 `publicFeed-createdAt-index` が **ACTIVE** であること（作成中・無いあいだは 500）
  2. `scripts/add-public-feed-index.js` の**ドライラン**で「**印が必要な公開写真 0 件**」「**createdAt を持たない公開写真 0 件**」と出ること
     （印 `publicFeed` が無い行・`createdAt` が無い行は索引に載らず、`/feed` に出てこない）

---

## 6. 写真の型

`lib/data/photos.ts` の `Photo`。API が返す JSON もこの形。

```ts
type Photo = {
    id: string;
    src: string;                  // 表紙（≤1600px WebP）
    srcAvif?: string;             // 同 AVIF
    thumbSrc?: string;            // 一覧用 512px WebP
    thumbAvif?: string;           // 同 AVIF
    thumbSm?: string;             // 256px WebP
    thumbSmAvif?: string;         // 同 AVIF
    width?: number; height?: number; aspectRatio?: number;
    dominantColor?: string;       // "#rrggbb"
    blurDataURL?: string;         // data:image/webp;base64,...（20px）

    title?: string | { ja?: string; en?: string };
    alt?: string | { ja?: string; en?: string };
    description?: string | { ja?: string[]; en?: string[] };   // 段落の配列
    category?: string;            // スラッグ（landscape / architecture / nature / …）
    tags?: string[];
    location?: string;
    coords?: { lat: number; lng: number };
    geoApprox?: boolean;          // 地名から引いた「おおよその位置」
    spotId?: string;              // 撮影スポット台帳への参照（人が確認した紐付けだけ）
    inspiredBy?: string;          // 「この写真を見て撮影」の元の写真の ID（ID だけ。今も見られるかは
                                  //  読む側が確かめる・`docs/inspired-by.md`）
    date?: string;                // "YYYY-MM-DD" か壁時計の "YYYY-MM-DDTHH:mm:ss"
    exif?: { camera?: string; lens?: string; aperture?: string; ... };

    extraImages?: PhotoImage[];   // 2枚目以降（表紙は src のまま）
    focalPoint?: { x: number; y: number };
    song?: { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string };
    songYoutubeUrl?: string;

    published?: boolean;          // **未指定は公開**（`!== false` で判定する）
    featured?: boolean;           // 運営が選んだ「おすすめ」。管理APIだけが書く
    audience?: string;            // 空でなければ「絞った写真」
    userId?: string;
    likes?: number; commentCount?: number;
    createdAt?: string; updatedAt?: string;
};
```

⚠️ **`published` は「未指定＝公開」。** `p.published !== false` で判定する
（`=== true` にすると古い行が全部消える）。

⚠️ **派生（`thumbSrc` / `srcAvif` …）は無いことがある。** ビルドが後から埋める
ので、上げた直後は `src` だけ。**読む側は必ず落とし先を持つこと**。

⚠️ **日時は2つの形が混ざる。** `date` は `YYYY-MM-DD` か**ゾーン無しの壁時計**
（EXIF 由来）。`new Date()` に渡すと**閲覧者のタイムゾーンで解釈が変わって
並びが入れ替わる**——文字列のまま比べる（`lib/utils/photoOrder.ts`）。

---

## 7. 写真を上げる（3段）

```ts
// 1) 署名付き URL をもらう
const r1 = await userFetch("/upload/presigned-url", {
    method: "POST",
    body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,     // 画像: image/jpeg | image/png | image/webp
                                 //       | image/avif | image/gif | image/heic | image/heif
                                 // 動画: video/mp4 | video/webm | video/quicktime
                                 //   （この口は動画も通す。用途はストーリー。
                                 //    アバターの presign だけは画像のみ）
        fileSize: file.size,     // **必須**。署名に含まれるので、1バイトでも違うと 403
    }),
});
const { presignedUrl, key, publicUrl, photoId, contentType } = await r1.json();
// ⚠️ この `photoId` は**鍵を組むための採番（uuid v4）で、保存される写真の id ではない**。
//    保存側は `id = uuidv5(key)`（`uploadPolicy.ts` の `idFromUploadKey`）。
//    写真の id が要るなら 3) の応答 `photo.id` を使う。

// 2) S3 へ直接 PUT（**この1本だけ API Gateway を通らない**）
await fetch(presignedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },   // 署名した種別と同じものを送る
});

// 3) 行を保存
const r3 = await userFetch("/upload/save", {
    method: "POST",
    body: JSON.stringify({
        key, publicUrl,
        title, description, location, category, tags,
        exif, coords, dominantColor, thumbUrl, blurDataURL,
        published: true,          // false で下書き
        albumId,                  // 共同アルバムへ入れるとき
    }),
});
const { success, photo } = await r3.json();
```

🔴 **署名は `Content-Length` と `Content-Type` まで縛っている。**
申告した長さちょうど・申告した種別でしか PUT できない（`0b7c1c8` / `738bef3`）。
**staging で1枚通してから本番へ**。

🔴 **PUT の前にキーを控える。** 保存に失敗したときに `DELETE /upload/discard`
で実体を捨てないと、**どの行からも辿れない孤児**が S3 に残る
（掃除する経路が無い）。

🔴 **位置情報は上げる前に落とす。** このリポジトリは画面側で EXIF を除去して
いる（`lib/utils/image.ts` / `lib/utils/video.ts`）。**向きの情報（Orientation）
だけは残す**——一緒に消すと縦の写真が横倒しで公開される（`49ab6d2c`）。

🔴 **再送は冪等。** 保存される id は **key から uuid v5 で導く**ので、同じ key で
2回 `save` しても写真は1枚（2回目は保存済みの行を返す）。
**鍵に書いてある UUID をそのまま id にはしない**——鍵が presign されたものか
誰も確かめていないので、それだと写真の id を選び放題になる。

---

## 8. エラーと上限

### エラーの形

```json
{ "error": "アップロード上限（1000枚）に達しています" }
```

**日本語の一文が入っている。** 画面にそのまま出してよい。例外は
**API Gateway が返す 401**（英語の定型）で、そこだけ置き換える。

| 状態 | 意味 |
|---|---|
| 400 | 入力が不正（理由は `error` に日本語で入る） |
| 401 | トークンが無い・期限切れ |
| 403 | 権限が無い |
| 404 | 無い。**他人のものにも 404 を返す**（実在を教えないため） |
| 409 | 既にある／使用中 |
| 500 | サーバー側の失敗 |

### 主な上限（コードから抜いた実値）

| | 値 | 出どころ |
|---|---|---|
| 1人の写真 | **1000枚** | `photoLimit.ts` |
| 1ファイル | **50MB** | `upload.ts` |
| 1投稿の追加画像 | 9枚 | `photoImages.ts` |
| コメント | 1枚に200件・1件500文字 | `comments.ts` |
| ストーリー | 24時間に20本 | `stories.ts` |
| ストーリーの文字 | 5つ・1つ200文字 | `storyText.ts` |
| ストーリーの返信 | 200件 | `storyReplies.ts` |
| 通知 | 50件（古いものから押し出す） | `notify.ts` |
| フォロー中の一覧 | 2000人 | `follow.ts` |
| ブロック | 500人 | `block.ts` |
| 親しい友達 | 200人 | `closeFriends.ts` |
| 行きたい場所 | 500件 | `savedSpots.ts` |
| 旅行プラン | 50件・60日・1日20項目 | `tripPlans.ts` |
| 共同アルバム | 1人50個・1つ50人・500枚 | `invite.ts` |
| ハイライト | 20個・1つ100本 | `highlights.ts` |
| 旅のトランク | 手持ち 無料30・Pro150／貼る1200／1日3件／作り直し 月3回／指紋の台帳3000／硬貨99枚／交換はかけら5つ／ピン3・ワッペン2 | `trunk.ts` |
| プロフィールの曲 | 5曲 | `userProfile.ts` |
| 招待リンクの期限 | 30日 | `invite.ts` |

### 踏みやすいところ

- **Lambda の同時実行がアカウント全体で 10。** 予約は1つも取れない。
  重い並列呼び出しをすると**サイト全体が詰まる**
- **`GET /photos` はテーブルを全走査**して、同じ Lambda インスタンス内で
  10秒だけ使い回す。連打しない
- **`/geocode/*` は 1リクエスト/秒**（Nominatim の規約）。実時間で待つので、
  連続で叩くと1回ごとに1秒かかる
- **一覧の書き込みは楽観ロック**（`rev` を条件に Put → 競合したら読み直す）。
  同じ利用者の一覧を並行で書くと1回やり直しが入る

---

## 9. 関連ファイル

| | |
|---|---|
| 口の定義・認証・IAM | `api-user/serverless.yml` / `api/serverless.yml` |
| 実装 | `api-user/src/*.ts` / `api/src/*.ts` |
| 画面側の呼び出し | `lib/utils/api.ts` |
| 認証 | `lib/auth/cognito.ts` / `lib/auth/session.ts` |
| 写真の型 | `lib/data/photos.ts` |
| 並び順 | `lib/utils/photoOrder.ts` |
| 画像URLの正規化 | `lib/utils/seo.ts` の `publicImageUrl` |
| 本番のリソース一覧 | `CLAUDE.md` |
