import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

// **一覧の書き込みは境界としてモックする**（`likes.test.ts` と同じ判断）。
// `updateUserList` は ddb を自分で叩くので、本物を通すとこのファイルの
// 位置指定のモック列（Get → Put …）に読み書きが割り込む。
// あの関数そのものは `userList.test.ts` が見る。
const mockUpdateUserList = vi.hoisted(() => vi.fn<(...a: unknown[]) => Promise<void>>(async () => {}));
const mockReadUserList = vi.hoisted(() => vi.fn<(...a: unknown[]) => Promise<string[]>>(async () => []));
vi.mock("../userList", () => ({
    updateUserList: (...a: unknown[]) => mockUpdateUserList(...(a as [])),
    readUserList: (...a: unknown[]) => mockReadUserList(...(a as [])),
    UserListError: class extends Error {},
}));

const { getMySaves, getMySave, savePhoto, unsavePhoto } = await import("../saves");

/** `noteSaved` が渡した mutate を、渡された現在のリストに当てて結果を見る */
function listCalls() {
    return mockUpdateUserList.mock.calls.map((c) => {
        const [rowId, uid, max, mutate] = c as unknown as [string, string, number, (l: string[]) => string[] | null];
        return { rowId, uid, max, mutate };
    });
}

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, id: string | undefined) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id ? { id } : undefined,
    };
}

/** 公開中の写真 1件ぶんの GetItem 応答 */
const visiblePhoto = { Item: { src: "https://cdn/x.jpg" } };

// `mockReset()` は**モック自身を返す**ので、アローの暗黙の return だと
// vitest が後片付けの関数だと思って引数なしで呼ぶ（`block.test.ts` 参照）。
beforeEach(() => { mockDdbSend.mockReset(); mockUpdateUserList.mockReset(); mockReadUserList.mockReset().mockResolvedValue([]); });

describe("getMySave", () => {
    it("マーカーがあれば saved=true・無ければ false", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "save#p1#u1" } });
        expect(JSON.parse((await invoke(getMySave, ev("u1", "p1"))).body)).toEqual({ saved: true });
        expect((mockDdbSend.mock.calls[0][0] as { input: { Key: { id: string } } }).input.Key.id)
            .toBe("save#p1#u1");

        mockDdbSend.mockResolvedValueOnce({});
        expect(JSON.parse((await invoke(getMySave, ev("u1", "p2"))).body)).toEqual({ saved: false });
    });

    it("共有キャッシュには載せない（他人の状態が配られるため）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await invoke(getMySave, ev("u1", "p1")) as unknown as { headers: Record<string, string> };
        expect(res.headers["Cache-Control"]).toContain("no-store");
        expect(res.headers["Cache-Control"]).not.toContain("public");
    });

    it("認証・id なしは 400", async () => {
        expect((await invoke(getMySave, ev(undefined, "p1"))).statusCode).toBe(400);
        expect((await invoke(getMySave, ev("u1", undefined))).statusCode).toBe(400);
    });
});

describe("getMySaves", () => {
    it("`saves#<uid>` の一覧をそのまま返す", async () => {
        mockReadUserList.mockResolvedValue(["p3", "p2", "p1"]);
        const res = await invoke(getMySaves, ev("u1", undefined));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ photoIds: ["p3", "p2", "p1"] });
        expect(mockReadUserList.mock.calls[0][0]).toBe("saves#u1");
    });

    it("**いいねの行を読まない**（`likes#<uid>` と混ぜると棚が入れ替わる）", async () => {
        await invoke(getMySaves, ev("u1", undefined));
        expect(mockReadUserList.mock.calls[0][0]).not.toBe("likes#u1");
    });

    it("写真IDの形だけ通す判定を渡している（`#` 入りは一覧に混ぜない）", async () => {
        await invoke(getMySaves, ev("u1", undefined));
        const valid = mockReadUserList.mock.calls[0][1] as (x: string) => boolean;
        expect(valid("p1")).toBe(true);
        expect(valid("save#p1#u1")).toBe(false);   // マーカーが紛れ込んでも落とす
        expect(valid("")).toBe(false);
        expect(valid("x".repeat(129))).toBe(false);
    });

    it("認証なしは 400", async () => {
        expect((await invoke(getMySaves, ev(undefined, undefined))).statusCode).toBe(400);
    });
});

