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

const { putPhoto, countUserPhotos } = await import("../ddb-photos");

beforeEach(() => mockSend.mockReset().mockResolvedValue({}));

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

        const query = mockSend.mock.calls.at(-1)![0];
        expect(query.input.FilterExpression).toBe("attribute_exists(src)");
        expect(query.input.FilterExpression).not.toContain("story");
    });
});
