import { describe, it, expect } from "vitest";
import { lambdaInvalidationsFor, type CfReader } from "../verify-invalidate";

// **この関数がこの道具の判定そのもの。** テストが1本も無く、
// 「時刻の窓を丸ごと外す」「`startsWith("del-")` を `startsWith("del")` にする」
// のどちらの変異も素通りしていた（レビューが実測）。
//
// 窓だけで数えると、**他人の削除を自分の成果にする**——staging の毎時
// `cleanupStories`、別の利用者の削除、前回の残骸が後から掃除されたぶん。
// レビューは偽の SDK で「Lambda が何もしていないのに両経路が成功」を実証した。

const T0 = 1_000_000;
type Inv = { id: string; at: number; ref: string; paths: string[] };

/** ListInvalidations / GetInvalidation だけを返す偽物 */
function reader(items: Inv[]): CfReader {
    return {
        send: async (cmd: { constructor: { name: string }; input: { Id?: string } }) => {
            if (cmd.constructor.name === "ListInvalidationsCommand") {
                return { InvalidationList: { Items: items.map((i) => ({ Id: i.id, CreateTime: new Date(i.at) })) } };
            }
            const hit = items.find((i) => i.id === cmd.input.Id)!;
            return { Invalidation: { InvalidationBatch: { CallerReference: hit.ref, Paths: { Items: hit.paths } } } };
        },
    };
}

const MINE = "/uploads/verify-invalidate/123.bin";

describe("自分が作った無効化だけを拾う", () => {
    it("自分のパスを含むものだけ数える（他人の del- は数えない）", async () => {
        const got = await lambdaInvalidationsFor("D", T0, MINE, reader([
            { id: "a", at: T0 + 10, ref: "del-1-0-1", paths: ["/uploads/someone-else.jpg"] },
            { id: "b", at: T0 + 20, ref: "del-2-0-1", paths: [MINE] },
        ]));
        expect(got, "他人の削除を自分の成果にしている").toEqual(["del-2-0-1"]);
    });

    it("開始より前のものは数えない", async () => {
        const got = await lambdaInvalidationsFor("D", T0, MINE, reader([
            { id: "old", at: T0 - 1, ref: "del-0-0-1", paths: [MINE] },
        ]));
        expect(got).toEqual([]);
    });

    it("デプロイ由来（del- で始まらない）は数えない", async () => {
        const got = await lambdaInvalidationsFor("D", T0, MINE, reader([
            { id: "a", at: T0 + 1, ref: "1757000000000-0", paths: [MINE] },
            { id: "b", at: T0 + 2, ref: "reheal-1757", paths: [MINE] },
            { id: "c", at: T0 + 3, ref: "restrict-originals-1757", paths: [MINE] },
        ]));
        expect(got).toEqual([]);
    });

    // 頭が `del-` であること（`del` を含むだけ／`del` で始まるだけは別物）
    it("`del` で始まるだけの別物は数えない", async () => {
        const got = await lambdaInvalidationsFor("D", T0, MINE, reader([
            { id: "a", at: T0 + 1, ref: "delivery-1757", paths: [MINE] },
        ]));
        expect(got).toEqual([]);
    });

    // 正常系: 複数チャンクに分かれた場合は全部拾う
    it("同じパスを含む無効化が複数あれば全部返す", async () => {
        const got = await lambdaInvalidationsFor("D", T0, MINE, reader([
            { id: "a", at: T0 + 1, ref: "del-1-0-1", paths: [MINE] },
            { id: "b", at: T0 + 2, ref: "del-1-1-1", paths: ["/other", MINE] },
        ]));
        expect(got).toEqual(["del-1-0-1", "del-1-1-1"]);
    });

    it("履歴が空なら空", async () => {
        expect(await lambdaInvalidationsFor("D", T0, MINE, reader([]))).toEqual([]);
    });
});
