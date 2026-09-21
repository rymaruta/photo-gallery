import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { ScanCommand, QueryCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
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
import { isFollowing } from "./followCheck";
import { sanitizeStoryTexts, storyTextsCaption } from "./storyText";
import { STORY_PUBLIC, STORY_FOLLOWERS_ONLY, storyVisibility, storyAllowsReplies } from "./storyVisibility";
import { isStoryExpired } from "./storyExpiry";

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
            // 期限切れから**棚へ移した行（`storyFeed` を外し `archivedAt` を刻んだ）
            // だけを除く**。GSI の経路は `storyFeed` がキーなので自然にそうなるが、
            // Scan はテーブル全体を見るので、ここで落とさないと**毎時アーカイブを
            // 撫で直す**。
            //   - `storyFeed` が在る → 拾う（刻まれたのに残る半端な行も、
            //     棚へ移す条件式と同じ物差しで拾って直せる）
            //   - `storyFeed` が無くても `archivedAt` が無い → 拾う。**索引が生える
            //     前の古い行**がここ——外すと、GSI の無い環境でその行と S3 の
            //     実体が永久に消えない（一度そう書いて狭めすぎた）
            FilterExpression: filter === "active"
                ? "story = :t AND expiresAt > :now"
                : "story = :t AND expiresAt <= :now AND (attribute_exists(storyFeed) OR attribute_not_exists(archivedAt))",
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
                // 「アーカイブに自動保存」の印も同じ——見る人に「この投稿は
                // 24時間後も本人の手元に残る」と知らせる理由が無い
                delete item.archive;
            }
        }
        const shown = items.filter((i) => !hidden.has(String(i.userId ?? "")));

        // **「フォロワーのみ」は、フォローしている人と本人にだけ出す。**
        //
        // **判定は `following#<自分>` の一覧ではなくマーカー**
        // （`follow#<相手>#<自分>`）。一覧は2つの理由で信用できない:
        //
        //   - `unfollowQuietly` は、マーカーを消したあとの `updateFollowing`
        //     の失敗を**握り潰す**（`follow.ts:536`。あちらのコメントが
        //     「ブロックを解除した瞬間に古い関係が生き返って見える」と
        //     名指ししている残骸そのもの）。一覧で見ると、**解除した相手の
        //     フォロワー限定ストーリーが中身ごと返る**——`viewStory` と
        //     `postStoryReply` は同じ行に 404 を返すので、**中身だけ先に出る**
        //   - `updateUserList` は上限2000で**古い方から**落とす。2000人超を
        //     フォローしている人は、実際に追っている相手のストーリーが
        //     静かに消える
        //
        // `followCheck.ts` の `isFollowing` が「一覧が切り捨てられても
        // 判定が狂わないように」と書いている当の理由を、ここだけ破っていた。
        //
        // **払うのは「フォロワー限定を出した人の数」だけ。** 行ごとではなく
        // 投稿者ごとにまとめ、誰も使っていなければ1回も読まない
        // （`visibleReplyCount` が「ブロックしていなければ読まない」で
        // 往復を抑えているのと同じ形）。
        //
        // **読めなければ出さない。** ブロック一覧（すぐ上）が逆向きなのは
        // 意図的な差で、あちらは**倒しすぎると誰のストーリーも出なくなる**
        // のに対し、こちらは倒し方を間違えると**本人が見せないと決めた相手に
        // 中身が出る**。取り返せない側を選ばない。
        //
        // **本人を外すのは `gatedOwners` の1か所だけ。** `isFollowing` は
        // 自分自身に false を返すので、ここで外さないと**自分の
        // フォロワー限定ストーリーが自分に見えない**（投稿した直後に
        // バーから消える）。下の `filter` にも `owner === userId` を
        // 書いていたが、**二重になっていて片方を壊してもテストが緑**だった
        // （変異で実測）。見張りは1本ずつ——`getStories` の `replyCount` の
        // ところに同じ戒めが書いてある。
        //
        // 門はここだけではない。開きっぱなしのタブや直接叩く経路のために
        // `viewStory` と `postStoryReply` にも同じ判定が要る。
        // **画面側だけ・一覧側だけの防御を作らない。**
        const gatedOwners = [...new Set(shown
            .filter((i) => String(i.userId ?? "") !== userId
                && storyVisibility(i.visibility) === STORY_FOLLOWERS_ONLY)
            .map((i) => String(i.userId ?? "")))];
        const notFollowed = new Set<string>();
        await Promise.all(gatedOwners.map(async (owner) => {
            const ok = await isFollowing(owner, userId).catch((e) => {
                console.error(`getStories: フォローを確かめられませんでした（${owner}）:`, e);
                return false;
            });
            if (!ok) notFollowed.add(owner);
        }));
        // **落とすのは行ごと**（投稿者ごとではない）。`notFollowed` は
        // 「フォロワー限定を出した、追っていない人」なので、投稿者だけで
        // 切ると**同じ人が同じ日に出した「全員に公開」のぶんまで消える**
        // （実際にそう書いて、`FEED` の `pub` が落ちた）
        const visible = shown.filter((i) =>
            storyVisibility(i.visibility) === STORY_PUBLIC || !notFollowed.has(String(i.userId ?? "")));

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
export const createStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    // displayName は受け取らない（なりすまし防止のためサーバーで引く）。
    // key も受け取らない（publicUrl から導く。下のコメント参照）。
    let body: {
        publicUrl?: string; caption?: string; mediaType?: string; song?: unknown; durationSec?: unknown;
        location?: unknown; coords?: unknown; texts?: unknown;
        visibility?: unknown; allowReplies?: unknown; archive?: unknown;
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
    // 写真の上に置いた文字（何枚でも・それぞれ位置と見せ方を持つ）。
    //
    // 受けるのは**一覧に在る鍵だけ**（`storyText.ts`）。任意の CSS を通さない
    // ので、読めない組み合わせも他人の画面で動く値も作れない。位置は必ず挟み、
    // 文言の空のものと上限を超えたぶんは落とす。
    const texts = sanitizeStoryTexts(body.texts);

    // **`caption` は文字たちから作る。** 文言を2か所で持つと静かにずれる
    // ——残したときの題（`storyKeep.ts`）も、検索に出る文章も、この1本を読む。
    // 文字を置いていない投稿は、これまでどおり `caption` をそのまま受ける。
    const caption = texts
        ? truncate(storyTextsCaption(texts), 200) || undefined
        : truncate((body.caption ?? "").trim(), 200) || undefined;

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

    // **公開範囲と、返信を受けるか。** どちらも既定は保存しない
    //   - 既定（全員に公開・返信を受ける）＝この機能が生まれたときからの姿。
    //     読む側は `storyVisibility` / `storyAllowsReplies` が「無い＝既定」に
    //     均すので、**既に在る行は移行なしでそのまま**動く
    //   - `durationSec` が既定値を保存しないのと同じ作法
    //
    // **値の解釈は `storyVisibility.ts` の1本を通す。** 書く側と読む側で
    // 別々に書くと静かにずれ、ずれる向きが「狭いつもりが全員に出る」になる。
    const visibility = storyVisibility(body.visibility) === STORY_FOLLOWERS_ONLY
        ? STORY_FOLLOWERS_ONLY
        : undefined;
    const allowReplies = storyAllowsReplies(body.allowReplies) ? undefined : false;

    // **アーカイブに自動保存。** 立っていると、期限切れの掃除が行と実体を
    // 消さずに**本人だけが後から見られる形**に変える（`cleanupExpiredStories`）。
    // 既定は保存しない＝これまでどおり24時間で消える。**`true` を明示した
    // ときだけ**立てる（`allowReplies` と同じで、値の形で黙って立てない）。
    //
    // 仕組みは `keptAs` と同じ1本——「行に印があれば掃除が消さない」。
    // 2つ目の置き場（別の行・別のテーブル）は作らない。
    const archive = body.archive === true ? true : undefined;

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
        ...(texts ? { texts } : {}),
        ...(location ? { location } : {}),
        // **座標は地名とセットのときだけ持つ。** 地名の無い座標は画面に
        // 出しようがなく（ピンだけ置く画面がストーリーには無い）、
        // 残したときも「名前の無い点」が地図に増えるだけになる
        ...(location && coords ? { coords } : {}),
        ...(song ? { song } : {}),
        ...(durationSec ? { durationSec } : {}),
        // 既定は書かない（すぐ上の但し書き）。**`allowReplies` は `false` を
        // 書く**ので、`...(allowReplies ? ...)` では消える——値で分岐しない
        ...(visibility ? { visibility } : {}),
        ...(allowReplies === false ? { allowReplies } : {}),
        ...(archive ? { archive } : {}),
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
        // **「フォロワーのみ」を、フォローしていない人には記録しない。**
        //
        // 一覧（`getStories`）では既に落としているが、ここに来る経路は
        // すぐ下のコメントが書いているとおり別にある（期限をまたいで
        // 開きっぱなしのタブ・直接叩く）。記録すると、所有者の閲覧者一覧に
        // **見せないと決めた相手が並ぶ**——見せていないつもりの投稿に
        // 知らない名前が出るので、ブロックした相手を弾くのと同じ話。
        //
        // 一覧ではなくマーカー1件で確かめる（`isBlocked` と同じ形）。
        // 相手は1人なので、2000件の切り捨ての影響を受けない方を選ぶ。
        // **読めなければ例外が下の catch に落ちて 500**＝記録しない側に倒れる。
        if (storyVisibility(item.visibility) === STORY_FOLLOWERS_ONLY
            && !await isFollowing(String(item.userId ?? ""), viewerId)) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        // **期限切れは「もう無い」。**
        //
        // 行が残っているのは掃除が毎時だからで、一覧（`getStories`）は
        // とっくに返していない。ここに来るのは**期限をまたいで開きっぱなしの
        // タブ**か、直接叩いた場合。記録すると、消えたはずのストーリーに
        // 閲覧者が増え続ける——本人には「24時間で消えた」ものの閲覧者が
        // あとから増えて見え、掃除が来るまで（最長およそ1時間）続く。
        // 判定は `queryStories` と同じ ISO 文字列の比較。`expiresAt` を
        // 持たない古い行は有効扱い（無い理由で締め出さない）。
        if (isStoryExpired(item)) {
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
                // **棚へ移った行には書かない。** 上で期限を見てからここまでの間
                // （表示名の往復）に掃除が棚へ移すと、`viewers` を外した行に
                // 閲覧者が書き戻る——行はもう GSI に無いので掃除は二度と来ず、
                // 「他人の名前は消す」が本人が消すまで破れたまま。CCF は下で
                // 「消えた」と同じ 404 に落ちる（見えないものは記録しない）
                ConditionExpression: "attribute_exists(id) AND attribute_not_exists(archivedAt)",
                ExpressionAttributeValues: { ":empty": {} },
            }));
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: storyId },
                UpdateExpression: "SET viewers.#uid = if_not_exists(viewers.#uid, :v)",
                ConditionExpression: "attribute_exists(id) AND attribute_not_exists(archivedAt)",
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
        // **期限が切れたら、誰が見たかも消える。** 行の `viewers` を掃除が
        // 外すのは最長およそ1時間後（アーカイブへ移すとき）なので、その間も
        // ここで出さない。閲覧者の名前は本人のものではなく、期限とともに
        // 消える側（返信と同じ）。アーカイブの画面から開いても 0 人
        if (isStoryExpired(item)) {
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ viewers: [], count: 0 }) };
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
        // DeleteObject は成功する）。24時間で期限切れになれば掃除が拾う
        // ——**ただし棚へ移った行（アーカイブ）は掃除が来ない**（GSI に無い）
        // ので、そこで行の削除が転ぶと**押し直しだけが道**。画面は
        // サーバーの理由をそのまま出して押し直しを促す（`StoriesBar` の
        // `handleDeleteStory` と同じ形）。
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

