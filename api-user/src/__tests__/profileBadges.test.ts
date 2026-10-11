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
        expect(badgeDisplayNameJa("first", 1)).toBe("最初の一枚");
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

describe("Pro・サポーター（第2段階）: 出してよいのは番号・申し込んだ日・月数だけ", () => {
    const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const SUPPORTER = {
        number: 42, since: "2026-10-10T03:00:00.000Z", months: 13, active: true,
        productId: "com.journeyphoto.JourneyPhoto.pro.yearly", originalTransactionId: "2000000099999999",
        expiresAt: FUTURE, environment: "Production", autoRenew: true, lastEventAt: "2026-10-10T03:00:00.000Z",
        periods: [{ id: "2000000099999999", start: "2026-10-10T03:00:00.000Z", end: FUTURE, product: "com.journeyphoto.JourneyPhoto.pro.yearly" }],
        linked: ["2000000099999999"],
    };
    const PRIVATE = ["2000000099999999", "productId", "originalTransactionId", "expiresAt", "periods", "linked", "environment", "autoRenew", "lastEventAt", "pro.yearly"];

    it("公開プロフィール", async () => {
        mockSend.mockResolvedValueOnce(stored({ supporter: SUPPORTER }));
        const res = await getPublic("u1");
        const body = JSON.parse(res.body);
        expect(body.pro).toBe(true);
        expect(body.supporter).toEqual({ number: 42, since: "2026-10-10T03:00:00.000Z", months: 13 });
        for (const word of PRIVATE) expect(res.body, word).not.toContain(word);
    });

    it("自分のプロフィールでも同じ3項目だけ（取引の番号は本人にも返さない）", async () => {
        mockSend.mockResolvedValueOnce(stored({ supporter: SUPPORTER }));
        const res = await getMine();
        const body = JSON.parse(res.body);
        expect(body.pro).toBe(true);
        expect(body.supporter).toEqual({ number: 42, since: "2026-10-10T03:00:00.000Z", months: 13 });
        for (const word of PRIVATE) expect(res.body, word).not.toContain(word);
    });

    it("期限を過ぎていれば active のままでも Pro の印は出さない（番号は出す）", async () => {
        mockSend.mockResolvedValueOnce(stored({ supporter: { ...SUPPORTER, expiresAt: "2026-01-01T00:00:00.000Z" } }));
        const body = JSON.parse((await getPublic("u1")).body);
        expect(body.pro).toBe(false);
        expect(body.supporter.number).toBe(42);
    });

    it("更新: 季節の章を名前の横に選べる（持っているときだけ）。保存済みの supporter は残る", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ badges: { proAutumn2026: { tier: 1, at: AT, year: 2026 } }, supporter: SUPPORTER }))
            .mockResolvedValueOnce({});
        const res = await update({ displayBadge: "proAutumn2026", supporter: { number: 1 } });
        expect(res.statusCode).toBe(200);
        expect(savedProfile().displayBadge).toBe("proAutumn2026");
        expect(savedProfile().supporter).toEqual(SUPPORTER);
        const body = JSON.parse(res.body);
        expect(body.displayBadge).toBe("proAutumn2026");
        expect(body.supporter).toEqual({ number: 42, since: "2026-10-10T03:00:00.000Z", months: 13 });
        expect(res.body).not.toContain("2000000099999999");

        commands.length = 0;
        mockSend.mockReset();
        mockSend.mockResolvedValueOnce(stored({ badges: { proAutumn2026: { tier: 1, at: AT } } }));
        expect((await update({ displayBadge: "proWinter2026" })).statusCode).toBe(400);
        expect(commands.some((c) => c.type === "Put")).toBe(false);
    });

    it("更新: サポーター章・続けた年も選べる", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ badges: { supporter: { tier: 1, at: AT }, supporterYear: { tier: 2, at: AT } } }))
            .mockResolvedValueOnce({});
        expect((await update({ displayBadge: "supporterYear" })).statusCode).toBe(200);
        expect(savedProfile().displayBadge).toBe("supporterYear");
    });
});

describe("光と天気の知らせを受け取るか（lightAlert）", () => {
    it("既定は「受け取る」。本人の応答には常に真偽で載る・公開には出さない", async () => {
        mockSend.mockResolvedValueOnce(stored({}));
        expect(JSON.parse((await getMine()).body).lightAlert).toBe(true);
        mockSend.mockResolvedValueOnce(stored({ lightAlert: false }));
        expect(JSON.parse((await getMine()).body).lightAlert).toBe(false);
        expect(toPublicProfile({ userId: "u1", lightAlert: false } as never)).not.toHaveProperty("lightAlert");
    });

    it("false は置く・true は消す（既定に戻す）・真偽でなければ 400", async () => {
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValueOnce({});
        expect((await update({ lightAlert: false })).statusCode).toBe(200);
        expect(savedProfile().lightAlert).toBe(false);

        mockSend.mockReset();
        commands.length = 0;
        mockSend.mockResolvedValueOnce(stored({ lightAlert: false })).mockResolvedValueOnce({});
        const res = await update({ lightAlert: true });
        expect(res.statusCode).toBe(200);
        expect(savedProfile()).not.toHaveProperty("lightAlert");
        expect(JSON.parse(res.body).lightAlert).toBe(true);

        commands.length = 0;
        // 文字の "false" を「受け取る」に倒すと、止めたつもりの人に届き続ける
        expect((await update({ lightAlert: "false" })).statusCode).toBe(400);
        expect(commands).toEqual([]);
    });

    it("触らない更新では保存済みの設定を消さない", async () => {
        mockSend.mockResolvedValueOnce(stored({ lightAlert: false })).mockResolvedValueOnce({});
        expect((await update({ bio: "x" })).statusCode).toBe(200);
        expect(savedProfile().lightAlert).toBe(false);
    });
});

