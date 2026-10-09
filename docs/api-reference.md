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

### ユーザーAPI（`NEXT_PUBLIC_USER_API_BASE_URL`）— 74口

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

残り68口はすべて `Authorization: Bearer <IDトークン>` が要る:

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
`DELETE /photos/{id}/comments/{commentId}`）/ `POST /photos/{id}/report`

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