/**
 * 期限切れの行を「アーカイブの棚」へ移す（`archive: true` の行だけ）。
 *
 * **消さずに残す**が、残すのは**本人のもの**（実体・文字・場所・曲）だけ。
 * **他人の言葉と名前は、今までどおり消す**:
 *   - 返信の文書（`storyreplies#<id>`）を消す。返信は相手が「24時間で
 *     消える」つもりで送った文章で、`photoUpdate.ts` が「24時間で消える
 *     はずの他人の文章とその人の uid が無期限に残っていた」を不具合として
 *     塞いだ当のもの
 *   - `viewers`（誰が見たか）と `replyCount` も外す（同じ理由）
 * そのうえで `archivedAt` を刻み、`storyFeed` を外す（ストーリー一覧の GSI
 * から落ちる＝`getStories` に二度と出ず、掃除も二度と拾わない）。
 *
 * **行の更新と返信の文書の削除は1つのトランザクション。** 2回に分けると
 * （文書を消す → 行を更新）、その間に届いた返信が文書を作り直し、件数の
 * 更新は `archivedAt` がまだ無いので通り、そのあと行だけ棚へ移る＝
 * **他人の返信の文書が棚の行の隣に残る**（行は GSI に無いので掃除は二度と
 * 来ない）。`viewers` は行の中の属性なので行の更新が拾うが、返信は別の行。
 * 1回で書けば、追記は必ず棚入れの前か後——後なら `postStoryReply` の
 * 件数更新が `attribute_not_exists(archivedAt)` で外れ、その CCF の枝が
 * 文書を片付ける。
 *
 * **S3 の実体はそのまま**——これが「後から見られる」の中身。公開URLは鍵が
 * UUID なので当てられないが、**見た人が URL を控えていれば取れ続ける**
 * （`keptAs` で残した写真と同じ性質）。本人が投稿のときに「アーカイブに
 * 自動保存」を入にしたぶんだけなので、既定は今までどおり消える＝
 * **24時間で消える約束は壊さない**。仕組みは `keptAs`（印があれば掃除が
 * 実体を消さない）と同じ1本で、2つ目の置き場は作らない。
 *
 * 返り値: `"archived"`＝移した／`"skipped"`＝条件が外れた（もう棚に在る・
 * 消えた・印が外れた。やることは無い）／`"failed"`＝書けなかった（行は
 * GSI に残るので次回また来る）
 */
