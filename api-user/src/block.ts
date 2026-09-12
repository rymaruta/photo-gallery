import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { isUserId } from "./userId";
import { unfollowQuietly } from "./follow";
import { blockMarkerId } from "./blockCheck";
import { lookupDisplayNameIfSet, deletedUserIds, DELETED_USER_NAME } from "./notify";

// 判定（印の綴りと GetItem 1回）は `blockCheck.ts` にある。
// **輪を作らないため**の切り出し——このファイルは `follow.ts` の
// `unfollowQuietly` と `notify.ts` の表示名引きを呼ぶので、
// **あちら（`follow` / `notify`）からここを import すると輪になる**。
// その2つは `blockCheck.ts` を直接見ること。
//
// 一覧をまとめて落とす側（`stories` / `storyReplies` / `notifications`）は
// 印1つでは足りない（相手が何人いるか分からない）ので、ここの
// `hiddenUserIds` を import している。**輪にはならない**——`block.ts` から
// `stories` / `storyReplies` / `notifications` へ戻る辺が無いため。
// `comments` は未認証の口なので誰が見ているか分からず、どちらも使わない。

/**
 * ブロック。**「この人からの反応を受け取らない」**。
 *
 * **なぜ要るか。** ストーリーへの返信を足した時点で、ログインしていれば
 * 誰でも誰の通知にも文字を送れるようになった（1ストーリー10件 ×
 * 1日20本＝200件）。止める手段は**リポジトリ全体にひとつも無かった**
 * （`block` / `mute` / `report` は grep で0件）。
 * これは CLAUDE.md が避ける「SNS的な競争要素」ではなく、
 * **やり取りの口を持つ以上の最低限**。
 *
 * **形は `follow.ts` に揃える。** 単一PKのテーブルなので、
 *   - `block#<blocker>#<blocked>` … 1回の GetItem で判定できる印
 *   - `blocks#<blocker>`          … 自分がブロックした一覧（画面用）
 *   - `blockedby#<blocked>`       … **自分をブロックした人の一覧**
 *
 * 3つ目が要るのは、**隠すのが両向き**だから。A が B をブロックしたとき、
 * A が B のストーリーを見ないのは `blocks#A` で足りるが、**B が A の
 * ストーリーを見ない**ようにするには B 側から引ける一覧が要る
 * （B は `blocks#B` に何も持っていない）。書くのはブロックした瞬間の
 * 1回だけで、読む側は自分の2行を引くだけで済む。
 *
 * **やらないこと**（意図的。写経しないように）:
 *   - 通報（誰かが読んで裁く仕組みが要る。利用者1人の今は空回りする）
 *   - ミュート（「見ない」だけの弱い版。ブロックがあれば足りる）
 *   - 過去の返信・コメントの遡及削除（消すのは本人の操作でできる）
 */

/** 1人がブロックできる人数。`following` の2000より小さくてよい */
export const BLOCKS_MAX = 500;

export const blocksId = (uid: string) => `blocks#${uid}`;
export const blockedById = (uid: string) => `blockedby#${uid}`;

/** 文字列だけの配列にして返す（壊れた行で落ちない） */
function ids(item: Record<string, unknown> | undefined, field: string): string[] {
    const v = item?.[field];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 見せない相手の集合（自分がブロックした人 ∪ 自分をブロックした人）。
 * 一覧を引く画面（ストーリーなど）が1回だけ呼ぶ。
 */
export async function hiddenUserIds(uid: string): Promise<Set<string>> {
    if (!uid) return new Set();
    const [mine, theirs] = await Promise.all([
        ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(uid) } })),
        ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blockedById(uid) } })),
    ]);
    return new Set([
        ...ids(mine.Item as Record<string, unknown> | undefined, "blockedIds"),
        ...ids(theirs.Item as Record<string, unknown> | undefined, "blockerIds"),
    ]);
}

/** 一覧に足す／外す（`follow.ts` と同じ「読んだ長さを条件にする」形） */
const LIST_WRITE_RETRIES = 3;

