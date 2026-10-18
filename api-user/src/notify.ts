import { GetCommand, UpdateCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { requireEnv } from "./env";
import { isDeletedProfile } from "./types";
import { isBlocked, hiddenUserIds } from "./blockCheck";
import { apnsConfigured, sendPush } from "./apns";
import { deviceTokens, forgetTokens } from "./devices";

// 通知の共通ヘルパー。
// 通知は "notifs#<uid>" 文書に list_append + ADD unread でアトミックに追記する
// （同時書き込みでも失われない）。件数上限の切り詰めは取得時に行う。

export type Notif = {
    // 作られるのは like / comment / follow / storyreply / badge / inspired の6種類。
    //
    // `inspired` は「あなたの写真を見て撮影しました」（`inspired.ts` の
    // `notifyInspiredOnce`）。`photoId` / `photoSrc` は**付けた側の新しい写真**
    // （押すとその写真へ）、`sourcePhotoId` は元になった**自分の写真**。
    // 1枚の写真につき1回だけ（印の文書 `inspiredNotif#<写真の id>`。写真の行には控え）。
    //
    // **種類を足したら `NotificationsBell` にも足すこと。** あちらは
    // 知らない種類を**何も出さない**（既定の文言に落とさない）ので、
    // 片方だけだと**届いているのに画面には何も出ない**通知になる。
    //
    // `badge` はメダル（`badgeStore.ts`）。誰かが起こしたものではないので `byId` を持たず、
    // `byName` にメダルの名前（「朝の光（銀）」）、`key` / `tier` に鍵と段が入る。
    // 写真も持たない（`photoId` / `photoSrc` は空）。
    type: "like" | "comment" | "follow" | "storyreply" | "badge" | "inspired";
    photoId: string;
    photoSrc: string;
    byName: string;
    // 通知を起こした本人の userId。
    // 名前だけだと、名前未設定の人は既定名で表示され、誰なのか辿れない。
    // これがあれば通知からその人のプロフィールへ飛べる。
    byId?: string;
    atLocation?: string;
    // follow 通知は写真を伴わないため、リンク先のユーザーIDを持つ
    targetUserId?: string;
    /** `badge` だけ: メダルの鍵（`badgeKeys.ts` の BADGE_KEYS） */
    key?: string;
    /** `badge` だけ: 手に入れた段（1 銅・2 銀・3 白金） */
    tier?: number;
    /** `inspired` だけ: 元になった（受け取った人の）写真の ID */
    sourcePhotoId?: string;
    t: string;
};

export const notifsId = (uid: string) => `notifs#${uid}`;

const USERS_TABLE = requireEnv("USERS_TABLE");
// プロフィール未設定の人に使う表示。人名に見える語（以前は「旅人」）だと
// 「そういう名前の人がいる」と誤解され、検索しても見つからず混乱するため、
// 明らかに未設定と分かる表記にする。
const DEFAULT_NAME = "名前未設定さん";

/** 退会した人のコメントに出す表示。誰のものだったかは残さない */
export const DELETED_USER_NAME = "退会したユーザー";

/**
 * 渡した userId のうち、退会した人（墓石が立っている行）の集合。
 *
 * **表示に出てくる ID だけを引く**（2026-10-18）。以前は users テーブルを丸ごと
 * Scan して墓石の集合を作っていたが（`deletedUserIds`）、1ページ 500 件 × 10 ページで
 * 打ち切っていた。`Limit` は絞り込み（`attribute_exists(deletedAt)`）の**前**に数える
 * ので、打ち切りは「墓石 5000 件」ではなく「行 5000 件」で効く——**行が 5000 を
 * 超えると、打ち切った先の退会者が伏せられず、未認証のコメント一覧に実名が出た**。
 * 新しい GSI は作らない（承認制）ので、件数に左右されない形に変えた:
 *
 *   - 呼ぶ側が**一覧に出る ID だけ**を渡す（重複は落とす）。`BatchGetItem` で
 *     100 件ずつ引き、`isDeletedProfile`（`deletedAt` が文字列）で判定する。
 *     行が無い人は退会扱いにしない（PostConfirmation の取りこぼしで行の無い
 *     生きた人がいる。前の Scan も同じ判定）
 *   - 引いた結果はコンテナ内で `DELETED_LOOKUP_CACHE_MS`（60 秒・前と同じ）控える。
 *     退会が伏せに効くまでの遅れは前と同じ最大 60 秒
 *
 * 🔴 **読めなかった ID は「退会した」側に倒す（伏せる）。** 前は空集合を返して
 * 伏せない側に倒していたが、それは「生きている人が一瞬『退会したユーザー』に
 * 見える」と「退会した人の実名が未認証の口に出る」を比べると逆だった——前者は
 * 次の読み込みで戻る見た目の傷、後者は取り消せない漏れ（コメント一覧は
 * `s-maxage=15` で共有キャッシュにも載る）。伏せるのは**読めなかった ID だけ**で、
 * 読めた ID の判定はそのまま使う。読めなかった ID は控えない（次の呼び出しで
 * 引き直す）。見張りとして `console.error` に件数を出す（CloudWatch で
 * `deletedAmong: 読めなかった` を数えれば分かる）。
 *
 * 費用（eventually consistent の読み取り）: `BatchGetItem` は1件ごとに 4KB 単位で
 * 切り上げて 0.5 読み取り単位。1回の呼び出しは**出てくる ID の数**で頭打ち
 * （コメント 200・通知 50・フォロー 50・返信 200・ブロック 500）で、控えに
 * 当たった ID は0。前の Scan は控えが切れるたびに**表の行を最大 5000 件**
 * 読んでいた（`ProjectionExpression` は消費を減らさない）。
 */
const DELETED_LOOKUP_CACHE_MS = 60 * 1000;
/** 控えの上限。超えたら古い順に捨てる（Map は入れた順を保つ） */
const DELETED_LOOKUP_CACHE_MAX = 5000;
/** BatchGetItem の1回の上限 */
const BATCH_GET_MAX = 100;
/** 未処理（UnprocessedKeys）を拾い直す回数。尽きたら読めなかった扱い */
const BATCH_GET_RETRIES = 3;
const deletedLookupCache = new Map<string, { at: number; deleted: boolean }>();

export function resetDeletedUsersCache(): void {
    deletedLookupCache.clear();
}

function remember(uid: string, deleted: boolean, at: number): void {
    deletedLookupCache.delete(uid);
    deletedLookupCache.set(uid, { at, deleted });
    while (deletedLookupCache.size > DELETED_LOOKUP_CACHE_MAX) {
        const oldest = deletedLookupCache.keys().next().value;
        if (oldest === undefined) break;
        deletedLookupCache.delete(oldest);
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function deletedAmong(ids: Iterable<unknown>): Promise<Set<string>> {
    const now = Date.now();
    const gone = new Set<string>();
    const want: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
        // DynamoDB のキーにできない値（空・型違い・長すぎ）は引かない＝誰の ID でもない
        if (typeof id !== "string" || id.length === 0 || id.length > 256 || seen.has(id)) continue;
        seen.add(id);
        const hit = deletedLookupCache.get(id);
        if (hit && now - hit.at < DELETED_LOOKUP_CACHE_MS) {
            if (hit.deleted) gone.add(id);
        } else {
            want.push(id);
        }
    }
    if (want.length === 0) return gone;

    let unread = 0;
    await Promise.all(Array.from({ length: Math.ceil(want.length / BATCH_GET_MAX) }, async (_, i) => {
        const chunk = want.slice(i * BATCH_GET_MAX, (i + 1) * BATCH_GET_MAX);
        const pending = new Set(chunk);
        try {
            let keys = chunk.map((userId) => ({ userId }));
            for (let attempt = 0; keys.length > 0 && attempt <= BATCH_GET_RETRIES; attempt++) {
                if (attempt > 0) await sleep(50 * 2 ** (attempt - 1));
                const res = await ddb.send(new BatchGetCommand({
                    RequestItems: {
                        [USERS_TABLE]: {
                            Keys: keys,
                            // 予約語かどうかに左右されないよう名前は置き換えて書く
                            ProjectionExpression: "#u, #d",
                            ExpressionAttributeNames: { "#u": "userId", "#d": "deletedAt" },
                        },
                    },
                }));
                for (const it of res.Responses?.[USERS_TABLE] ?? []) {
                    const uid = (it as { userId?: unknown }).userId;
                    if (typeof uid !== "string" || !pending.has(uid)) continue;
                    pending.delete(uid);
                    const deleted = isDeletedProfile(it);
                    if (deleted) gone.add(uid);
                    remember(uid, deleted, now);
                }
                const un = (res.UnprocessedKeys?.[USERS_TABLE]?.Keys ?? []) as { userId?: unknown }[];
                const unprocessed = new Set(un.map((k) => k.userId).filter((v): v is string => typeof v === "string"));
                // 返ってこず、未処理にも無い＝行が無い（生きている扱い・控える）
                for (const uid of [...pending]) {
                    if (unprocessed.has(uid)) continue;
                    pending.delete(uid);
                    remember(uid, false, now);
                }
                keys = [...pending].map((userId) => ({ userId }));
            }
        } catch (e) {
            console.error("deletedAmong error:", e);
        }
        // ここまで残った ID は読めなかった——伏せる側に倒す（控えない）
        for (const uid of pending) gone.add(uid);
        unread += pending.size;
    }));
    if (unread > 0) {
        console.error(`deletedAmong: 読めなかった ${unread} 件を退会扱いで伏せました`);
    }
    return gone;
}

/**
 * 設定されている表示名だけを引く（未設定・読めない場合は undefined）。
 *
 * 写真の `displayName` はこちらを使う。既定名を入れてしまうと、
 * 名前を設定していない人の写真ページに
 * 「名前未設定さんの他の写真」という導線が新しく出てしまう
 * （今は displayName が無ければ出ない）。表示を勝手に変えない。
 */
export async function lookupDisplayNameIfSet(uid: string): Promise<string | undefined> {
    try {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: uid },
            ProjectionExpression: "displayName",
        }));
        const name = typeof res.Item?.displayName === "string" ? res.Item.displayName.trim() : "";
        return name || undefined;
    } catch {
        return undefined;
    }
}

