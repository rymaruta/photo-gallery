import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * 「利用者ごとの、新しい順のリストを1行で持つ」書き込み口。
 *
 * このテーブルにソートキーは無いので、`follow#<相手>#<自分>` のような
 * マーカーは**前方一致で列挙できない**（全表 Scan しか手が無い）。
 * だから「自分がフォローしている人」「自分がいいねした写真」のような
 * 一覧は、利用者ごとの1行（`{ list, rev }`）に持つ。
 *
 * **規則をここ1つに置く。** 元は `follow.ts` の中に在り、その関数自身が
 * 「規則を2つ書くと静かにずれる」と書いていた。いいねの一覧を足すときに
 * 写して2つ目を作りかけたので、切り出して両方から呼ぶ。
 *
 * ## なぜ Put + rev なのか（集合型や list_append ではなく）
 *
 * 以前は「読む → 変える → 無条件で Put」だった。1秒のうちに2件書くと
 * 2つの Lambda が同じ古いリストを読み、片方がもう片方を丸ごと上書きして
 * 一覧が欠けた。しかもマーカーは両方残るので、もう一度押しても
 * 「既に済み」で早期 return し、**一覧は欠けたまま直らない**。
 *
 * 順序（新しい順）を保ちたいので集合型には替えず、リビジョン番号で
 * 衝突を見て読み直す。
 */

const WRITE_RETRIES = 3;
/** やり直しの待ち（指数＋ばらつき）。多人数が同じ行を書く `followers#` 用 */
const RETRY_BASE_MS = 25;

/** 一覧の書き込みを諦めたときのエラー。呼び出し側が打ち消し処理に使う */
export class UserListError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UserListError";
    }
}

/**
 * `rowId` の `list` を書き換える。
 *
 * @param mutate 現在のリストを受け取り、新しいリストを返す。**変更が無ければ
 *   `null`**（書き込みを省く）。渡す配列は複製済みなので破壊的に触ってよい。
 * @param max 保持する上限。**溢れるのは古い方**。
 *   ⚠️ 上限に達したぶんが落ちても、**「済みかどうか」はマーカーで決まる**
 *   （この一覧からは決めない）。決めてしまうと、溢れた相手に対して
 *   画面が「まだ」と表示し、押すと解除が飛ぶ形になる。
 */
export async function updateUserList(
    rowId: string,
    uid: string,
    max: number,
    mutate: (list: string[]) => string[] | null,
): Promise<void> {
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: rowId } }));
        const current = Array.isArray(res.Item?.list) ? (res.Item.list as string[]) : [];
        const rev = typeof res.Item?.rev === "number" ? res.Item.rev : 0;

        const next = mutate([...current]);
        if (next === null) return; // 変更なし

        // 読んでから今までに他の書き込みが入っていないこと。
        // rev を持たない既存データ（この仕組みを入れる前の item）も通す必要が
        // あるので、rev が無いときだけ条件を緩める。
        // DynamoDB は値どうしの比較を許さないため、分岐は JS 側で作る。
        const guard = rev === 0
            ? "attribute_not_exists(id) OR attribute_not_exists(rev) OR rev = :rev"
            : "rev = :rev";

        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: {
                    id: rowId,
                    uid,
                    list: next.slice(0, max),
                    rev: rev + 1,
                    updatedAt: new Date().toISOString(),
                },
                ConditionExpression: guard,
                ExpressionAttributeValues: { ":rev": rev },
            }));
            return;
        } catch (e) {
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
            // 競合。読み直してやり直す。
            //
            // **間を置く。** `following#<自分>` / `likes#<自分>` は書き手が
            // 本人1人なので競合はほぼ起きないが、`followers#<相手>` は
            // **その人をフォロー／解除する全員が同じ1行を書く**。即座に
            // 撃ち直すと押し合いになるだけなので、指数で待ってばらす。
            // **最後の回は待たない**——待ってもループが尽きて投げるだけ。
            if (attempt < WRITE_RETRIES) {
                await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random())));
            }
        }
    }
    // 諦めたことを黙って飲み込まない。呼び出し側が打ち消すか、
    // 「欠けても押し直せば直る」形かを選べるように投げる。
    throw new UserListError(`${rowId} の一覧更新が競合し続けました`);
}

/** `rowId` の `list` を読む（形の違う要素は落とす） */
export async function readUserList(rowId: string, valid: (x: string) => boolean, label: string): Promise<string[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: rowId } }));
    const list = res.Item?.list;
    if (!Array.isArray(list)) return [];
    const out = list.filter((x): x is string => typeof x === "string" && valid(x));
    if (out.length !== list.length) {
        console.warn(`${label}: 形の違う値を ${list.length - out.length} 件落としました`);
    }
    return out;
}