async function shelveExpiredStory(id: string, item: Record<string, unknown>): Promise<"archived" | "skipped" | "failed"> {
    // **最後の砦。** `archivedAt` に `expiresAt` を写すので、無いと更新が
    // ValidationException になる。ここに来る行は GSI のソートキー／Scan の
    // 絞り込みで必ず持つ（今の経路では来ない）。直す手が無い行なので
    // error では鳴らさない
    if (typeof item.expiresAt !== "string" || !item.expiresAt) {
        console.warn(`cleanup: archive skipped for ${id}: no expiresAt`);
        return "skipped";
    }
    try {
        await ddb.send(new TransactWriteCommand({
            TransactItems: [
                { Update: {
                    TableName: PHOTOS_TABLE,
                    Key: { id },
                    // **`archivedAt` は期限の時刻。** 掃除が来た時刻ではない——
                    // 一覧（`getStoryArchive`）は掃除が来る前の行にも期限の時刻を
                    // 埋めて返すので、掃除の時刻を刻むと**同じ行の日付が掃除の
                    // 前後で変わる**（日をまたぐと「昨日のアーカイブ」が今日へ
                    // 跳ぶ）。行の `expiresAt` をそのまま写す（手元の値を渡さない）。
                    // `if_not_exists` は半端に直された行（刻まれているのに
                    // `storyFeed` が残る）を撫でるときに上書きしないため
                    UpdateExpression: "SET archivedAt = if_not_exists(archivedAt, expiresAt) REMOVE storyFeed, viewers, replyCount",
                    // **条件は Scan の絞り込みと同じ物差し**: 印が立っていて、まだ
                    // 棚へ移していない（`storyFeed` が在る、または `archivedAt` が
                    // 無い）。絞り込みと条件がずれると、絞り込みだけが拾う行が
                    // **毎時ここで条件不成立になり永久に収束しない**（一度そう書いた）。
                    // 鍵だけの行を作らない見張り（`attribute_exists(id)`）は要らない
                    // ——行が無ければ `archive` も無く `#a = :t` が必ず外れる。
                    // 書き足すと見張りが二重になり、片方を壊してもテストが緑になる。
                    // **`archive` は DynamoDB の予約語。** 素で書くと式ごと
                    // ValidationException になり、**1行も棚へ移らない**（モックの
                    // テストでは捕まらない。`comments.ts` の `#items` と同じ罠）
                    ConditionExpression: "#a = :t AND (attribute_exists(storyFeed) OR attribute_not_exists(archivedAt))",
                    ExpressionAttributeNames: { "#a": "archive" },
                    ExpressionAttributeValues: { ":t": true },
                } },
                { Delete: { TableName: PHOTOS_TABLE, Key: { id: storyRepliesId(id) } } },
            ],
        }));
        return "archived";
    } catch (e) {
        if ((e as { name?: string }).name !== "TransactionCanceledException") {
            // 書けなければ次回に回す（行は GSI に残っているので、また来る）
            console.error(`cleanup: archive failed for ${id}:`, e);
            return "failed";
        }
        // 取り消された。**どれかを言う**——条件が外れた（読んだあとに消された
        // ＝`deleteStory` との普通の競合／もう棚に在る／印が外れた）のか、
        // 混み合って通らなかっただけなのかで、追う必要があるかが変わる。
        // 稀な経路なので1回読み直す。**読み直せなかった回を「消された」と
        // 言わない**——それでは見分けるために読み直した意味が無い
        let fresh: Record<string, unknown> | undefined;
        try {
            fresh = (await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }))).Item as Record<string, unknown> | undefined;
        } catch (e2) {
            console.warn(`cleanup: archive skipped for ${id}: re-read failed: ${(e2 as { name?: string }).name ?? "unknown"}`);
            return "skipped";
        }
        // 条件はまだ通る形で残っている＝取り消しの理由は条件ではない
        // （混み合っていた）。次回また来るので、失敗として数える
        if (fresh && fresh.archive === true && ("storyFeed" in fresh || typeof fresh.archivedAt !== "string")) {
            console.error(`cleanup: archive transaction canceled for ${id} (row still in feed; will retry next run)`);
            return "failed";
        }
        console.warn(`cleanup: archive skipped for ${id}: ${fresh
            ? `archive=${String(fresh.archive)} storyFeed=${"storyFeed" in fresh} archivedAt=${String(fresh.archivedAt ?? "")}`
            : "row gone (deleted meanwhile)"}`);
        return "skipped";
    }
}

