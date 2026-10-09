import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
// vi.mock は巻き上げられるので、静的な import でもモックが先に効く
import { updateMyProfile, getMyProfile, getPublicProfile, toPublicProfile } from "../userProfile";
import { badgeFields, sanitizeBadges, ownsBadge, isPro, badgeDisplayNameJa } from "../badgeKeys";

// プロフィールのメダルと Pro の4項目（`badges`・`displayBadge`・`pro`・`proMarkStyle`）。
//
// - 公開プロフィール・自分のプロフィール・更新の応答が**同じ形**を返す
// - `displayBadge` は**持っている鍵だけ**選べる（持っていない・知らない鍵は 400）
// - `badges` と `supporter` は本人から書けない（`verified` と同じ）

const mockSend = vi.hoisted(() => vi.fn());
const commands = vi.hoisted(() => [] as { type: string; input: Record<string, unknown> }[]);
vi.mock("@aws-sdk/client-dynamodb", () => {
    const make = (type: string) => class {
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) { this.input = input; commands.push({ type, input }); }
    };
    return {
        DynamoDBClient: class { send = (cmd: unknown) => mockSend(cmd); },
        GetItemCommand: make("Get"),
        PutItemCommand: make("Put"),
        DeleteItemCommand: make("Delete"),
    };
});


