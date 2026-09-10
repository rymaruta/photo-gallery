import { describe, it, expect } from "vitest";
import {
    newInviteToken, isValidInviteToken, inviteState, inviteRejection,
    inviteKey, albumKey, albumMemberKey, inviteExpiryFrom, INVITE_TTL_MS,
} from "../invite";

// 共同アルバムの招待。**このトークンだけが「他人の旅を読めない」ことの根拠**で、
// 当たれば中の写真も参加者の名前も見える。だから
//   - 推測できないこと（長さ・乱雑さ）
//   - 期限と取り消しを**必ずコード側で見る**こと（このテーブルに TTL は無い）
//   - 理由を握り潰さないこと（切れた／取り消された／無い を分ける）
// をここで固定する。

describe("トークンの作り", () => {
    it("URL に直接載せられる文字だけ（base64url）", () => {
        for (let i = 0; i < 50; i++) expect(newInviteToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    // **短くしてはいけない。** 24バイト = 192ビット → base64url で32文字
    it("192ビット以上ある", () => {
        expect(newInviteToken().length).toBeGreaterThanOrEqual(32);
    });

    it("毎回違う", () => {
        const seen = new Set(Array.from({ length: 200 }, () => newInviteToken()));
        expect(seen.size, "同じトークンが出ている").toBe(200);
    });

    it("作ったトークンは自分の判定を通る", () => {
        for (let i = 0; i < 20; i++) expect(isValidInviteToken(newInviteToken())).toBe(true);
    });
});

describe("受け付けてよい形か（DynamoDB に投げる前に見る）", () => {
    it.each([
        ["短すぎる", "abc"],
        ["長すぎる", "a".repeat(65)],
        ["base64 の + と /", "a".repeat(30) + "+/"],
        ["= 埋め", "a".repeat(30) + "=="],
        ["空", ""],
        ["空白入り", "a".repeat(16) + " " + "b".repeat(16)],
    ])("%s は断る", (_name, v) => {
        expect(isValidInviteToken(v)).toBe(false);
    });

    it.each([undefined, null, 12345, {}, []])("文字列でないものは断る（%s）", (v) => {
        expect(isValidInviteToken(v)).toBe(false);
    });
});

describe("招待が使えるか", () => {
    const now = Date.parse("2026-09-09T00:00:00.000Z");
    const live = { id: "invite#t", albumId: "a1", expiresAt: new Date(now + 1000).toISOString() };

    it("期限内なら使える", () => {
        expect(inviteState(live, now)).toBe("ok");
    });

    it("期限を過ぎたら expired", () => {
        expect(inviteState({ ...live, expiresAt: new Date(now - 1).toISOString() }, now)).toBe("expired");
    });

    // 境界: ちょうど期限の瞬間は切れている（`>` で見る）
    it("ちょうど期限の瞬間は切れている", () => {
        expect(inviteState({ ...live, expiresAt: new Date(now).toISOString() }, now)).toBe("expired");
    });

    it("行が無ければ notfound", () => {
        expect(inviteState(null, now)).toBe("notfound");
        expect(inviteState(undefined, now)).toBe("notfound");
    });

    // **取り消しは期限より先に見る。** 期限切れの招待をあとから取り消した
    // 場合でも「取り消された」と伝えたい（発行者の意図がそちらだから）
    it("取り消しは期限より先に見る", () => {
        const old = { ...live, expiresAt: new Date(now - 1).toISOString(), revoked: true };
        expect(inviteState(old, now)).toBe("revoked");
    });

    // **`ok` に倒さない。** 読めないものを通すと、行き先の無い招待で
    // アルバムを引きに行くことになる
    it.each([
        ["albumId が無い", { id: "invite#t", expiresAt: new Date(now + 1000).toISOString() }],
        ["albumId が文字列でない", { id: "invite#t", albumId: 1 as unknown as string, expiresAt: new Date(now + 1000).toISOString() }],
        ["期限が読めない", { id: "invite#t", albumId: "a1", expiresAt: "きのう" }],
        ["期限が無い", { id: "invite#t", albumId: "a1" }],
    ])("中身が壊れていたら broken（%s）", (_n, item) => {
        expect(inviteState(item, now)).toBe("broken");
    });

    // `revoked` は真偽値で見る（"false" のような文字列を取り消しと読まない）
    it("revoked が false なら取り消しではない", () => {
        expect(inviteState({ ...live, revoked: false }, now)).toBe("ok");
    });
});

describe("断るときの返し方", () => {
    it("期限切れと取り消しは 410（もう使えないと分かる）", () => {
        expect(inviteRejection("expired").statusCode).toBe(410);
        expect(inviteRejection("revoked").statusCode).toBe(410);
    });

    // **「壊れている」を外に見せない。** どのトークンが実在するかを教えない
    it("無いものと壊れたものは同じ 404 に潰す", () => {
        expect(inviteRejection("notfound")).toEqual(inviteRejection("broken"));
        expect(inviteRejection("notfound").statusCode).toBe(404);
    });

    it("理由が文言に出る（画面がそのまま出せる）", () => {
        expect(inviteRejection("expired").error).toContain("期限");
        expect(inviteRejection("revoked").error).toContain("取り消");
    });
});

describe("キーの形", () => {
    it("既存の <種類># の慣習に沿う", () => {
        expect(inviteKey("tok")).toBe("invite#tok");
        expect(albumKey("a1")).toBe("album#a1");
        expect(albumMemberKey("a1", "u1")).toBe("albummember#a1#u1");
    });

    // 参加の有無を GetItem 1回で引けること（Query の権限が無い経路のため）
    it("参加の印は アルバム＋利用者 で一意に決まる", () => {
        expect(albumMemberKey("a1", "u1")).not.toBe(albumMemberKey("a1", "u2"));
        expect(albumMemberKey("a1", "u1")).not.toBe(albumMemberKey("a2", "u1"));
    });
});

describe("期限の計算", () => {
    it("30日後になる", () => {
        const now = Date.parse("2026-09-09T00:00:00.000Z");
        expect(Date.parse(inviteExpiryFrom(now)) - now).toBe(INVITE_TTL_MS);
        expect(INVITE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("作った招待は、作った直後は使える", () => {
        const now = Date.now();
        expect(inviteState({ id: "i", albumId: "a1", expiresAt: inviteExpiryFrom(now) }, now)).toBe("ok");
    });
});
