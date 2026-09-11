import { describe, it, expect, vi, beforeEach } from "vitest";

// **アルバムから写真の ID を取り除く。**
//
// 削除の経路は3つ（本人・退会・管理者）あるのに、呼んでいたのは本人の
// 削除だけだった。残り2つを塞ぐにあたって、`deleteAccount` が**8並列**
// だと分かり、1枚ずつ撃つ形では同じ行を取り合って**先着1本以外が全部
// 条件不成立**になることを実測した（8枚中1枚しか外れない）。
// まとめて外す形＋やり直しに変えたのがこのモジュール。

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test" }));

// **`await import` を使わない。** このパッケージの tsconfig は
// top-level await を通さないので、型エラーの件数が1増える
// （台帳は「件数が増えていないこと」で見ている）。
// ここは `vi.mock` が巻き上がるので静的 import で足りる
import { removePhotosFromAlbum, removePhotoFromAlbum } from "../albumCleanup";

const ccf = () => Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" });
const cmds = () => mockSend.mock.calls.map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> });
const updates = () => cmds().filter((c) => c.constructor.name === "UpdateCommand");
const nextOf = (i: number) => (updates()[i].input.ExpressionAttributeValues as { ":next": string[] })[":next"];

beforeEach(() => { mockSend.mockReset(); });

describe("removePhotosFromAlbum", () => {
    it("まとめて外す（アルバムへの書き込みは1回）", async () => {
        mockSend.mockImplementation(async (cmd: { constructor: { name: string } }) =>
            cmd.constructor.name === "GetCommand"
                ? { Item: { id: "album#A", photoIds: ["p1", "p2", "p3", "keep"] } }
                : {});

        await removePhotosFromAlbum("A", ["p1", "p2", "p3"]);

        expect(updates(), "1枚ずつ撃っている").toHaveLength(1);
        expect(nextOf(0)).toEqual(["keep"]);
    });

    // **条件不成立は「誰かが先に書いた」。** 読み直して撃ち直せば収束する
    // ——このアルバムは全員が同じ1行を書くので、他人が同時に足すことがある
    it("競合したら読み直して撃ち直す（他人が足した写真を消さない）", async () => {
        let stored = ["p1", "keep"];
        let firstUpdate = true;
        mockSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") return { Item: { id: "album#A", photoIds: [...stored] } };
            if (firstUpdate) {
                firstUpdate = false;
                stored = ["p1", "keep", "somebody-elses"];   // 他人が先に足した
                throw ccf();
            }
            const v = cmd.input.ExpressionAttributeValues as { ":prev": string[]; ":next": string[] };
            expect(v[":prev"], "読み直していない（古い一覧を条件にしている）").toEqual(stored);
            stored = v[":next"];
            return {};
        });

        await removePhotosFromAlbum("A", ["p1"]);

        expect(stored, "他人が足した写真を巻き込んで消している").toEqual(["keep", "somebody-elses"]);
    });

    // **条件不成立以外は投げ直す。** 権限や接続の失敗を「誰かが先に書いた」と
    // 読んで撃ち直すと、理由が消えて何度も叩くだけになる
    it("条件不成立以外は、撃ち直さずそのまま投げる", async () => {
        const boom = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
        mockSend.mockImplementation(async (cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return { Item: { id: "album#A", photoIds: ["p1"] } };
            throw boom;
        });

        await expect(removePhotosFromAlbum("A", ["p1"])).rejects.toThrow("denied");
        expect(updates(), "条件不成立でないのに撃ち直している").toHaveLength(1);
    });

    // 競合し続けたら投げる（黙って「外した」ことにしない）
    it("競合し続けたら投げる", async () => {
        mockSend.mockImplementation(async (cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return { Item: { id: "album#A", photoIds: ["p1"] } };
            throw ccf();
        });

        await expect(removePhotosFromAlbum("A", ["p1"])).rejects.toThrow(/競合/);
        expect(updates().length, "やり直していない").toBeGreaterThan(1);
    });

    // **外すものが無ければ書かない。** 既に消えている・そもそも入っていない
    it("外すものが無ければ書き込まない", async () => {
        mockSend.mockImplementation(async () => ({ Item: { id: "album#A", photoIds: ["keep"] } }));
        await removePhotosFromAlbum("A", ["p1"]);
        expect(updates(), "関係ないのに書いている").toHaveLength(0);
    });

    it("アルバムの行が無ければ書き込まない", async () => {
        mockSend.mockImplementation(async () => ({}));
        await removePhotosFromAlbum("A", ["p1"]);
        expect(updates()).toHaveLength(0);
    });

    // 空の入力では引きにも行かない（往復を増やさない）
    it("空の入力では何もしない", async () => {
        await removePhotosFromAlbum("A", []);
        await removePhotosFromAlbum("", ["p1"]);
        expect(mockSend, "引きに行っている").not.toHaveBeenCalled();
    });

    it("1枚版は、まとめ版に委譲する", async () => {
        mockSend.mockImplementation(async (cmd: { constructor: { name: string } }) =>
            cmd.constructor.name === "GetCommand" ? { Item: { id: "album#A", photoIds: ["p1", "keep"] } } : {});
        await removePhotoFromAlbum("A", "p1");
        expect(nextOf(0)).toEqual(["keep"]);
    });
});