/**
 * 一覧の1行に出す「表示名と @ユーザー名」を1回の読みで引く。
 *
 * ブロックした人・フォロー／フォロワーの一覧（アプリの板 45・34）は
 * 名前の下に `@username` を出す。名前だけ引く `lookupDisplayNameIfSet` を
 * 呼んだあとにもう1回引くと、人数ぶんの往復が倍になる。
 *
 * **どちらも「設定されているときだけ」返す**（空文字・型違いは入れない）。
 * 読めなければ空のオブジェクト——`lookupDisplayNameIfSet` と同じく投げない。
 *
 * 🔴 **墓石（退会した人の行）からは何も返さない。** 墓石には予約をやり直せる
 * ように旧ハンドルが残る（`account.ts`）。一覧は `deletedAmong()` で先に伏せるが、
 * 60秒の控えのあいだに退会した人は**漏れることがある**。
 * 漏れた退会者に解放済みのハンドル（別人が取り直せる）を付けて出さない。
 * 公開プロフィール（`userProfile.ts`）と検索（`userSearch.ts`）と同じ防御
 */
export async function lookupListIdentity(uid: string): Promise<{ name?: string; username?: string }> {
    try {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: uid },
            // 予約語かどうかに左右されないよう名前は置き換えて書く
            ProjectionExpression: "#n, #u, #d",
            ExpressionAttributeNames: { "#n": "displayName", "#u": "username", "#d": "deletedAt" },
        }));
        if (isDeletedProfile(res.Item)) return {};
        const name = typeof res.Item?.displayName === "string" ? res.Item.displayName.trim() : "";
        const username = typeof res.Item?.username === "string" ? res.Item.username.trim() : "";
        return { ...(name ? { name } : {}), ...(username ? { username } : {}) };
    } catch {
        return {};
    }
}

