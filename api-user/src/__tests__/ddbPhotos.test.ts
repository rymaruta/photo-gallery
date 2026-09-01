import { describe, it, expect, vi, beforeEach } from "vitest";

// api/src/ddb-photos.ts と対の実装。こちらにはテストが無かった。
//
// putPhoto は新規作成専用。条件が無いと同じIDの既存レコードを丸ごと
// 置き換える。このテーブルには通知（notifs#…）やコメント（comments#…）も
// 同居しているので、ID を指定できるだけで他人の通知を全部消せてしまう。

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { putPhoto, getPhotoById, overwriteOwnPhoto, countUserPhotos, hasAnyUserItem } = await import("../ddb-photos");

// **中括弧で囲う。** 式のままだと**モック自身を返す**——vitest は
// フックの戻り値が関数だと後片付けとして扱うので、各テストのあとに
// そのモックが**引数なしで呼ばれる**。実装が `mockResolvedValue` の
// うちは無害だが、引数を見るモックに変えた瞬間に落ちる。
beforeEach(() => { mockSend.mockReset().mockResolvedValue({}); });

describe("putPhoto: 既存の行を置き換えない", () => {
    it("attribute_not_exists(id) を必ず付ける", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await putPhoto({ id: "p1", src: "https://cdn/p1.jpg" } as any);
        const input = mockSend.mock.calls[0][0].input as { ConditionExpression?: string; TableName?: string };
        expect(input.ConditionExpression).toBe("attribute_not_exists(id)");
        expect(input.TableName).toBe("photos-test");
    });
});

// 100枚制限の判定に使う。api 側にはページングも絞り込みも無い旧版が
// 残っているので、こちらが「直った方」であることを固定する。
describe("countUserPhotos", () => {
    it("1ページで収まらなくても最後まで数える", async () => {
        // Query は 1MB 読んだ時点で打ち切られる。LastEvaluatedKey を
        // 追わないと、写真が増えるほど**少なめに数える**＝上限が緩む。
        mockSend
            .mockResolvedValueOnce({ Count: 60, LastEvaluatedKey: { id: "x" } })
            .mockResolvedValueOnce({ Count: 45 });
        expect(await countUserPhotos("u1")).toBe(105);
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("ストーリーは数えない（24時間で消えるものを上限に含めない）", async () => {
        mockSend.mockResolvedValueOnce({ Count: 3 });
        await countUserPhotos("u1");
        const input = mockSend.mock.calls[0][0].input as { FilterExpression?: string };
        expect(input.FilterExpression).toContain("attribute_exists(src)");
        expect(input.FilterExpression).toContain("attribute_not_exists(story)");
    });

    it("下書きは数える（容量の上限なので公開状態は関係ない）", async () => {
        // 外すと「下書きなら無制限に上げられる」穴になる。
        // 以前コメントには「下書きも絞る」と書かれていて、実装と食い違っていた。
        mockSend.mockResolvedValueOnce({ Count: 3 });
        await countUserPhotos("u1");
        const input = mockSend.mock.calls[0][0].input as { FilterExpression?: string };
        expect(input.FilterExpression).not.toContain("published");
    });
});

// discardUpload の使用中判定が listMyPhotos（ストーリー除外）だった頃は、
// 自分の生きているストーリーの実体を消せた。ハンドラ側のテストはデータ層を
// モックするので、**この絞り込み条件はここでしか観測できない**。
describe("listMyMediaItems", () => {
    it("ストーリーを除外しない（実体を参照しうるものを全部見る）", async () => {
        mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
        const { listMyMediaItems } = await import("../ddb-photos");
        await listMyMediaItems("me");

        const query = mockSend.mock.calls.at(0)![0];
        expect(query.input.FilterExpression).toBe("attribute_exists(src)");
        expect(query.input.FilterExpression).not.toContain("story");
    });

    // **GSI の射影を信じない。** 使い道は「このアップロード済みファイルは
    // まだ使われているか」の判定（`discardUpload`）で、索引が `ALL` でなければ
    // `key` や `srcOriginal` が落ちる——**使われているのに「未使用」**と
    // 判定して S3 の実体を消し、生きている写真のサムネや原本が消える。
    // 本番テーブルの射影はこの環境から確認できない（AWS の資格情報が無い）
    // ので、**確認しなくても正しく動く形**にした: 索引からは id だけ採り、
    // 中身は本体から読み直す。
    it("索引の中身を使わず、本体から読み直す", async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [{ id: "p1" }, { id: "p2" }], LastEvaluatedKey: undefined })
            .mockResolvedValueOnce({ Responses: { "photos-test": [
                { id: "p1", src: "s1", key: "uploads/me/a.jpg" },
                { id: "p2", src: "s2", key: "uploads/me/b.jpg" },
            ] } });
        const { listMyMediaItems } = await import("../ddb-photos");
        const out = await listMyMediaItems("me");

        const batch = mockSend.mock.calls.at(-1)![0];
        expect(batch.constructor.name, "本体から読み直していない").toBe("BatchGetCommand");
        expect((batch.input as { RequestItems: Record<string, { Keys: unknown[] }> })
            .RequestItems["photos-test"].Keys).toEqual([{ id: "p1" }, { id: "p2" }]);
        // 索引が返した薄い項目ではなく、読み直した中身が返る
        expect(out.map((p) => (p as unknown as { key?: string }).key))
            .toEqual(["uploads/me/a.jpg", "uploads/me/b.jpg"]);
    });

    it("未処理分は拾い直す（BatchGetItem は取りこぼす）", async () => {
        mockSend
            .mockResolvedValueOnce({ Items: [{ id: "p1" }, { id: "p2" }], LastEvaluatedKey: undefined })
            .mockResolvedValueOnce({
                Responses: { "photos-test": [{ id: "p1", src: "s1" }] },
                UnprocessedKeys: { "photos-test": { Keys: [{ id: "p2" }] } },
            })
            .mockResolvedValueOnce({ Responses: { "photos-test": [{ id: "p2", src: "s2" }] } });
        const { listMyMediaItems } = await import("../ddb-photos");
        const out = await listMyMediaItems("me");
        expect(out.map((p) => p.id), "取りこぼした分を捨てている（使用中の判定が漏れる）")
            .toEqual(["p1", "p2"]);
    });

    it("1件も無ければ読み直しに行かない", async () => {
        mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
        const { listMyMediaItems } = await import("../ddb-photos");
        expect(await listMyMediaItems("me")).toEqual([]);
        expect(mockSend).toHaveBeenCalledTimes(1);
    });
});

