import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { ScanCommand, QueryCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, PHOTOS_TABLE, USER_INDEX, STORY_INDEX, STORY_FEED_KEY } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError, isAdmin } from "./http";
import { lookupDisplayName, deletedUserIds, DELETED_USER_NAME } from "./notify";
import { mediaKeys, deriveUploadKey } from "./mediaKeys";
import { isOwnUploadUrlFromEnv as isOwnUploadUrl, keyFromUploadUrl, canonicalUploadUrl } from "./uploadPolicy";
import { s3DeleteMany } from "./s3Delete";
import { invalidateUploads } from "./cdnInvalidate";
import { safeSongPreviewUrl, safeSongArtworkUrl, safeSongTrackUrl } from "./mediaHosts";
import { truncate, sanitizeText, sanitizeCoords } from "./sanitize";
import { storyRepliesId, visibleReplyCount } from "./storyReplies";
import { hiddenUserIds, isBlocked } from "./blockCheck";
import { closeFriendsId, isUserId } from "./closeFriends";
import { readUserList } from "./userList";

// バケット名の検証と S3 の削除は `s3Delete.ts` に寄せた（未設定なら
// そちらの読み込みで止まる）。
const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const STORY_DAILY_LIMIT = 20; // 1ユーザーが24時間に投稿できるストーリー数
const STORY_DEFAULT_DURATION_SEC = 5; // 画像ストーリーの既定表示秒数（この値なら保存しない）

// ストーリーレコードから S3 オブジェクトキーを導出する
// （key フィールド優先、無ければ src の URL パスから）
function deriveStoryKey(item: Record<string, unknown>): string {
    // 判定は mediaKeys の deriveUploadKey に寄せる（デコードしてから見る）。
    // ここだけ生のパスで見ていると、保存時の検証と食い違って
    // 「作れるが消せない」オブジェクトができる。
    if (typeof item.key === "string" && item.key) return deriveUploadKey(item.key);
    return deriveUploadKey(item.src);
}

/**
 * ストーリー削除時に消すべき S3 キー。
 *
 * 原本（key / src）だけでは足りない。サムネ生成スクリプトが以前ストーリーも
 * 対象にしていたため、AVIF や小サイズの派生が max-age=31536000 で
 * 残っている個体がある。原本だけ消すと「24時間で消えるはずのものが
 * 公開URLで取得できる」状態になる。退会処理と同じ列挙を使う。
 */
function storyMediaKeys(item: Record<string, unknown>): string[] {
    // **ギャラリーに残した1枚の実体は消さない。**
    // `keptAs` が立っているストーリーは、その S3 オブジェクトの持ち主が
    // 写真の行に移っている（`storyKeep.ts`）。ここで消すと、残したはずの
    // 写真が**割れた画像**になる——しかも写真の行は残るので、一覧にも
    // 個別ページにも壊れた枠が並ぶ。
    // 消すのは行だけ＝**24時間で消える約束は守られる**（残るのは本人が
    // 選んだ1枚で、それは「ストーリー」ではなく「写真」になっている）。
    if (typeof item.keptAs === "string" && item.keptAs) return [];
    const keys = new Set(mediaKeys(item));
    const primary = deriveStoryKey(item);
    if (primary) keys.add(primary);
    return [...keys];
}

// 過去24時間にこのユーザーが投稿したストーリー数を数える（レート制限用）
async function countRecentStories(userId: string): Promise<number> {
    const since = new Date(Date.now() - STORY_TTL_MS).toISOString();
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :u AND createdAt >= :since",
            FilterExpression: "story = :t",
            ExpressionAttributeValues: { ":u": userId, ":since": since, ":t": true },
            Select: "COUNT",
            ExclusiveStartKey: lastKey,
        }));
        count += res.Count ?? 0;
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return count;
}

/**
 * ストーリーを引く。
 *
 * GSI（storyFeed-expiresAt-index）を Query する。以前はテーブル全体の Scan で、
 * 同居しているいいね/フォローのマーカー（退会しても消えない）が増えるほど
 * 重くなり、いずれ実行時間を超えて「ログイン中の全員のストーリー欄が
 * 同時に壊れる」という壊れ方をする作りだった。
 *
 * GSI がまだ無いテーブル（作成直後・移行前）では Scan に落ちる。
 * ここを落とすと機能ごと止まるので、遅くても動く方に倒す。
 * ストーリーは24時間で入れ替わるので、GSI を足せば1日で全件が載る。
 */
