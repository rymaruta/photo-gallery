import { describe, it, expect } from "vitest";
import { audienceForPatch, audienceForSave, audienceRank, readAudience } from "../audience";

// 公開範囲（iOS の Audience.swift と同じ三択・同じ送り方）
describe("公開範囲", () => {
    it("知らない値は全体に公開として読む（サーバーの sanitizeAudience と同じ倒し方）", () => {
        expect(readAudience("followers")).toBe("followers");
        expect(readAudience("closeFriends")).toBe("closeFriends");
        expect(readAudience(undefined)).toBe("everyone");
        expect(readAudience("friends")).toBe("everyone");
    });

    it("新規投稿では全体に公開を送らない（属性を書かない形に揃える）", () => {
        expect(audienceForSave("everyone")).toEqual({});
        expect(audienceForSave("followers")).toEqual({ audience: "followers" });
    });

    /** キーごと消すとサーバーは既にある印を残す＝絞りを外せない（iOS の patchValue） */
    it("更新では全体に公開を空文字で送る", () => {
        expect(audienceForPatch("everyone")).toEqual({ audience: "" });
        expect(audienceForPatch("closeFriends")).toEqual({ audience: "closeFriends" });
    });

    /** 控えを戻すときに、より広い値で上書きしないための順序 */
    it("狭さの順序: 全体 < フォロワー < 親しい友達", () => {
        expect(audienceRank("everyone")).toBeLessThan(audienceRank("followers"));
        expect(audienceRank("followers")).toBeLessThan(audienceRank("closeFriends"));
    });
});