// 名前の横の印の取り外し（2026-10-10 owner「メダルと同様に取り外しできるように」）。
// 外しても資格（Pro・認証済み）は残り、付け直せる。**他の人には出さない**——古いアプリ・Web は
// "none" / `verifiedMarkOff` を知らないので、公開の形では資格の項目ごと落とす
describe("名前の横の印を外す", () => {
    const PRO = { supporter: { active: true, until: "2099-01-01" } };

    it("Pro の印: proMarkStyle に none を受けて保存する（本人の応答は pro のまま・none）", async () => {
        mockSend.mockResolvedValueOnce(stored(PRO)).mockResolvedValueOnce({});
        const res = await update({ proMarkStyle: "none" });
        expect(res.statusCode).toBe(200);
        expect(savedProfile().proMarkStyle).toBe("none");
        const body = JSON.parse(res.body);
        expect(body.pro).toBe(true);
        expect(body.proMarkStyle).toBe("none");
        expect(badgeFields({ proMarkStyle: "none" }).proMarkStyle).toBe("none");
    });

    it("Pro の印: 公開プロフィールでは pro: false・proMarkStyle: iris（古い版にも出ない）", async () => {
        mockSend.mockResolvedValueOnce(stored({ ...PRO, proMarkStyle: "none" }));
        const body = JSON.parse((await getPublic("u1")).body);
        expect(body.pro).toBe(false);
        expect(body.proMarkStyle).toBe("iris");
        // 付けている人はそのまま
        mockSend.mockResolvedValueOnce(stored({ ...PRO, proMarkStyle: "plate" }));
        const on = JSON.parse((await getPublic("u1")).body);
        expect(on.pro).toBe(true);
        expect(on.proMarkStyle).toBe("plate");
    });

    it("Pro の印: 形を選び直せば付け直せる（資格は触っていない）", async () => {
        mockSend.mockResolvedValueOnce(stored({ ...PRO, proMarkStyle: "none" })).mockResolvedValueOnce({});
        const res = await update({ proMarkStyle: "iris" });
        expect(res.statusCode).toBe(200);
        expect(savedProfile().proMarkStyle).toBe("iris");
        expect(savedProfile().supporter).toEqual(PRO.supporter);
    });

    it("本人に返す形（owner: true・購入の応答）は外していても資格どおり", () => {
        const row = { userId: "u1", ...PRO, proMarkStyle: "none", verified: true, verifiedMarkOff: true } as never;
        const own = toPublicProfile(row, { owner: true });
        expect(own.pro).toBe(true);
        expect(own.verified).toBe(true);
        const pub = toPublicProfile(row);
        expect(pub.pro).toBe(false);
        expect(pub.verified).toBeUndefined();
    });

    it("公式の印: verifiedMarkOff は真偽だけ受ける。true を置き、false で消す（付け直す）", async () => {
        mockSend.mockResolvedValueOnce(stored({ verified: true })).mockResolvedValueOnce({});
        const res = await update({ verifiedMarkOff: true });
        expect(res.statusCode).toBe(200);
        expect(savedProfile().verifiedMarkOff).toBe(true);
        // 資格は残る
        expect(savedProfile().verified).toBe(true);
        const body = JSON.parse(res.body);
        expect(body.verified).toBe(true);
        expect(body.verifiedMarkOff).toBe(true);

        mockSend.mockReset();
        commands.length = 0;
        mockSend.mockResolvedValueOnce(stored({ verified: true, verifiedMarkOff: true })).mockResolvedValueOnce({});
        const back = await update({ verifiedMarkOff: false });
        expect(back.statusCode).toBe(200);
        expect(savedProfile()).not.toHaveProperty("verifiedMarkOff");
        expect(savedProfile().verified).toBe(true);
        expect(JSON.parse(back.body).verifiedMarkOff).toBe(false);

        commands.length = 0;
        expect((await update({ verifiedMarkOff: "true" })).statusCode).toBe(400);
        expect(commands).toEqual([]);
    });

    it("公式の印: 公開プロフィールでは verified を出さない。verifiedMarkOff 自体も出さない", async () => {
        mockSend.mockResolvedValueOnce(stored({ verified: true, verifiedMarkOff: true }));
        const body = JSON.parse((await getPublic("u1")).body);
        expect(body).not.toHaveProperty("verified");
        expect(body).not.toHaveProperty("verifiedMarkOff");
    });

    it("公式の印: 外す項目を送っても資格は自分に付かない（verified の無い人）", async () => {
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValueOnce({});
        const res = await update({ verifiedMarkOff: false, verified: true });
        expect(res.statusCode).toBe(200);
        expect(savedProfile()).not.toHaveProperty("verified");
    });

    it("自分のプロフィールには verifiedMarkOff が常に真偽で載る（既定は false）", async () => {
        mockSend.mockResolvedValueOnce(stored({ verified: true }));
        const body = JSON.parse((await getMine()).body);
        expect(body.verifiedMarkOff).toBe(false);
        expect(body.verified).toBe(true);
    });
});