async function queryStories(filter: "active" | "expired"): Promise<Record<string, unknown>[]> {
    const now = new Date().toISOString();
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    try {
        do {
            const res = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: STORY_INDEX,
                KeyConditionExpression: filter === "active"
                    ? "storyFeed = :k AND expiresAt > :now"
                    : "storyFeed = :k AND expiresAt <= :now",
                ExpressionAttributeValues: { ":k": STORY_FEED_KEY, ":now": now },
                ExclusiveStartKey: lastKey,
            }));
            items.push(...((res.Items ?? []) as Record<string, unknown>[]));
            lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);
        return items;
    } catch (e) {
        const name = (e as { name?: string }).name;
        if (name !== "ValidationException" && name !== "ResourceNotFoundException") throw e;
        console.warn(`queryStories: ${STORY_INDEX} が無いため Scan にフォールバックします`);
    }
    return scanStories(filter);
}

/** GSI が無い環境向けのフォールバック。テーブル全体を読むので遅い */
async function scanStories(filter: "active" | "expired"): Promise<Record<string, unknown>[]> {
    const now = new Date().toISOString();
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: PHOTOS_TABLE,
            FilterExpression: filter === "active" ? "story = :t AND expiresAt > :now" : "story = :t AND expiresAt <= :now",
            ExpressionAttributeValues: { ":t": true, ":now": now },
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Record<string, unknown>[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items;
}

// GET /stories — 有効期限内のストーリー一覧（ログインユーザー限定）
// ストーリーは「消える・身内向け」の性質上、閲覧もログインユーザーに限定する。
// viewers（閲覧者情報）は本人しか見られないため、レスポンスからは常に除外する。
export const getStories: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    try {
        // **ブロックした相手・ブロックした相手のストーリーは出さない（両向き）。**
        // 一覧を引くたびに自分の2行（`blocks#` と `blockedby#`）を読むだけ。
        // 失敗しても一覧は返す——**見えなくする側が落ちたときに全部消す**のは
        // 倒しすぎで、ストーリーが誰にも出なくなる（`listAlbums` の掃除と同じ判断）。
        //
        // **ストーリーの取得と同時に投げる。** 直列にしていたので、
        // 一覧が返ってくるまで待ってからブロックを引いていた＝往復が1回増えた。
        // 互いの結果に依存しないので並べてよい。
        const [items, hidden] = await Promise.all([
            queryStories("active"),
            hiddenUserIds(userId)
                .catch((e) => { console.error("getStories: ブロック一覧を読めませんでした:", e); return new Set<string>(); }),
        ]);
        for (const item of items) {
            delete item.viewers;
            // **返信の数は投稿者にだけ返す。** 見た人には「このストーリーに
            // 何件届いたか」を知らせない（誰が反応したかは `viewers` と同じく
            // 本人だけのもの）。所有者の画面はこの数でバッジを出す
            if (item.userId !== userId) {
                delete item.replyCount;
                // 「残した」印も本人だけ。画面は `isOwnStory` で守っているが、
                // 応答に出す理由が無い（`viewers` と同じ扱い）
                delete item.keptAs;
            }
        }
        const notBlocked = hidden.size === 0 ? items : items.filter((i) => !hidden.has(String(i.userId ?? "")));

        // **公開範囲。** 「フォロワーのみ」の行は、本人とフォロワーにだけ。
        // 確かめられなかったら見せない（`isVisibleToViewer` の注記）
        const ownersOf = (audience: string) => new Set(
            notBlocked.filter((i) => i.audience === audience)
                .map((i) => String(i.userId ?? ""))
                .filter((id) => id && id !== userId),
        );
        const followerOwners = ownersOf("followers");
        const closeOwners = ownersOf("closeFriends");
        const [followed, closeFriendOf] = await Promise.all([
            followerOwners.size === 0 ? new Set<string>() : followedAmong(userId, followerOwners),
            closeOwners.size === 0 ? new Set<string>() : closeFriendsAmong(userId, closeOwners),
        ]);
        const visible = notBlocked.filter((i) => isVisibleToViewer(i, userId, followed, closeFriendOf));

        // **バッジの数も、返信一覧と同じふるいを通した数にする。**
        //
        // `replyCount` は行が持つ「全部の数」。`getStoryReplies` がブロック分を
        // 落とすので、ここを通さないと**バッジだけ多いまま**になる——
        // 「返信 1件」を押すと「まだ返信はありません」。しかも**ブロックの導線は
        // 返信一覧の中にしか無い**ので、「返信1件 → 読む → ブロック」＝
        // いちばん起きる筋でそうなる。`StoryViewer` はこの数が 0 ならボタンを
        // 出さない（「押しても何も無いボタンを常に置かない」）ので、揃えれば
        // ボタンごと消える。
        //
        // **払うのはブロックしている人の、自分のストーリーのぶんだけ。**
        // `hidden` が空なら `visibleReplyCount` は即 null を返して読みに行かない
        // ＝ブロックしていない人（ほとんど）は1回も増えない。自分のストーリーは
        // 24時間で20本までなので上限も小さい。
        //
        // **見張りは1本ずつ。** 「ブロックしていなければ読まない」は
        // `visibleReplyCount` が持ち（空集合なら即 null）、「自分のストーリー
        // だけ」は**すぐ上で `replyCount` を落としていること**が持つ。
        // ここで `userId === userId` や `hidden.size > 0` を書き足すと
        // 二重になり、**片方を壊してもテストが緑**になる（台帳の型1。実際、
        // 最初はそう書いて変異2種が生き残った）。
        const withCount = visible.filter((i) => typeof i.replyCount === "number" && i.replyCount > 0);
        await Promise.all(withCount.map(async (item) => {
            const n = await visibleReplyCount(String(item.id ?? ""), hidden);
            // 読めなければ行の数のまま（バッジを消して唯一の入口を奪わない）
            if (n !== null) item.replyCount = n;
        }));
        visible.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
        return {
            // 認証済みユーザー個別のレスポンスなので共有キャッシュには載せない
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify(visible),
        };
    } catch (e) {
        console.error("getStories error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /stories — ストーリー投稿（認証必要）。
// 画像/動画は既存の presigned-url フローでアップロード済みであることを前提にレコードだけ作成する。
/**
 * 公開範囲。**受け取るのは「フォロワーのみ」だけ。**
 *
 * 「全体に公開」は属性を書かない形で表す（既にある行と同じ）。
 * 知らない値は**全体に公開へ倒さない**——倒すと、綴りを間違えた
 * 「フォロワーのみ」が全員に見える。倒すのは**狭い側**。
 */
export type Audience = "followers" | "closeFriends";

export function sanitizeAudience(value: unknown): Audience | undefined {
    return value === "followers" || value === "closeFriends" ? value : undefined;
}

/**
 * その人に、その行を見せてよいか。
 *
 * **閉じる側に倒す。** フォローしているかを確かめられなかったら**見せない**
 * ——ブロックの絞り込みは「落ちたら出す」に倒してあるが（見えなくする側が
 * 落ちて全部消えるのは倒しすぎ）、こちらは逆。**見せてよいか分からない**の
 * だから、出す方に倒すと「フォロワーだけ」のつもりの写真が他人に見える。
 */
export function isVisibleToViewer(
    item: { userId?: unknown; audience?: unknown },
    viewerId: string,
    followedOwners: Set<string>,
    closeFriendOf: Set<string> = new Set(),
): boolean {
    const audience = item.audience;
    if (audience !== "followers" && audience !== "closeFriends") return true;
    const owner = String(item.userId ?? "");
    if (!owner) return false;
    if (owner === viewerId) return true;
    // **親しい友達はフォローでは代用できない。** フォローしていても
    // 選ばれていなければ見せない（狭い方が勝つ）
    return audience === "closeFriends" ? closeFriendOf.has(owner) : followedOwners.has(owner);
}

/**
 * 自分がフォローしている相手のうち、この一覧に出てくる人だけを引く。
 *
 * 全部のフォローを引かないのは、**見るのはストーリーを出している人だけ**で
 * 足りるため（1回の一覧に出る投稿者はたかだか数人）。
 * 読めなかった相手は**含めない**＝見せない側に倒る。
 */
async function followedAmong(viewerId: string, owners: Set<string>): Promise<Set<string>> {
    const found = new Set<string>();
    await Promise.all([...owners].map(async (owner) => {
        try {
            const res = await ddb.send(new GetCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: `follow#${owner}#${viewerId}` },
                ProjectionExpression: "id",
            }));
            if (res.Item) found.add(owner);
        } catch (e) {
            console.error("followedAmong: フォローを確かめられませんでした:", e);
        }
    }));
    return found;
}