/** 表示名を Users テーブルから引く（クライアント申告を信用しない）。無ければ既定名 */
export async function lookupDisplayName(uid: string): Promise<string> {
    return (await lookupDisplayNameIfSet(uid)) ?? DEFAULT_NAME;
}

// 保持する通知の件数。DynamoDB の1アイテム上限（400KB）に達すると
// 以後の書き込みが全部失敗し、しかもこの関数はエラーを握りつぶすため、
// その人には二度と通知が届かなくなる。追記時に必ず切り詰める。
export const NOTIFS_MAX = 50;

/**
 * 通知を積む。通知は本流の操作（いいね等）を失敗させないよう、
 * エラーはログに残して握りつぶす。
 *
 * 追記は list_append の1回で済ませたいが、それだと際限なく伸びる。
 * 溢れそうなときだけ読み直して切り詰める（通常は追記1回のまま）。
 */
export async function pushNotification(ownerId: string, notif: Notif): Promise<void> {
    try {
        // **ブロックした相手からの通知は積まない。**
        //
        // 塞ぐのは**ここ1か所**。通知を作るのは like / comment / follow /
        // storyreply の4経路で、どれも `byId`（起こした本人）を入れている。
        // 口ごとに配線すると、次に経路が増えたときに必ず1つ漏れる
        // ——実際、ブロックを入れた回はストーリーの返信しか塞いでおらず、
        // **より強い口（公開・500字のコメント）が開いたままだった**。
        // 表示名は本人が自由に変えられるので、通知の輪（50件）を自分の名前で
        // 押し流すこともできた。GetItem 1回で4経路とも閉じる。
        //
        // **落ちたら通知は積まない**（下の catch へ落ちる）。ブロックを
        // 確かめられないまま届けるより、届かない方に倒す
        // ——`pushNotification` は元から「失敗しても本体は成功」の作りで、
        // 呼び出し側はどこも戻り値を見ていない。
        if (notif.byId && await isBlocked(ownerId, notif.byId)) return;

        const res = await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: notifsId(ownerId) },
            UpdateExpression:
                "SET #items = list_append(:new, if_not_exists(#items, :empty)), " +
                "unread = if_not_exists(unread, :z) + :one, uid = :owner, updatedAt = :now",
            ExpressionAttributeNames: { "#items": "items" },
            ExpressionAttributeValues: {
                ":new": [notif],
                ":empty": [],
                ":z": 0,
                ":one": 1,
                ":owner": ownerId,
                ":now": notif.t,
            },
            ReturnValues: "UPDATED_NEW",
        }));

        // 上限を超えたら新しい方から NOTIFS_MAX 件だけ残す。
        //
        // 「読んだときと同じ長さのままなら書く」条件を必ず付ける。
        // 無条件に書いていた頃は、ほぼ同時に2件届くと**片方が消えていた**——
        // 表示されないのではなく DynamoDB から無くなる。
        //   50件のオーナーに A のいいねと B のコメントが同時に届く
        //   → A が51件のスナップショットを持つ
        //   → B が52件を正しく書く
        //   → A の切り詰めが「B を含まない50件」で上書きする
        // comments.ts の切り詰めが同じ理由で `size(#items) = :len` を
        // 付けている（対の実装。片方を直したらもう片方も見ること）。
        // **ただし配列の向きは逆**——こちらは list_append(:new, existing) で
        // 先頭が新しい（切り詰めは slice(0, N)）、comments.ts は
        // list_append(existing, :new) で末尾が新しい（slice(-N)）。
        // 切り詰め処理をそのまま横に移すと**新しい方を捨てる**。
        // 外れたら諦めてよい——次の通知がまた切り詰める。
        // **切り詰めが触るのは `items` だけ。`unread` には手を出さない。**
        //
        // ⚠️ **「生の値を読むのは getNotifications だけ」ではなくなった**
        // ——プッシュのバッジ（`deliverPush`）が2人目の読み手。だから丸めは
        // `visibleUnread` に切り出して**両方が同じ数を出す**ようにしてある。
        // 一度ここで `unread` も NOTIFS_MAX に丸めていたが、それが
        // 「消したはずのバッジが復活する」の原因だった。この書き込みは
        // 「読む → 書き戻す」なので、その隙に通知欄を開かれると
        // （notifications.ts の `SET unread = :z`）既読化を追い越して
        // `unread = 50` を書き戻す。
        //
        // 条件を足して守るのではなく、書き込みごと消した。`unread` の生の値を
        // 読むのは getNotifications だけで、そこが保存件数で丸めるため、
        // ここで丸めても**利用者に見える結果は変わらない**。競合する書き込みは
        // 守るより無くす方が確実で、しかも安い——通知が上限に達した人は
        // 毎回ここを通るので、丸めを残すと書き込みが常時3本になっていた。
        // **端末にも届ける。** ここが通知を作る唯一の場所なので、
        // 送信もここ1か所に置く（口ごとに配線すると、次に経路が増えたときに
        // 必ず1つ漏れる——ブロックの判定が同じ理由でここに在る）。
        // **落ちても通知は積まれたまま**（アプリを開けば読める）
        await deliverPush(ownerId, notif, res.Attributes?.unread, res.Attributes?.items);

        const items = res.Attributes?.items;
        if (Array.isArray(items) && items.length > NOTIFS_MAX) {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: notifsId(ownerId) },
                UpdateExpression: "SET #items = :trimmed",
                ConditionExpression: "size(#items) = :len",
                ExpressionAttributeNames: { "#items": "items" },
                ExpressionAttributeValues: { ":trimmed": items.slice(0, NOTIFS_MAX), ":len": items.length },
            })).catch((e: { name?: string }) => {
                if (e?.name !== "ConditionalCheckFailedException") throw e;
                // 競合。次の通知が切り詰める
            });
        }
    } catch (e) {
        console.error("pushNotification error:", e);
    }
}