type Result = { statusCode: number; body: string };
const event = (body?: unknown) => ({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: body === undefined ? undefined : JSON.stringify(body),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const update = (body: unknown): Promise<Result> => (updateMyProfile as any)(event(body));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getMine = (): Promise<Result> => (getMyProfile as any)(event());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPublic = (userId: string): Promise<Result> => (getPublicProfile as any)({ pathParameters: { userId } });

const AT = "2026-10-01T00:00:00.000Z";
const stored = (over: Record<string, unknown>) =>
    ({ Item: marshall({ userId: "u1", displayName: "旅人", ...over }, { removeUndefinedValues: true }) });

function savedProfile(): Record<string, unknown> {
    const puts = commands.filter((c) => c.type === "Put");
    if (puts.length === 0) throw new Error("プロフィールが書かれていない");
    return unmarshall(puts[puts.length - 1].input.Item as Parameters<typeof unmarshall>[0]);
}

beforeEach(() => {
    commands.length = 0;
    mockSend.mockReset();
});

describe("badgeFields / sanitizeBadges（形）", () => {
    it("知らない鍵・段の外・日付の無いものは落とす", () => {
        expect(sanitizeBadges({
            first: { tier: 1, at: AT },
            morning: { tier: 4, at: AT },           // 段の外
            night: { tier: 2 },                     // 日付が無い
            bogus: { tier: 1, at: AT },             // 知らない鍵
            first2: "x",
            earlyUser: { tier: 1, at: AT },
            seasons: { tier: 1.5, at: AT },         // 整数でない
        })).toEqual({ first: { tier: 1, at: AT }, earlyUser: { tier: 1, at: AT } });
    });

    it("1つも残らなければ undefined（項目ごと出さない）", () => {
        expect(sanitizeBadges({})).toBeUndefined();
        expect(sanitizeBadges(null)).toBeUndefined();
        expect(sanitizeBadges([{ tier: 1 }])).toBeUndefined();
        expect(badgeFields({})).toEqual({ displayBadge: null, pro: false, proMarkStyle: "iris" });
    });

    it("first と earlyUser は1段だけ（2段目は落とす）", () => {
        expect(sanitizeBadges({ first: { tier: 2, at: AT }, earlyUser: { tier: 2, at: AT } })).toBeUndefined();
    });

    it("displayBadge は持っている鍵のときだけ出る", () => {
        const badges = { morning: { tier: 2, at: AT } };
        expect(badgeFields({ badges, displayBadge: "morning" }).displayBadge).toBe("morning");
        expect(badgeFields({ badges, displayBadge: "night" }).displayBadge).toBeNull();
        expect(badgeFields({ badges, displayBadge: "bogus" }).displayBadge).toBeNull();
        expect(ownsBadge(badges, "morning")).toBe(true);
        expect(ownsBadge(badges, "night")).toBe(false);
    });

    it("pro は supporter.active === true のときだけ", () => {
        expect(isPro({ supporter: { active: true } })).toBe(true);
        expect(isPro({ supporter: { active: "true" } })).toBe(false);
        expect(isPro({ supporter: true })).toBe(false);
        expect(isPro({})).toBe(false);
        expect(isPro(null)).toBe(false);
    });

    it("proMarkStyle は iris / plate だけ（他は既定の iris）", () => {
        expect(badgeFields({ proMarkStyle: "plate" }).proMarkStyle).toBe("plate");
        expect(badgeFields({ proMarkStyle: "gold" }).proMarkStyle).toBe("iris");
    });

    it("通知の名前は段つき（1段だけのメダルは段を書かない）", () => {
        expect(badgeDisplayNameJa("morning", 2)).toBe("朝の光（銀）");
        expect(badgeDisplayNameJa("prefectures", 3)).toBe("都道府県（白金）");
        expect(badgeDisplayNameJa("first", 1)).toBe("はじめての一枚");
        expect(badgeDisplayNameJa("earlyUser", 1)).toBe("初期ユーザー");
    });
});

describe("公開プロフィール", () => {
    it("4項目を出し、supporter そのものは出さない", async () => {
        mockSend.mockResolvedValueOnce(stored({
            badges: { first: { tier: 1, at: AT }, wish: { tier: 3, at: AT } },
            displayBadge: "wish",
            supporter: { active: true, until: "2027-01-01" },
            proMarkStyle: "plate",
        }));
        const res = await getPublic("u1");
        const body = JSON.parse(res.body);
        expect(res.statusCode).toBe(200);
        expect(body.badges).toEqual({ first: { tier: 1, at: AT }, wish: { tier: 3, at: AT } });
        expect(body.displayBadge).toBe("wish");
        expect(body.pro).toBe(true);
        expect(body.proMarkStyle).toBe("plate");
        expect(body).not.toHaveProperty("supporter");
    });

    it("メダルが無い人は badges を出さず、pro は false・proMarkStyle は iris", () => {
        const pub = toPublicProfile({ userId: "u1" });
        expect(pub).not.toHaveProperty("badges");
        expect(pub.displayBadge).toBeNull();
        expect(pub.pro).toBe(false);
        expect(pub.proMarkStyle).toBe("iris");
    });
});

describe("自分のプロフィール（GET）", () => {
    it("同じ4項目を整えて返す（持っていない displayBadge は null）", async () => {
        mockSend.mockResolvedValueOnce(stored({
            badges: { first: { tier: 1, at: AT }, bogus: { tier: 1, at: AT } },
            displayBadge: "night",
        }));
        const body = JSON.parse((await getMine()).body);
        expect(body.badges).toEqual({ first: { tier: 1, at: AT } });
        expect(body.displayBadge).toBeNull();
        expect(body.pro).toBe(false);
        expect(body.proMarkStyle).toBe("iris");
    });
});

describe("更新（PUT /user/profile）", () => {
    it("持っているメダルを displayBadge に選べる", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ badges: { morning: { tier: 1, at: AT } } }))
            .mockResolvedValueOnce({});
        const res = await update({ displayBadge: "morning" });
        expect(res.statusCode).toBe(200);
        expect(savedProfile().displayBadge).toBe("morning");
        expect(JSON.parse(res.body).displayBadge).toBe("morning");
    });

    it("持っていないメダルは 400（書かない）", async () => {
        mockSend.mockResolvedValueOnce(stored({ badges: { morning: { tier: 1, at: AT } } }));
        const res = await update({ displayBadge: "night" });
        expect(res.statusCode).toBe(400);
        expect(commands.some((c) => c.type === "Put")).toBe(false);
    });

    it("知らない鍵・文字列でない値は 400（行を読む前に断る）", async () => {
        for (const v of ["bogus", 1, { key: "first" }, true]) {
            commands.length = 0;
            const res = await update({ displayBadge: v });
            expect(res.statusCode, String(v)).toBe(400);
            expect(commands).toEqual([]);
        }
    });

    it("null / 空文字で外せる", async () => {
        for (const v of [null, ""]) {
            commands.length = 0;
            mockSend.mockReset();
            mockSend
                .mockResolvedValueOnce(stored({ badges: { first: { tier: 1, at: AT } }, displayBadge: "first" }))
                .mockResolvedValueOnce({});
            const res = await update({ displayBadge: v });
            expect(res.statusCode).toBe(200);
            expect(savedProfile()).not.toHaveProperty("displayBadge");
        }
    });

    it("displayBadge を送らない更新は、選んだメダルに触らない", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ badges: { first: { tier: 1, at: AT } }, displayBadge: "first" }))
            .mockResolvedValueOnce({});
        const res = await update({ bio: "こんにちは" });
        expect(res.statusCode).toBe(200);
        expect(savedProfile().displayBadge).toBe("first");
        expect(savedProfile().badges).toEqual({ first: { tier: 1, at: AT } });
    });

    it("競合で読み直した行でメダルを確かめる（読み直したら持っていなかった → 400）", async () => {
        const cond = Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        mockSend
            .mockResolvedValueOnce(stored({ badges: { first: { tier: 1, at: AT } }, rev: 3 }))
            .mockRejectedValueOnce(cond)
            .mockResolvedValueOnce(stored({ rev: 4 }));
        const res = await update({ displayBadge: "first" });
        expect(res.statusCode).toBe(400);
    });

    it("proMarkStyle は iris / plate だけ受ける。null で既定に戻す", async () => {
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValueOnce({});
        expect((await update({ proMarkStyle: "plate" })).statusCode).toBe(200);
        expect(savedProfile().proMarkStyle).toBe("plate");

        commands.length = 0;
        expect((await update({ proMarkStyle: "gold" })).statusCode).toBe(400);
        expect(commands).toEqual([]);

        mockSend.mockReset();
        mockSend.mockResolvedValueOnce(stored({ proMarkStyle: "plate" })).mockResolvedValueOnce({});
        const res = await update({ proMarkStyle: null });
        expect(res.statusCode).toBe(200);
        expect(savedProfile()).not.toHaveProperty("proMarkStyle");
        expect(JSON.parse(res.body).proMarkStyle).toBe("iris");
    });

    it("badges・supporter・pro は本人から書けない（送っても無視・保存済みは残る）", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ badges: { first: { tier: 1, at: AT } } }))
            .mockResolvedValueOnce({});
        const res = await update({
            bio: "x",
            badges: { prefectures: { tier: 3, at: AT } },
            supporter: { active: true },
            pro: true,
            verified: true,
        });
        expect(res.statusCode).toBe(200);
        const saved = savedProfile();
        expect(saved.badges).toEqual({ first: { tier: 1, at: AT } });
        expect(saved).not.toHaveProperty("supporter");
        expect(saved).not.toHaveProperty("pro");
        expect(saved).not.toHaveProperty("verified");
        expect(JSON.parse(res.body).pro).toBe(false);
    });
});