/**
 * その人たちのうち、**自分を「親しい友達」に入れている人**。
 *
 * 一覧は持ち主の行（`closefriends#<持ち主>`）にあるので、
 * 出している人ぶんだけ読む。**読めなかった相手は含めない**＝見せない側に倒る。
 */
async function closeFriendsAmong(viewerId: string, owners: Set<string>): Promise<Set<string>> {
    const found = new Set<string>();
    await Promise.all([...owners].map(async (owner) => {
        try {
            const list = await readUserList(closeFriendsId(owner), isUserId, `closefriends#${owner}`);
            if (list.includes(viewerId)) found.add(owner);
        } catch (e) {
            console.error("closeFriendsAmong: 親しい友達を確かめられませんでした:", e);
        }
    }));
    return found;
}

export const createStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    // displayName は受け取らない（なりすまし防止のためサーバーで引く）。
    // key も受け取らない（publicUrl から導く。下のコメント参照）。
    let body: {
        publicUrl?: string; caption?: string; mediaType?: string; song?: unknown; durationSec?: unknown;
        location?: unknown; coords?: unknown; audience?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const publicUrl = (body.publicUrl ?? "").trim();
    if (!publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像URLが必要です" }) };
    }
    // 自分のアップロード領域を指すURLだけを受け付ける。
    // 判定は uploadPolicy.ts の isOwnUploadUrlFromEnv に寄せる（未設定なら通さない）。
    // userId を渡して「他人の領域」を弾くのが要（下の key の話と対になる）。
    if (!isOwnUploadUrl(publicUrl, userId)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }

    // 削除用のキーはクライアントから受け取らず、検証済みの publicUrl から導く。
    // 受け取っていた頃は、自分の正当な publicUrl と一緒に他人のキーを送り、
    // 直後に自分のストーリーを削除するだけで相手のファイルを消せた。
    const key = keyFromUploadUrl(publicUrl);
    // 保存する src も、検証したときに見ていた形に揃える
    const safeSrc = canonicalUploadUrl(publicUrl, process.env.CLOUDFRONT_URL ?? "");

    const mediaType = body.mediaType === "video" ? "video" : "image";
    const caption = truncate((body.caption ?? "").trim(), 200) || undefined;

    // **撮影地。** ストーリーにも場所を持たせる理由は2つある:
    //   1. 見る側に「どこで」が伝わる（Instagram のロケーションと同じ）
    //   2. **ギャラリーに残したときに、そのまま写真の撮影地になる**
    //      （`storyKeep.ts`）——このサイトの価値は 撮影地 → 地図 →
    //      `/location/<スラッグ>` → **検索流入** なので、ここが空だと
    //      残しても本人が手で打つまで何にも繋がらない
    //
    // 検証は写真と同じものを通す（`sanitizeText` / `sanitizeCoords`）。
    // 座標は約1kmに丸めたものだけを受ける——生の緯度経度を公開URLに
    // 載せないのは、このリポジトリが写真で一貫して守っている線
    // **動画には位置を付けない。** 位置は写真の EXIF から来るもので、動画は
    // `toUploadSafeVideo` が GPS を落としている——画面側の1か所だけで守ると、
    // 細工した要求で動画に座標を付けられる（「片側だけの防御」を作らない）
    const location = mediaType === "image" ? (sanitizeText(body.location, 200) || undefined) : undefined;
    const coords = mediaType === "image" ? (sanitizeCoords(body.coords) ?? undefined) : undefined;

    // 画像ストーリーの表示秒数。投稿者が選べる（既定5秒）。
    // 3秒未満は読み切れず、15秒を超えると見る側が飽きるため範囲を固定する。
    const durationSec = (() => {
        const n = typeof body.durationSec === "number" ? body.durationSec : Number(body.durationSec);
        if (!Number.isFinite(n)) return undefined;
        const clamped = Math.round(Math.min(15, Math.max(3, n)));
        return clamped === STORY_DEFAULT_DURATION_SEC ? undefined : clamped;
    })();

    // ストーリーBGM: title + https の previewUrl 必須（30秒プレビュー）
    let song: { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string; startSec?: number } | undefined;
    if (body.song && typeof body.song === "object" && !Array.isArray(body.song)) {
        const o = body.song as Record<string, unknown>;
        // ホストまで確かめる。ストーリーはログイン中の全員のトレイに出るので、
        // https だけを見ていた頃は、1回仕込むだけで利用者ほぼ全員の
        // IP・User-Agent・時刻を集められた（音源は先読みされる）。
        const previewUrl = safeSongPreviewUrl(o.previewUrl);
        const title = typeof o.title === "string" ? truncate(o.title.trim(), 200) : "";
        if (previewUrl && title) {
            const artist = typeof o.artist === "string" ? truncate(o.artist.trim(), 200) : "";
            const artwork = safeSongArtworkUrl(o.artwork);
            const trackUrl = safeSongTrackUrl(o.trackUrl);
            // 「好きな部分」= 30秒プレビュー内の再生開始位置（0〜29秒）
            const rawStart = typeof o.startSec === "number" ? o.startSec : Number(o.startSec);
            const startSec = Number.isFinite(rawStart) && rawStart > 0 ? Math.min(29, Math.round(rawStart)) : undefined;
            song = {
                title,
                previewUrl,
                ...(artist ? { artist } : {}),
                ...(artwork ? { artwork } : {}),
                ...(trackUrl ? { trackUrl } : {}),
                ...(startSec ? { startSec } : {}),
            };
        }
    }

    // 1日の投稿上限チェック（スパム防止）。
    // **数えられなかったら止める。** 「数え上げ失敗は投稿を止めない」に
    // していた頃は、スロットリングを起こせば上限を素通りできた。
    // 写真の100枚制限（upload.ts の photoLimitError）は同じ判断を
    // 「数えられなければ 503」に倒してあり、こちらだけ逆向きだった。
    try {
        if (await countRecentStories(userId) >= STORY_DAILY_LIMIT) {
            return jsonError(429, `24時間の投稿上限（${STORY_DAILY_LIMIT}件）に達しています`);
        }
    } catch (e) {
        console.error("countRecentStories error:", e);
        return jsonError(503, "投稿数を確認できませんでした。時間をおいてもう一度お試しください");
    }

    // 表示名はサーバーで引く。クライアントの申告を保存していたため、
    // 「Journey 運営」のような名前でストーリーを出せた（ストーリーは
    // ログイン中の全員のトレイに並ぶので、なりすましがそのまま届く）。
    // 閲覧記録（viewStory）は既に同じ方針。
    const displayName = await lookupDisplayName(userId) || undefined;

    const now = Date.now();
    const story = {
        id: `story-${randomUUID()}`,
        story: true,
        // ストーリー一覧用 GSI のパーティションキー。定数なので story 項目だけが
        // この索引に載る（写真もマーカーもコメント文書も載らない）。
        storyFeed: STORY_FEED_KEY,
        published: false, // ギャラリー・photos.json から除外するため
        src: safeSrc,
        ...(key ? { key } : {}), // 期限切れ削除時に S3 オブジェクトを消すために保持
        mediaType,
        ...(caption ? { caption } : {}),
        ...(location ? { location } : {}),
        // **座標は地名とセットのときだけ持つ。** 地名の無い座標は画面に
        // 出しようがなく（ピンだけ置く画面がストーリーには無い）、
        // 残したときも「名前の無い点」が地図に増えるだけになる
        ...(location && coords ? { coords } : {}),
        ...(song ? { song } : {}),
        ...(durationSec ? { durationSec } : {}),
        // 公開範囲。**「全体に公開」は書かない**——既にある行と同じ形にして、
        // 「属性が無い＝全体に公開」を1通りに保つ（`tags: []` で踏んだ穴と同じ）
        ...(() => { const a = sanitizeAudience(body.audience); return a ? { audience: a } : {}; })(),
        userId,
        ...(displayName ? { displayName } : {}),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + STORY_TTL_MS).toISOString(),
        updatedAt: new Date(now).toISOString(),
    };

    try {
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: story,
            // 新規作成専用。このテーブルには通知（notifs#…）やコメント
            // （comments#…）も同居しているので、条件が無いと同じIDの既存文書を
            // 丸ごと置き換えられる。ID は story-<UUID> なので衝突は現実には
            // 起きないが、putPhoto が同じ理由で付けている作法から外れない
            // （1か所だけ緩いと、次に書く人がそちらを手本にする）。
            ConditionExpression: "attribute_not_exists(id)",
        }));
        return { statusCode: 201, headers: JSON_HEADERS, body: JSON.stringify({ success: true, story }) };
    } catch (e) {
        console.error("createStory error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "投稿に失敗しました" }) };
    }
};

