import { listMyMediaItems } from "./ddb-photos";
import { mediaKeys } from "./mediaKeys";
import { dropOld } from "./s3Move";

/**
 * **移した元を消す。自分のほかの行が使っていないものだけ。**
 *
 * 入口の確かめ（`isOwnUploadUrl`）は「自分の領域か」しか見ないので、サムネや
 * 2枚目に**自分の別の写真の URL**を渡せる。ストーリーから残した写真は
 * **ストーリーと実体を共有している**（`storyKeep.ts`）。確かめずに消すと、
 * その写真・ストーリーが割れる（取り返しのつかない削除）。
 * `discardUpload` と同じく行を読み直し、読めなければ**消さない**（孤児が残るだけで済む側）。
 *
 * **`selfId`（いま書き換えた行）は一覧から除く。** 一覧は結果整合（GSI）なので、
 * 書き換えた直後は**書き換える前の版**が見えることがある。それを「使用中」と
 * 読むと元を消さない＝**絞ったのに公開の置き場に残る**。自分の行の今の中身は
 * 呼び出し側が知っている（新しい置き場を指している）ので、一覧の版は見ない。
 *
 * ⚠️ 一覧は結果整合なので、**直前に書かれたほかの行は見落としうる**。だから
 * **コピー（移した先）はここへ渡さない**——同時に走る要求が同じ鍵を指す行を
 * 書いている最中でも見えないため。元の側に残る窓（書き換えた直後に別タブで
 * 戻された場合）は `photoUpdate.ts` の移動が前から持つ窓と同じ幅で許容する。
 */
export async function dropUnusedKeys(userId: string, keys: string[], logPrefix: string, selfId?: string): Promise<void> {
    if (keys.length === 0) return;
    let inUse: Set<string>;
    try {
        const mine = await listMyMediaItems(userId);
        inUse = new Set(mine
            .filter((p) => !selfId || p.id !== selfId)
            .flatMap((p) => mediaKeys(p as unknown as Record<string, unknown>)));
    } catch (e) {
        console.warn(`${logPrefix}: 使用中かを確かめられないので消しません`, (e as Error)?.name);
        return;
    }
    const drop = [...new Set(keys)].filter((k) => !inUse.has(k));
    if (drop.length === 0) return;
    // **投げさせない。** 呼び出し側は行を書き終えている——ここで例外が上がると、
    // 済んだ更新について 500 を返す。残るのは孤児だけ（`orphan-uploads` が拾える）
    try {
        const failed = await dropOld(drop.map((k) => ({ from: k, to: k })), logPrefix);
        if (failed > 0) console.warn(`${logPrefix}: ${failed} 件を消せませんでした`);
    } catch (e) {
        console.warn(`${logPrefix}: 消せませんでした（更新は済んでいる）`, (e as Error)?.name);
    }
}
