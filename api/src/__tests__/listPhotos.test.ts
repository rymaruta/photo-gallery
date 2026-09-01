import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend } }));
vi.stubEnv("PHOTOS_TABLE", "photos-test");
const { listPhotos, listPhotosByUser } = await import("../ddb-photos");

// **中括弧で囲う。** 式のままだと**モック自身を返す**——vitest は
// フックの戻り値が関数だと後片付けとして扱うので、各テストのあとに
// そのモックが**引数なしで呼ばれる**。実装が `mockResolvedValue` の
// うちは無害だが、引数を見るモックに変えた瞬間に落ちる。
beforeEach(() => { mockDdbSend.mockReset().mockResolvedValue({ Items: [] }); });

const inputOf = (i = 0) => (mockDdbSend.mock.calls[i][0] as { input: Record<string, string> }).input;

// このテーブルには写真だけでなく、いいね/フォローのマーカー、コメント文書、
// 通知文書、ストーリー、そして再ビルドの排他ロックまで同居している。
// 公開一覧に出てよいのは「公開されている写真」だけ。
describe("公開一覧の絞り込み", () => {
    it("写真以外・非公開・ストーリーを除く", async () => {
        await listPhotos();
        const f = inputOf().FilterExpression;
        expect(f).toContain("attribute_exists(src)");        // 写真であること
        expect(f).toContain("published = :pub");             // 公開されていること
        expect(f).toContain("attribute_not_exists(story)");  // ストーリーでないこと
    });

    it("特定の人の一覧も同じ条件で絞る", async () => {
        // ここが緩いと、プロフィールにだけストーリーが混ざる
        await listPhotosByUser("u1");
        const f = inputOf().FilterExpression;
        expect(f).toContain("attribute_exists(src)");
        expect(f).toContain("published = :pub");
        expect(f).toContain("attribute_not_exists(story)");
    });
});