// POST /stories/{id}/view — 閲覧記録（認証必要・投稿者本人の閲覧は記録しない）
export const viewStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const viewerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!viewerId || !storyId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        if (item.userId === viewerId) {
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, self: true }) };
        }
        // **ブロックした相手の閲覧は記録しない。** 一覧（`getStories`）からは
        // 隠しているが、期限をまたいで開きっぱなしのタブや直接叩く経路では
        // ここに来る（この関数のコメント自身がそう書いている）。記録すると、
        // 所有者の閲覧者一覧に**相手が付けた任意の表示名**がそのまま出る
        if (await isBlocked(String(item.userId ?? ""), viewerId)) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        // **期限切れは「もう無い」。**
        //
        // 行が残っているのは掃除が日次だからで、一覧（`getStories`）は
        // とっくに返していない。ここに来るのは**期限をまたいで開きっぱなしの
        // タブ**か、直接叩いた場合。記録すると、消えたはずのストーリーに
        // 閲覧者が増え続ける——本人には「24時間で消えた」ものの閲覧者が
        // あとから増えて見え、掃除が来るまで（最大およそ24時間）続く。
        // 判定は `queryStories` と同じ ISO 文字列の比較。`expiresAt` を
        // 持たない古い行は有効扱い（無い理由で締め出さない）。
        const expiresAt = typeof item.expiresAt === "string" ? item.expiresAt : "";
        if (expiresAt && expiresAt <= new Date().toISOString()) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }

        // 表示名はサーバーで引く。クライアント申告を保存すると、改造したクライアントから
        // 任意の名前で閲覧履歴に載れてしまう（notify.ts も同じ理由で申告を信用していない）。
        // 記録すると決まってから引く（本人の閲覧や404では無駄に叩かない）。
        const displayName = await lookupDisplayName(viewerId);

        // viewers マップが無ければ作ってから、閲覧者エントリを追加（初回閲覧時刻を保持）。
        //
        // **両方に attribute_exists(id) が要る。** DynamoDB の UpdateItem は
        // キーが無ければ**作る**ので、条件が無いと「見たよ」の報告が
        // 削除と競合したときに、消えたはずのストーリーIDで新しい行ができる:
        //   { id: "story-abc", viewers: { <閲覧者のsub>: { displayName, at } } }
        // この行は story も src も userId も storyFeed も持たないので、
        // 期限切れ掃除（GSIを引く）・退会削除（GSIを引く）・写真一覧（src必須）の
        // どれからも辿れない＝誰にも消せないゴミが残る。
        // しかも「消したストーリーを誰が見たか」が本人の手の届かない場所に残る。
        // comments.ts:184 と likes.ts が同じ理由で条件を付けている。
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: storyId },
                UpdateExpression: "SET viewers = if_not_exists(viewers, :empty)",
                ConditionExpression: "attribute_exists(id)",
                ExpressionAttributeValues: { ":empty": {} },
            }));
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: storyId },
                UpdateExpression: "SET viewers.#uid = if_not_exists(viewers.#uid, :v)",
                ConditionExpression: "attribute_exists(id)",
                ExpressionAttributeNames: { "#uid": viewerId },
                ExpressionAttributeValues: {
                    ":v": { ...(displayName ? { displayName } : {}), at: new Date().toISOString() },
                },
            }));
        } catch (e) {
            // 読んだあとに消された。記録するものが無いだけなので 404 で返す
            // （上の存在チェックと同じ扱い）。
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
            }
            throw e;
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("viewStory error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "記録に失敗しました" }) };
    }
};