// フォローの実在判定に使う。どこに何を聞いているかを関数の直下で固定する
// （follow.test.ts のモックは QueryCommand なら何でも返すので、索引名や
// キー条件を壊しても気づけなかった——レビューが変異で実測）。
describe("hasAnyUserItem", () => {
    const lastInput = () => (mockSend.mock.calls.at(-1)![0] as { input: Record<string, unknown> }).input;

    it("GSI に userId で聞く（Limit 1・件数だけ）", async () => {
        mockSend.mockResolvedValue({ Count: 1 });
        expect(await hasAnyUserItem("u1")).toBe(true);
        const input = lastInput();
        expect(input.TableName).toBe("photos-test");
        expect(input.IndexName).toBe("userId-createdAt-index");
        expect(input.KeyConditionExpression).toBe("userId = :uid");
        expect((input.ExpressionAttributeValues as Record<string, unknown>)[":uid"]).toBe("u1");
        expect(input.Limit).toBe(1);
        expect(input.Select).toBe("COUNT");
    });

    it("1件も無ければ false", async () => {
        mockSend.mockResolvedValue({ Count: 0 });
        expect(await hasAnyUserItem("u1")).toBe(false);
    });

    // **countUserPhotos との意図的な差。** あちらはストーリーを外すが、
    // こちらは「実在の証拠」を探しているだけなので絞り込みを付けない。
    // 付けるなら Limit を外すこと（Limit はフィルタ適用前に効く）。
    it("絞り込みを付けない（ストーリーや下書きでも実在とみなす）", async () => {
        mockSend.mockResolvedValue({ Count: 1 });
        await hasAnyUserItem("u1");
        expect(lastInput().FilterExpression).toBeUndefined();
    });
});

// 保存の再送を見分けるために足した2本。
// このテーブルには通知（notifs#…）やコメント（comments#…）も同居しているので、
// 読み側は `#` を弾く（api/src/photos.ts・photoUpdate.ts と同じ規約）。
describe("getPhotoById", () => {
    it("`#` を含むIDは引きに行かない（写真以外の文書に触らせない）", async () => {
        expect(await getPhotoById("notifs#someone")).toBeUndefined();
        expect(await getPhotoById("comments#p1")).toBeUndefined();
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("空のIDも引きに行かない", async () => {
        expect(await getPhotoById("")).toBeUndefined();
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("普通のIDは引く", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "p1", src: "https://cdn/p1.jpg" } });
        expect((await getPhotoById("p1"))?.id).toBe("p1");
        expect((mockSend.mock.calls[0][0].input as { TableName?: string }).TableName).toBe("photos-test");
    });
});

// 再送で「この回の意図」を書き直す。**自分の行を、誰も触っていないときだけ。**
// 条件が緩むと、/user/edit で後から直した内容を、開きっぱなしの
// アップロードタブが巻き戻す。
describe("overwriteOwnPhoto", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photo = { id: "p1", src: "https://cdn/p1.jpg", userId: "u1" } as any;

    it("自分の行・同じ画像・触られていないこと、を全部条件にする", async () => {
        expect(await overwriteOwnPhoto(photo, "2026-01-01T00:00:00.000Z")).toBe(true);
        const input = mockSend.mock.calls[0][0].input as {
            ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown>;
        };
        expect(input.ConditionExpression).toBe(
            "attribute_exists(id) AND src = :src AND updatedAt = :ua AND (userId = :u OR uploadedBy = :u)");
        expect(input.ExpressionAttributeValues).toEqual({
            ":src": "https://cdn/p1.jpg", ":ua": "2026-01-01T00:00:00.000Z", ":u": "u1",
        });
    });

    it("条件で弾かれたら false（投げない）", async () => {
        mockSend.mockRejectedValueOnce(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
        expect(await overwriteOwnPhoto(photo, "x")).toBe(false);
    });

    it("それ以外の失敗は投げる（黙って成功にしない）", async () => {
        mockSend.mockRejectedValueOnce(new Error("ddb down"));
        await expect(overwriteOwnPhoto(photo, "x")).rejects.toThrow("ddb down");
    });
});