async function editList(id: string, field: string, add: string | null, remove: string | null): Promise<void> {
    // **競合したら読み直してやり直す**（`follow.ts` の `updateFollowing` と
    // 同じ形）。「形は follow.ts に揃えた」と書きながら、**ここだけ揃って
    // いなかった**——素早く2回押す／2人が同時にブロックすると条件が外れて
    // そのまま 500 で、印は先に立っているぶん**一覧が片側だけ欠ける**
    // ＝隠すのが片向きだけになる（相手には自分のストーリーが見え続ける）。
    for (let attempt = 0; attempt < LIST_WRITE_RETRIES; attempt++) {
        try {
            await writeList(id, field, add, remove);
            return;
        } catch (e) {
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
            if (attempt === LIST_WRITE_RETRIES - 1) throw e;
        }
    }
}

async function writeList(id: string, field: string, add: string | null, remove: string | null): Promise<void> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
    const cur = ids(res.Item as Record<string, unknown> | undefined, field);
    const next = remove ? cur.filter((v) => v !== remove) : (cur.includes(add!) ? cur : [add!, ...cur]);
    // **変わらないなら書かない。** `&& !remove` を付けていたので、
    // 外す側は「もともと入っていない」回でも書きに行き、行が無ければ
    // **空配列の行を新しく作っていた**（`blocks#` と `blockedby#` の2つ）。
    // 掃除する人はいない
    if (next.length === cur.length) return;
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id },
        UpdateExpression: `SET #f = :next`,
        // 読んだ時点の姿を条件にする（同時に書かれた分を消さない）
        ConditionExpression: cur.length === 0 ? "attribute_not_exists(#f) OR #f = :prev" : "#f = :prev",
        ExpressionAttributeNames: { "#f": field },
        ExpressionAttributeValues: { ":next": next, ":prev": cur },
    }));
}

/** POST /users/{id}/block — この人からの反応を受け取らない */
export const blockUser: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const target = event.pathParameters?.id;
    if (!me || !target) return jsonError(400, "不正なリクエスト");
    if (me === target) return jsonError(400, "自分はブロックできません");
    // **形を見る。** 見ないと、任意の文字列を相手に見立てて
    // `block#` の印と `blockedby#<任意>` の行を作れる。解除で消えるのは
    // 印だけなので、空の行が永久に残る——このテーブルは公開一覧
    // （全表 Scan）が端から端まで読むので、増えるほど全員の表示が遅くなる。
    // `follow.ts` が**まさにこの理由**で持っている判定（`userId.ts` に共有）。
    // **実在までは見ない**——ブロックは「居ない人でも印だけ」で害が無く、
    // フォローと違って通知も集計も作らない
    if (!isUserId(target)) return jsonError(400, "不正なリクエスト");

    try {
        const mine = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(me) } }));
        const cur = ids(mine.Item as Record<string, unknown> | undefined, "blockedIds");
        // **上限は入れる前に見る**（`following` の2000人切り捨てを作らない）
        if (!cur.includes(target) && cur.length >= BLOCKS_MAX) {
            return jsonError(403, `ブロックは${BLOCKS_MAX}人までです`);
        }

        // 印が先。**判定に使うのはこれ**なので、一覧より先に立てる
        // （途中で切れても「ブロックが効いていないのに一覧には出る」を作らない）
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: { id: blockMarkerId(me, target), blockerId: me, blockedId: target, createdAt: new Date().toISOString() },
        }));
        await editList(blocksId(me), "blockedIds", target, null);
        // **相手側の一覧にも書く。** 隠すのは両向きで、相手は自分の
        // `blocks#` に何も持っていないため（docstring 参照）
        await editList(blockedById(target), "blockerIds", me, null);

        // **フォローは両向きに外す。**
        //
        // 隠すだけでは足りない——このサイトの写真は静的サイトに焼かれて
        // 未ログインでも見えるので、「フォロー中」フィードから相手の写真を
        // 消すには閲覧者ごとの出し分けが要る（そんな仕組みは無い）。
        // ブロックしたのに相手の写真がフィードに並び、フォロワー数にも
        // 数えられたままなのは、**ストーリーだけ消える**ぶん食い違いが目立つ。
        // 関係を切る方は1回の書き込みで済み、静的サイトとも矛盾しない
        // （Instagram も同じ倒し方）。
        //
        // **失敗してもブロックは成功で返す。** 印はもう立っていて、
        // 通知・返信・コメント・ストーリーはその印で止まる。
        // **呼ぶ側で握る**——`unfollowQuietly` も中で握っているが、
        // その保証は向こうの実装に依存する（相手が投げる形に変わった日に、
        // ブロックが 500 を返すようになる）。ここで守れば、この行だけ読んで
        // 「ブロックは通る」と分かる
        await Promise.all([
            unfollowQuietly(target, me).catch((e) => console.error("blockUser: 解除に失敗:", e)),
            unfollowQuietly(me, target).catch((e) => console.error("blockUser: 解除に失敗:", e)),
        ]);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ blocked: true }) };
    } catch (e) {
        console.error("blockUser error:", e);
        return jsonError(500, "ブロックできませんでした");
    }
};