// GET /stories/{id}/viewers — 閲覧者リスト（投稿者本人のみ）
export const getStoryViewers: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const callerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!callerId || !storyId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        if (item.userId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "権限がありません" }) };
        }

        // **退会した人の名前を出さない。**
        //
        // 閲覧のときに引いた表示名を焼き込んでいるので（`viewStory`）、
        // そのあと退会しても残る。「誰が何をしたか」を返す一覧6本のうち、
        // **ここだけ `deletedUserIds()` を通していなかった**
        // （comments / notifications / storyReplies / getUserFollowing /
        //  getUserFollowers は全部通している）。
        // ストーリーは24時間で消えるので窓は短いが、その間は出続ける。
        // **ブロックした相手は一覧に出さない（両向き）。**
        //
        // 表示名と同じで、閲覧の記録は `viewStory` の時点で焼き込まれる。
        // `viewStory` はブロック後の閲覧を断るが、**断るのはこれからのぶん**
        // だけ——ブロックする前に見られたぶんは、名前も `userId` も付いたまま
        // 残る（ストーリーの残り寿命＝最大24時間）。通知で直したのと同じ型。
        //
        // ここは `count` を**この一覧から導いている**ので、落としても数と
        // 中身が食い違わない（返信側はバッジが別系統なので、そちらは
        // `storyReplies.ts` にずれ方を書いた）。
        const viewersMap = (item.viewers ?? {}) as Record<string, { displayName?: string; at?: string }>;
        const entries = Object.entries(viewersMap);
        // 引くのは閲覧者が居るときだけ（`getComments` と同じ）
        const [gone, hidden] = entries.length === 0
            ? [new Set<string>(), new Set<string>()]
            : await Promise.all([
                deletedUserIds(),
                // 読めなければ一覧は返す（`getStories` と同じ判断）
                hiddenUserIds(callerId).catch((e) => {
                    console.error("getStoryViewers: ブロック一覧を読めませんでした:", e);
                    return new Set<string>();
                }),
            ]);
        const viewers = entries
            .filter(([userId]) => !hidden.has(userId))
            .map(([userId, v]) => (gone.has(userId)
                ? { userId, displayName: DELETED_USER_NAME, deleted: true, at: v?.at }
                : { userId, displayName: v?.displayName, at: v?.at }))
            .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ viewers, count: viewers.length }) };
    } catch (e) {
        console.error("getStoryViewers error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

// DELETE /stories/{id} — 自分のストーリーを削除（投稿者本人 or 管理者）
// DynamoDB レコードと S3 オブジェクトの両方を消す。
export const deleteStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const callerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!callerId || !storyId) return jsonError(400, "不正なリクエスト");

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) return jsonError(404, "ストーリーが見つかりません");
        // 見出しどおり「本人 or 管理者」。管理者の分岐が抜けていたため、
        // 全員のトレイに出る不適切なストーリーを消す手段が無かった
        // （AWS コンソールを開くか24時間待つしかなかった）。
        if (item.userId !== callerId && !isAdmin(event)) return jsonError(403, "権限がありません");

        // 原本だけでなく派生画像も消す。過去にサムネ生成がストーリーも対象に
        // していた時期があり、その分が max-age=31536000 で残っている。
        //
        // **消せなければ行も消さない。**
        //
        // ここは「S3失敗でもレコードは消す」だった。行は S3 キーの唯一の
        // 手がかりなので、消し残したまま行を消すと**どの削除経路からも
        // 二度と辿れない**孤児になる。しかもストーリーの実体は動画で、
        // 位置情報は**丸めていない**（写真は約1kmに丸めて公開する前提）。
        // 写真の3経路（`photoUpdate.deleteMyPhoto`・`account.deleteAccount`・
        // `api/photosMutate.deletePhoto`）は全部「消せなければ行を残す」に
        // 揃っていて、理由もそこに書いてある。**ストーリーだけ逆だった。**
        //
        // 押し直せば続きから消える（消せたキーは S3 に無いので、再実行の
        // DeleteObject は成功する）。24時間で期限切れになれば掃除が拾う。
        // **管理者が消すときは、残された写真の方から消してもらう。**
        //
        // `storyMediaKeys` は `keptAs` があると実体を残す（本人が残した
        // 1枚を守るため）。管理者は不適切なものを消しに来ているので実体も
        // 消したい——が、**ここで写真の行を消すのは間違いだった**。
        //
        //   - **派生画像はストーリーの行に無い。** `thumbAvif` / `thumbSm` /
        //     `thumbSmAvif` / `srcAvif` / `src256` は `generate-thumbnails.js`
        //     が作って**写真の行**に書き戻す。ここは `storyMediaKeys(item)`
        //     ＝ストーリーの行しか見ないので、行を消したあとは**どの経路
        //     からも辿れない孤児**として S3 に残る（`max-age=31536000`）。
        //     実体を消すつもりの分岐が、いちばん消せない形を作っていた
        //   - `comments#<写真ID>` も残る（`storyFeed` も `story` も `src` も
        //     持たないので一覧にも Scan の絞り込みにも出ない）
        //   - ピン留めの枠を1つ永久に食う（`removePinnedPhoto` を通らない）
        //   - 公開済みなら `/photo/<id>` の静的HTMLが残る（再ビルドを
        //     頼まない。頼むには `stories.ts` に `rebuild.ts` を引き込む
        //     ことになり、**このファイルの6つの handler 全部**に書き込み
        //     トークンが配られる＝IAM-2 で潰したことの作り直し）
        //   - 行の削除が失敗しても印だけ外れて S3 が消え、**割れた写真が
        //     残る**（`storyMediaKeys` のコメントが避けると書いている当のもの）
        //
        // **同じものを二度作らない。** 管理APIの写真削除
        // （`api/src/photosMutate.ts`）は上を全部やったうえで、`keptFrom` の
        // ストーリーと返信の文書まで消す。そちらを1回叩けば済む。
        const keptPhotoId = typeof item.keptAs === "string" ? item.keptAs : "";
        if (keptPhotoId && item.userId !== callerId) {
            // 印が死んだIDを指している場合まで断ると、管理者が**何もできなく
            // なる**。実在を確かめてから断る（この枝は管理者の削除だけ）。
            const kept = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: keptPhotoId } }));
            if (kept.Item) {
                // **どの写真かを言う。** 言わないと管理画面（下書きも並ぶ）から
                // 人手で探すことになり、その間ずっとストーリーは全員のトレイに
                // 残る（最大24時間）
                return jsonError(409, `この投稿はギャラリーに残されています。写真（${keptPhotoId}）の方を削除してください（元のストーリーも一緒に消えます）`);
            }
            // 写真がもう無い＝実体の持ち主が居ない。普通の削除に落とす
            delete item.keptAs;
        }
        const s3Failures = await s3DeleteMany(storyMediaKeys(item), "deleteStory");
        if (s3Failures > 0) {
            return jsonError(500, "画像の削除を完了できませんでした。時間をおいてもう一度お試しください");
        }
        // **返信の文書も消す。ストーリーの行より先に、そして消せなければ
        // 行を残す。**
        //
        // 順序だけでは足りない——**手がかりを残すのは「失敗したら行を
        // 消さない」の方**。`storyreplies#<id>` は `storyFeed` も `story` も
        // `src` も持たないので、行が消えると GSI にも Scan にも一覧にも
        // 出ない＝**どの削除経路からも二度と辿れない**。このテーブルに
        // TTL は無いので、24時間で消えるはずの本文が永久に残る。
        // すぐ上の S3 の削除がまったく同じ理由で止めているのに、
        // ここだけ握って先へ進んでいた。
        try {
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyRepliesId(storyId) } }));
        } catch (e) {
            console.error(`deleteStory: 返信を消せませんでした（${storyId}）:`, e);
            return jsonError(500, "削除を完了できませんでした。時間をおいてもう一度お試しください");
        }
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("deleteStory error:", e);
        return jsonError(500, "削除に失敗しました");
    }
};

