import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

// テーブル名は ddb-photos.ts が requireEnv("PHOTOS_TABLE") で env から読む
// （下の stubEnv が効く）。以前ここに `TABLE: "photos-test"` という
// **存在しない export** を混ぜていて、モックで差し替わっているように読めた。
vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
}));

vi.stubEnv("PHOTOS_TABLE", "photos-test");
const { deletePhotoById } = await import("../ddb-photos");

/** 送られた DeleteCommand の Key.id を順に集める */
function deletedIds(): string[] {
    return mockDdbSend.mock.calls
        .map((c) => (c[0] as { input?: { Key?: { id?: string } } }).input?.Key?.id)
        .filter((v): v is string => typeof v === "string");
}

// **中括弧で囲う。** 式のままだと**モック自身を返す**——vitest は
// フックの戻り値が関数だと後片付けとして扱うので、各テストのあとに
// そのモックが**引数なしで呼ばれる**。実装が `mockResolvedValue` の
// うちは無害だが、引数を見るモックに変えた瞬間に落ちる。
beforeEach(() => { mockDdbSend.mockReset().mockResolvedValue({}); });

// 写真を消してもコメントは別文書（comments#<写真ID>）に残っていた。
// 一覧APIは公開で写真の存在確認もしないので、
// **写真を消したあともコメント本文・投稿者名・投稿者IDが誰でも読めた**。
// 「不適切なコメントが付いたので写真を消してほしい」に応えられていない。
describe("deletePhotoById", () => {
    it("写真本体とコメント文書の両方を消す", async () => {
        await deletePhotoById("p1");
        expect(deletedIds()).toEqual(["p1", "comments#p1"]);
    });

    it("コメント文書の削除に失敗しても写真の削除は成立させる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error("boom"));
        await expect(deletePhotoById("p1")).resolves.toBeUndefined();
    });
});