/** DELETE /users/{id}/block — 解除 */
export const unblockUser: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const target = event.pathParameters?.id;
    if (!me || !target) return jsonError(400, "不正なリクエスト");
    if (!isUserId(target)) return jsonError(400, "不正なリクエスト");

    try {
        // **自分の一覧を最後に外す。**
        //
        // 一度「印を最後に消す」と書いたが、**直す手がかりを最初に壊して
        // いた**——`blocks#<me>` を先に空にすると、途中で落ちた回は
        // 「ブロックは効いたまま、画面の一覧からは消える」＝**解除ボタンが
        // 出ないので押し直せない**。自分の一覧は最後に触る（それまでに
        // 落ちたら、画面には相手が残っていて押し直せる）。
        await editList(blockedById(target), "blockerIds", null, me);
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: blockMarkerId(me, target) } }));
        await editList(blocksId(me), "blockedIds", null, target);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ blocked: false }) };
    } catch (e) {
        console.error("unblockUser error:", e);
        return jsonError(500, "解除できませんでした");
    }
};

/**
 * 退会したときの掃除。**自分が作ったブロックの行を消す。**
 *
 * 残すと、相手のブロック一覧に「退会したユーザー」の行が出続け、印
 * （`block#`）も誰にも消されないまま残る——このファイルの冒頭が書いている
 * とおり、このテーブルは公開一覧（全表 Scan）が端から端まで読むので、
 * 増えるほど全員の表示が遅くなる。
 *
 * **一覧の書き換えは `editList` に通す**（条件付き＋やり直し）。
 * ここで自前に書くと、同じ規則が2つになって静かにずれる。
 * **失敗しても投げない**——退会を止めるほどのものではない
 * （消し残しても見えるのは相手の一覧の1行で、GPS 入りの原本のような
 * 取り返しのつかないものではない）。呼び出し側はログだけ残す。
 */
export async function purgeBlocksFor(uid: string): Promise<void> {
    if (!uid) return;
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(uid) } }));
    const blocked = ids(res.Item as Record<string, unknown> | undefined, "blockedIds");
    for (const target of blocked) {
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: blockMarkerId(uid, target) } }))
            .catch((e) => console.error(`purgeBlocksFor: 印を消せませんでした（${target}）:`, e));
        await editList(blockedById(target), "blockerIds", null, uid)
            .catch((e) => console.error(`purgeBlocksFor: 相手の一覧から外せませんでした（${target}）:`, e));
    }
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(uid) } }))
        .catch((e) => console.error(`purgeBlocksFor: 自分の一覧を消せませんでした（${uid}）:`, e));
    // 自分をブロックしていた人の印（`block#<相手>#<自分>`）はここからは
    // 辿れるが**消さない**——相手の `blocks#` に残っている ID と食い違わせない
    // ため。相手が解除するか、相手が退会するときに一緒に消える
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: blockedById(uid) } }))
        .catch((e) => console.error(`purgeBlocksFor: 被ブロックの一覧を消せませんでした（${uid}）:`, e));
}