/**
 * 端末の `Localizable.strings` の鍵。**文面はサーバーで作らない**
 * ——相手の言語を知らないので、作ると英語の端末にも日本語が届く。
 *
 * **種類を足したら、アプリの `Localizable.strings` にも足すこと。**
 * 足さないと iOS は鍵の文字列（`NOTIF_LIKE`）をそのまま通知に出す。
 */
const LOC_KEYS: Record<Notif["type"], string> = {
    like: "NOTIF_LIKE",
    comment: "NOTIF_COMMENT",
    follow: "NOTIF_FOLLOW",
    storyreply: "NOTIF_STORY_REPLY",
    // 引数はメダルの名前（`byName`）。アプリの文面は「%@のメダルを手に入れました」
    badge: "NOTIF_BADGE",
    // 引数は付けた人の名前。アプリの文面は「%@ があなたの写真を見て撮影しました」
    inspired: "NOTIF_INSPIRED",
};

/**
 * 通知を端末へ送る。**best-effort**（落ちても本体は成功）。
 *
 * ブロックの判定は呼び出し元（`pushNotification`）で済んでいる
 * ——積まない相手には、ここまで来ない。
 */
/**
 * 画面に出る未読数。**`getNotifications` とプッシュのバッジで同じ数を出す**
 * ための1か所。
 *
 * 素のカウンタ（DynamoDB の `unread`）はそのままでは使えない:
 *
 *   - **保存件数を超えて伸びる**（開かずに溜めると 53 になるが中身は50件）
 *   - **ブロックした相手のぶんを含む**。人がブロックを押すのは「その人から
 *     立て続けに通知が来た直後」なので、**未読がまるごとブロック相手のもの**が
 *     いちばん起きる形
 *
 * 未読は「先頭 `stored` 件」＝**位置の意味を持つ数**なので、全体の長さで
 * 丸めるだけでは足りない（落ちたのが先頭側だったことを見ていない）。
 * `min(stored, items.length)` だと `[B,B,B,X,Y] / unread=3` で**2**が残り、
 * 「バッジ2 → 開くと『まだ届いていません』」に戻る。
 */
