import { createHash } from "crypto";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * 管理 API から写真を消した・非公開にした・撮影地を変えたときに、旅のトランクのラベルの
 * 「地名を人に見せてよい」印（`placeOk`・保存は短い鍵 `o`）を**外す**（2026-10-18 coordinator 判断）。
 *
 * 判定と書き方の本体は `api-user/src/trunk.ts`・`api-user/src/trunkPlace.ts`（別のパッケージなので import できない）。
 * ここは**外すだけ**（付け直しは本人の編集・再送のときに api-user がやる）＝外し過ぎても漏れない側に倒れる。
 *
 * - 行は `trunk#<持ち主>`（photos テーブル）。読む → 当たるラベルの `o` を消す → **rev 条件で置き直す**
 *   （api-user の `updateTrunk` と同じ rev。あちらは rev が進んでいれば読み直す）。権限は今の GetItem・PutItem で足りる
 * - 当たるラベル: id がこの写真の id か、束の鍵（`g:` ＋ sha256(groupId) の先頭12桁）が同じもの
 *   （束の兄弟がまだ公開でも外す。見せない側に倒す）
 * - **投げない**（写真の削除・更新は成功のまま。落ちたら記録だけ）
 */
const ATTEMPTS = 4;

const groupKey = (groupId: string) => `g:${createHash("sha256").update(groupId.trim()).digest("hex").slice(0, 12)}`;

/** 保存されたラベルの並びから、当たるものの印を外す（純関数）。変われば新しい並び、変わらなければ null */
export function dropPlaceOkFrom(labels: unknown, photoId: string, group: string): unknown[] | null {
    if (!Array.isArray(labels)) return null;
    const g = group ? groupKey(group) : "";
    let changed = false;
    const next = labels.map((v) => {
        if (!v || typeof v !== "object") return v;
        const l = v as Record<string, unknown>;
        const id = typeof l.i === "string" ? l.i : l.id;
        const lg = typeof l.g === "string" ? l.g : l.groupId;
        if (id !== photoId && !(g && lg === g)) return v;
        if (!("o" in l) && !("placeOk" in l)) return v;
        changed = true;
        const { o: _o, placeOk: _p, ...rest } = l;
        void _o; void _p;
        return rest;
    });
    return changed ? next : null;
}

export async function dropTrunkPlaceOkQuietly(photo: Record<string, unknown>, label: string): Promise<void> {
    const owner = (photo.userId ?? photo.uploadedBy) as unknown;
    const photoId = photo.id;
    if (typeof owner !== "string" || !owner || typeof photoId !== "string" || !photoId) return;
    const group = typeof photo.groupId === "string" ? photo.groupId.trim() : "";
    const id = `trunk#${owner}`;
    try {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id }, ConsistentRead: true }));
            const row = res.Item as Record<string, unknown> | undefined;
            if (!row) return;
            const pocket = dropPlaceOkFrom(row.pocket, photoId, group);
            const stuck = dropPlaceOkFrom(row.stuck, photoId, group);
            if (!pocket && !stuck) return;
            const rev = typeof row.rev === "number" ? row.rev : 0;
            try {
                await ddb.send(new PutCommand({
                    TableName: PHOTOS_TABLE,
                    Item: { ...row, ...(pocket ? { pocket } : {}), ...(stuck ? { stuck } : {}), rev: rev + 1, updatedAt: new Date().toISOString() },
                    ConditionExpression: rev === 0 ? "attribute_not_exists(rev) OR rev = :rev" : "rev = :rev",
                    ExpressionAttributeValues: { ":rev": rev },
                }));
                return;
            } catch (e) {
                if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
            }
        }
        console.error(`${label}: ラベルの地名の印を外す書き込みが競合し続けました（${id}）`);
    } catch (e) {
        console.error(`${label}: ラベルの地名の印を外せませんでした（${id}）:`, e);
    }
}