// 期限切れストーリーの物理削除（毎時スケジュール実行・`serverless.yml` の cron）。
// DynamoDB のレコードと S3 の画像/動画本体の両方を削除する。
// 「アーカイブに自動保存」の印がある行だけは消さずに棚へ移す（`shelveExpiredStory`）。
export const cleanupExpiredStories = async (): Promise<{ deleted: number; archived: number }> => {
    const expired = await queryStories("expired");
    let deleted = 0;
    let archived = 0;
    // **エッジの掃除は最後に1回**（退会と同じ理由）。1行ごとに無効化を作ると
    // 期限切れの件数ぶんできて、CloudFront の「同時に進行できる本数」の上限
    // （既定15）に当たる。断られても `invalidateUploads` は警告だけ出すので、
    // **消えたように見えたまま GPS 入りの動画がエッジに残る**（LEFT-4 の再発）。
    // 1時間ごとに走るので、溜まった回ほど本数が増える＝当たりやすい。
    const edgeKeys: string[] = [];

    for (const item of expired) {
        const id = String(item.id ?? "");
        if (!id) continue;

        // **アーカイブに自動保存の印がある行は、消さずに「期限切れの棚」へ移す**
        // （中身は `shelveExpiredStory`）。移せなかった行は GSI に残るので次回また来る
        if (item.archive === true) {
            if (await shelveExpiredStory(id, item) === "archived") archived++;
            continue;
        }

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

    // `archived` は「索引から外した数」（半端に直された行を撫でた回も含む）
    console.log(`cleanupExpiredStories: deleted ${deleted}, archived ${archived} of ${expired.length} expired stories`);
    return { deleted, archived };
};