/**
 * 名前まで引く人数の上限。
 *
 * `BLOCKS_MAX` は500だが、500件の GetItem を1回の呼び出しで撃つと
 * 既定の6秒に近づく。ここを超えたぶんは ID だけ返し、画面は既定名を出す
 * （実際に500人ブロックしている人は居ない。上限は歯止めであって想定値ではない）。
 */
export const BLOCK_NAMES_MAX = 100;

/**
 * GET /user/blocks — 自分がブロックした人。
 *
 * **名前まで返す。** ID だけ返していた頃はこの口を呼ぶ画面が1つも
 * 無く（grep で0件）、**一度ブロックすると解除する手段が無かった**。
 * 画面側で1人ずつ `GET /profile/{id}` を叩く形にすると、Lambda の
 * 同時実行がアカウント全体で10しかないので人数ぶんの往復が刺さる。
 */
export const listBlocks: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    if (!me) return jsonError(401, "認証が必要です");
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(me) } }));
        const blockedIds = ids(res.Item as Record<string, unknown> | undefined, "blockedIds");
        // **退会した人を「旅人」として並べない。**
        // 名前が引けないのは「未設定の人」も「退会した人」も同じなので、
        // 画面のフォールバック（`旅人`）に落ちると**生きている人に見える**。
        // 一覧を返す口はこれで7本目で、ここだけ通っていなかった
        // （`getComments` / `getNotifications` / `getStoryReplies` /
        //  `getUserFollowing` / `getUserFollowers` / `getStoryViewers`）。
        // 引くのは一覧が空でないときだけ（あちらと同じ）。
        // このテーブルの走査は Scan なので、0件のときに撃たない
        const named = blockedIds.slice(0, BLOCK_NAMES_MAX);
        // **`.catch` は現状発火しない。** `deletedUserIds` は
        // `notify.ts` の中で握って空集合を返すので reject しない
        // ——4行下の `lookupDisplayNameIfSet` と同じ「保険」として置く。
        // あちらが投げるようになった日に、この口だけは 500 に倒したくない
        // （**ブロックを解除できる唯一の入口**なので、伏せられないどころか
        //   外せなくなる）。他の6本は裸の `await` のままでよい
        //   ——落ちても「読めない」で済む。
        //
        // 一度ここに「`named` ではなく `blockedIds` で見る」と書いたが、
        // `named` は `blockedIds.slice(0, 100)` なので**両者は等価**。
        // 101人目を救っているのは下のループだけ。
        const gone = blockedIds.length > 0
            ? await deletedUserIds().catch((e) => { console.error("listBlocks deletedUserIds:", e); return new Set<string>(); })
            : new Set<string>();
        // 名前が引けなくても一覧は返す（解除できることの方が大事）。
        // **それを保証しているのは `lookupDisplayNameIfSet` の側**——あちらが
        // 内部で握って `undefined` を返すので、ここの `.catch` は現状
        // 発火しない。あちらが投げるようになった日のための保険として置く
        const users = await Promise.all(named.map(async (id) => {
            if (gone.has(id)) return { id, name: DELETED_USER_NAME, deleted: true };
            const name = await lookupDisplayNameIfSet(id).catch(() => undefined);
            return name ? { id, name } : { id };
        }));
        // **上限を超えたぶんも伏せる。** ここだけ `gone` を見ていなかった
        // ので、101人目以降にいる退会者は画面のフォールバック（「旅人」）に
        // 落ちて**生きている人に見えていた**——直したはずの症状が、
        // 同じ関数の3行下に残っていた。集合はもう手元にある
        for (const id of blockedIds.slice(BLOCK_NAMES_MAX)) {
            users.push(gone.has(id) ? { id, name: DELETED_USER_NAME, deleted: true } : { id });
        }
        return {
            statusCode: 200,
            // 本人向け。共有キャッシュに載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ blockedIds, users }),
        };
    } catch (e) {
        console.error("listBlocks error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