// 期限切れストーリーの物理削除（毎日スケジュール実行）
// DynamoDB のレコードと S3 の画像/動画本体の両方を削除する。
export const cleanupExpiredStories = async (): Promise<{ deleted: number }> => {
    const expired = await queryStories("expired");
    let deleted = 0;
    // **エッジの掃除は最後に1回**（退会と同じ理由）。1行ごとに無効化を作ると
    // 期限切れの件数ぶんできて、CloudFront の「同時に進行できる本数」の上限
    // （既定15）に当たる。断られても `invalidateUploads` は警告だけ出すので、
    // **消えたように見えたまま GPS 入りの動画がエッジに残る**（LEFT-4 の再発）。
    // 1時間ごとに走るので、溜まった回ほど本数が増える＝当たりやすい。
    const edgeKeys: string[] = [];

    for (const item of expired) {
        const id = String(item.id ?? "");
        if (!id) continue;

        // **消せなければ行を残す**（上の deleteStory と同じ理由）。
        // 期限切れのストーリーは利用者からは見えないので、行が残っても
        // 害は無い。翌日の実行が同じキーをもう一度消しに行く。
        // 逆に行だけ消すと、GPS 入りの動画が誰にも辿れないまま残る。
        // **1行1リクエストにまとめる。** 1行あたり最大8キーを直列に消して
        // いたので、「消せなければ行を残す」に変えたあと、消せない行が
        // 溜まると実行時間を食い切る——`queryStories` は `expiresAt` の
        // 昇順なので、その行は**毎回先頭に来る**。後ろにいる新しい
        // 期限切れストーリーに永久に到達しなくなる（そちらの GPS 入り
        // 動画が公開URLに残り続ける）。
        const s3Failures = await s3DeleteMany(storyMediaKeys(item), `cleanup(${id})`, edgeKeys);
        if (s3Failures > 0) {
            console.error(`cleanup: keeping ${id} (S3 delete failed; will retry next run)`);
            continue;
        }

        try {
            // 返信の文書も消す（行より先に。`deleteStory` と同じ理由）。
            // **消せなければ行を残して次回に回す**——行が消えると
            // `storyreplies#<id>` はどこからも辿れなくなり、24時間で消える
            // はずの本文が永久に残る（S3 の失敗を `continue` で見送るのと
            // 同じ判断。期限切れの行が残っても利用者には見えない）
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyRepliesId(id) } }));
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
            deleted++;
        } catch (e) {
            console.error(`cleanup: DDB delete failed for ${id}:`, e);
        }
    }

    // 消せたぶんをまとめてエッジからも消す（失敗しても掃除の成否は変えない）
    await invalidateUploads(edgeKeys, "cleanupExpiredStories");

    console.log(`cleanupExpiredStories: deleted ${deleted} of ${expired.length} expired stories`);
    return { deleted };
};
