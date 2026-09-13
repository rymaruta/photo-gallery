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
// 「不適切なコメントが付いたので写真を消してほしい」に応えられていない。
//
// **順序と倒し方を変えた（2026-09-13）。** もとは「行 → comments#」で、
// コメントの削除に失敗しても成功として返していた。理由は当時
// 「写真本体は消えているので全体は失敗にしない」。だが:
//
//   - `comments#` は `src` も `userId` も持たないので **GSI にも一覧にも
//     出ず**、退会の掃除（`userId` の GSI を回る）にも拾われない
//   - 行が先に消えると、押し直しても `getPhotoById` が 404 を返すので
//     **やり直す入口が消える**＝消えない個人データが永久に残る
//   - **利用者側の `deleteMyPhoto` と退会は、どちらも逆の順序**で、
//     理由まで書いてある（「comments# は行より先に消す（逆だと再実行で
//     拾う手がかりが無くなる）」）。**管理者の削除だけが逆**だった
//
// 当時の前提「一覧APIは公開で写真の存在確認もしない」も**もう事実でない**
// ——`api-user/src/comments.ts` の `getComments` は写真の実在・公開・
// ストーリーを見て 404 を返す。だから「読まれてしまう」ことは無く、
// 残るのは「消えないデータ」だけ。**消せるようにする方を採る。**
describe("deletePhotoById", () => {
    // 元のテストが守っていた性質（両方消える）はそのまま
    it("写真本体とコメント文書の両方を消す", async () => {
        await deletePhotoById("p1");
        expect(deletedIds()).toEqual(["comments#p1", "p1"]);
    });

    // **順序そのものを見る。** これが逆だと、失敗した回に手がかりが消える
    it("コメント文書を、写真の行より先に消す", async () => {
        await deletePhotoById("p1");
        expect(deletedIds()[0], "行を先に消している").toBe("comments#p1");
    });

    it("コメント文書を消せなければ投げる（写真の行を残す）", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        await expect(deletePhotoById("p1")).rejects.toThrow("boom");
        expect(deletedIds(), "行まで消している（押し直しても辿れなくなる）").toEqual(["comments#p1"]);
    });
});