describe("savePhoto", () => {
    it("認証・id なしは 400", async () => {
        expect((await invoke(savePhoto, ev(undefined, "p1"))).statusCode).toBe(400);
        expect((await invoke(savePhoto, ev("u1", undefined))).statusCode).toBe(400);
    });

    it("保存: マーカーを作り、一覧の先頭に足す", async () => {
        mockDdbSend
            .mockResolvedValueOnce(visiblePhoto)   // 公開かどうかの確認
            .mockResolvedValueOnce({});            // Put marker
        const res = await invoke(savePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ saved: true });

        const put = mockDdbSend.mock.calls[1][0] as { input: { Item: { id: string; uid: string; userId?: string } } };
        expect(put.input.Item.id).toBe("save#p1#u1");
        expect(put.input.Item.uid).toBe("u1");
        expect(put.input.Item.userId).toBeUndefined();   // 写真一覧の GSI を汚さない

        const [call] = listCalls();
        expect(call.rowId).toBe("saves#u1");
        expect(call.max).toBe(1000);
        expect(call.mutate(["p9"])).toEqual(["p1", "p9"]);   // 新しい順
    });

    it("既に一覧にあれば書き込まない（null を返す）", async () => {
        mockDdbSend.mockResolvedValueOnce(visiblePhoto).mockResolvedValueOnce({});
        await invoke(savePhoto, ev("u1", "p1"));
        expect(listCalls()[0].mutate(["p1", "p9"])).toBeNull();
    });

    it("**一覧の書き込みが落ちても保存は成功**（索引1行のために保存を落とさない）", async () => {
        mockDdbSend.mockResolvedValueOnce(visiblePhoto).mockResolvedValueOnce({});
        mockUpdateUserList.mockRejectedValueOnce(new Error("競合"));
        const res = await invoke(savePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ saved: true });
    });

    it("非公開（下書き）・ストーリー・不在の写真は 404（マーカーを作らない）", async () => {
        for (const item of [
            { Item: { src: "https://cdn/x.jpg", published: false } },
            { Item: { src: "https://cdn/x.jpg", story: true } },
            { Item: { id: "comments#p1" } },   // `src` を持たない＝写真ではない
            {},                                 // そもそも無い
        ]) {
            mockDdbSend.mockReset();
            mockUpdateUserList.mockReset();
            mockDdbSend
                .mockResolvedValueOnce(item)   // 公開かどうかの確認
                .mockResolvedValueOnce({});    // マーカーの確認（無い）
            const res = await invoke(savePhoto, ev("u1", "p1"));
            expect(res.statusCode).toBe(404);
            // Put が1回も飛んでいないこと
            for (const c of mockDdbSend.mock.calls) {
                expect((c[0] as { constructor: { name: string } }).constructor.name).not.toBe("PutCommand");
            }
            expect(mockUpdateUserList).not.toHaveBeenCalled();
        }
    });

    it("`published` の無い古い行は公開扱い（一覧・いいねと同じ）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg" } }).mockResolvedValueOnce({});
        expect((await invoke(savePhoto, ev("u1", "p1"))).statusCode).toBe(200);
    });

    it("見えない写真でも、マーカーが在れば `saved: true` を添える", async () => {
        // これが無いと、画面は「保存できなかった」と読んで未保存に戻す
        // ——サーバーにはマーカーがあるので、開いている間ずっと解除できない
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", published: false } })
            .mockResolvedValueOnce({ Item: { id: "save#p1#u1" } });
        const res = await invoke(savePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: "写真が見つかりません", saved: true });
    });

    it("見えない＆マーカーも無ければ、存在を漏らさない（`saved` を付けない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/x.jpg", published: false } })
            .mockResolvedValueOnce({});
        expect(JSON.parse((await invoke(savePhoto, ev("u1", "p1"))).body))
            .toEqual({ error: "写真が見つかりません" });
    });
});