export function visibleUnread(storedUnread: unknown, items: unknown, hidden: ReadonlySet<string>): number {
    const all = Array.isArray(items) ? items : [];
    const stored = typeof storedUnread === "number" ? storedUnread : 0;
    const headCount = Math.max(0, Math.min(stored, all.length));
    if (hidden.size === 0) return headCount;
    return all.slice(0, headCount).filter((n) => {
        const by = (n as { byId?: unknown })?.byId;
        return !(typeof by === "string" && hidden.has(by));
    }).length;
}

async function deliverPush(ownerId: string, notif: Notif, storedUnread?: unknown, items?: unknown): Promise<void> {
    if (!apnsConfigured()) return;
    try {
        const tokens = await deviceTokens(ownerId);
        if (tokens.length === 0) return;
        // **ブロック一覧を引くのはここまで来たときだけ。** 上の2つの門
        // （設定が無い／端末が1つも無い）で落ちる人には1回も払わせない
        // ——`visibleReplyCount` が「ブロックしていなければ読まない」で
        // 往復を抑えているのと同じ形。
        // **読めなければ空集合**＝丸めだけ効く（`getNotifications` と同じ判断。
        // 倒しすぎると通知が誰にも出なくなる側なので、ここは出す側に倒す）
        const hidden = await hiddenUserIds(ownerId).catch((e) => {
            console.error(`deliverPush: ブロック一覧を読めませんでした（${ownerId}）:`, e);
            return new Set<string>();
        });
        const badge = visibleUnread(storedUnread, items, hidden);
        const result = await sendPush(tokens, {
            locKey: LOC_KEYS[notif.type],
            locArgs: [notif.byName],
            badge,
            // 押したときの行き先。**写真が無い通知（follow）もある**
            data: {
                type: notif.type,
                ...(notif.photoId ? { photoId: notif.photoId } : {}),
                ...(notif.byId ? { byId: notif.byId } : {}),
                ...(notif.targetUserId ? { targetUserId: notif.targetUserId } : {}),
                // メダル: 押したら棚のそのメダルへ。APNs の data は文字列だけ
                ...(notif.key ? { key: notif.key } : {}),
                ...(typeof notif.tier === "number" ? { tier: String(notif.tier) } : {}),
                // 「この写真を見て撮影」: 押した先は新しい写真（`photoId`）。元の写真も添える
                ...(notif.sourcePhotoId ? { sourcePhotoId: notif.sourcePhotoId } : {}),
            },
        });
        // **無効だった宛先だけ外す**（送信の失敗では外さない）
        if (result.invalid.length > 0) await forgetTokens(ownerId, result.invalid);
    } catch (e) {
        console.error(`deliverPush: 送れませんでした（${ownerId}）:`, e);
    }
}