describe("unsavePhoto", () => {
    it("認証・id なしは 400", async () => {
        expect((await invoke(unsavePhoto, ev(undefined, "p1"))).statusCode).toBe(400);
        expect((await invoke(unsavePhoto, ev("u1", undefined))).statusCode).toBe(400);
    });

    it("解除: マーカーを消し、一覧からも外す", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await invoke(unsavePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ saved: false });
        expect((mockDdbSend.mock.calls[0][0] as { input: { Key: { id: string } } }).input.Key.id)
            .toBe("save#p1#u1");
        expect(listCalls()[0].mutate(["p1", "p9"])).toEqual(["p9"]);
        expect(listCalls()[0].mutate(["p9"])).toBeNull();   // 元から無ければ書かない
    });

    it("**マーカーを消したあとに一覧を触る**（消し損ねた回に棚だけ消さない）", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("落ちた"));
        expect((await invoke(unsavePhoto, ev("u1", "p1"))).statusCode).toBe(500);
        expect(mockUpdateUserList).not.toHaveBeenCalled();
    });

    it("**公開状態を見ない**（非公開に戻された写真を棚から外せなくなるため）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect((await invoke(unsavePhoto, ev("u1", "p1"))).statusCode).toBe(200);
        // 写真本体の GetItem を1回も打っていないこと（打つ＝公開判定を入れたということ）
        expect(mockDdbSend.mock.calls).toHaveLength(1);
        expect((mockDdbSend.mock.calls[0][0] as { constructor: { name: string } }).constructor.name)
            .toBe("DeleteCommand");
    });

    it("保存していない写真の解除も 200（冪等）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect(JSON.parse((await invoke(unsavePhoto, ev("u1", "p1"))).body)).toEqual({ saved: false });
    });

    // **外す側には「押し直せば直る」出口が無い。**
    //
    // 足す側（POST）は、一覧の書き込みだけ落ちてもマーカーが在るので、
    // もう一度押せば冪等経路が足し直す。外す側で同じように握りつぶすと、
    // 棚には残りマーカーは無い——`getMySave` は「未保存」と答えるので
    // 画面はしおりを空で描き、押すと**解除ではなく保存**が飛ぶ。
    // つまり**棚から外す手段が画面から消える**。
    it("一覧から外せなかったら、マーカーを戻して失敗を返す", async () => {
        mockDdbSend.mockResolvedValueOnce({});            // Delete marker
        mockUpdateUserList.mockRejectedValueOnce(new Error("競合"));
        const res = await invoke(unsavePhoto, ev("u1", "p1"));

        expect(res.statusCode).toBe(500);
        // 戻した＝両方「保存済み」に揃っている（もう一度押せばやり直せる）
        const puts = mockDdbSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: { Item?: { id: string } } })
            .filter((c) => c.constructor.name === "PutCommand");
        expect(puts).toHaveLength(1);
        expect(puts[0].input.Item?.id).toBe("save#p1#u1");
    });

    it("マーカーを戻せなくても 500 を返す（成功と言わない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})                       // Delete marker
            .mockRejectedValueOnce(new Error("戻せない"));    // Put marker（巻き戻し）
        mockUpdateUserList.mockRejectedValueOnce(new Error("競合"));
        expect((await invoke(unsavePhoto, ev("u1", "p1"))).statusCode).toBe(500);
    });
});

// **`savePhoto` という名前の関数キーは使えない**——`src/upload.savePhoto`
// （投稿の確定）が既に使っている。重ねると YAML が
// `duplicated mapping key` で読めなくなり、api-user のデプロイが丸ごと落ちる。
// 一度この名前で書いて踏んだので、見張りを置く。
describe("serverless.yml", () => {
    // **YAML パーサは使わない**——`js-yaml` はどの package.json にも書かれて
    // いない推移依存で、巻き上げが変わるとテストだけが先に壊れる
    // （`scripts/__tests__/publicLambdaRole.test.ts` と同じ判断）。
    /** `functions:` の下にある「2スペース字下げの 名前:」を出てくる順に全部 */
    function functionKeys(yml: string): string[] {
        const body = yml.split(/\nfunctions:\n/)[1];
        if (!body) throw new Error("functions: が見つからない");
        const section = body.split(/\n(?=[a-zA-Z#])/)[0];
        return [...section.matchAll(/^ {2}(\w+):$/gm)].map((m) => m[1]);
    }

    const yml = readFileSync(join(__dirname, "..", "..", "serverless.yml"), "utf8");

    it("関数キーが重複していない（重なると YAML ごと読めなくなる）", () => {
        const keys = functionKeys(yml);
        const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
        expect(dup).toEqual([]);
    });

    it("保存の口は `savePhoto` を名乗らない（投稿の確定が使っている）", () => {
        const keys = functionKeys(yml);
        expect(keys).toContain("savePhoto");        // src/upload.savePhoto（投稿の確定）
        expect(keys).toContain("addPhotoSave");
        expect(keys).toContain("removePhotoSave");
        for (const h of ["src/saves.savePhoto", "src/saves.unsavePhoto", "src/saves.getMySave", "src/saves.getMySaves"]) {
            expect(yml).toContain(`handler: ${h}`);
        }
    });
});

describe("いいねとは別の棚である", () => {
    it("マーカーも一覧の行も `like#` / `likes#` と衝突しない", async () => {
        mockDdbSend.mockResolvedValueOnce(visiblePhoto).mockResolvedValueOnce({});
        await invoke(savePhoto, ev("u1", "p1"));
        const put = mockDdbSend.mock.calls[1][0] as { input: { Item: { id: string } } };
        expect(put.input.Item.id).toBe("save#p1#u1");
        expect(listCalls()[0].rowId).toBe("saves#u1");
    });
});
