import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";
// vi.mock は巻き上げられるので、静的な import でもモックが先に効く
import { updateMyProfile, getMyProfile, getPublicProfile, toPublicProfile } from "../userProfile";
import { badgeFields, publicSupporter } from "../badgeKeys";

// 2026-10-10: 本番（Production と Sandbox を受ける）に来た TestFlight の購入でも、
// **本人の応答だけ**はサポーター番号を `sandbox: true` 付きで返す（iOS の設定の「サポーター証」の行）。
// 公開プロフィール・購入の応答は今までどおり Sandbox を出さない
// （`purchases.test.ts`・`supporter.test.ts` の「本番のサーバーに来た Sandbox」）。

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-dynamodb", () => {
    const make = () => class {
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) { this.input = input; }
    };
    return {
        DynamoDBClient: class { send = (cmd: unknown) => mockSend(cmd); },
        GetItemCommand: make(),
        PutItemCommand: make(),
        DeleteItemCommand: make(),
    };
});

type Result = { statusCode: number; body: string };
const event = (body?: unknown) => ({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: body === undefined ? undefined : JSON.stringify(body),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getMine = (): Promise<Result> => (getMyProfile as any)(event());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const update = (body: unknown): Promise<Result> => (updateMyProfile as any)(event(body));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPublic = (userId: string): Promise<Result> => (getPublicProfile as any)({ pathParameters: { userId } });

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const SINCE = "2026-10-10T03:00:00.000Z";
const supporterOf = (environment: "Production" | "Sandbox") => ({
    number: 1, since: SINCE, months: 2, active: true,
    productId: "com.journeyphoto.JourneyPhoto.pro.monthly", originalTransactionId: "2000000088888888",
    expiresAt: FUTURE, environment, autoRenew: true, lastEventAt: SINCE,
    periods: [{ id: "2000000088888888", start: SINCE, end: FUTURE, product: "com.journeyphoto.JourneyPhoto.pro.monthly" }],
    linked: ["2000000088888888"],
});
const stored = (over: Record<string, unknown>) =>
    ({ Item: marshall({ userId: "u1", displayName: "旅人", ...over }, { removeUndefinedValues: true }) });
/** 本人にも返さない取引の中身 */
const PRIVATE = ["2000000088888888", "productId", "originalTransactionId", "expiresAt", "periods", "linked", "environment", "autoRenew", "lastEventAt", "pro.monthly"];

beforeEach(() => {
    mockSend.mockReset();
    vi.stubEnv("APPSTORE_ENVIRONMENTS", "Production,Sandbox");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("本番に来た Sandbox のサポーター: 本人の応答だけに載せる", () => {
    it("自分のプロフィール（GET）に番号・申し込んだ日・月数と sandbox: true が載る（取引の中身は出さない）", async () => {
        mockSend.mockResolvedValueOnce(stored({ supporter: supporterOf("Sandbox") }));
        const res = await getMine();
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.pro).toBe(true);
        expect(body.supporter).toEqual({ number: 1, since: SINCE, months: 2, sandbox: true });
        for (const word of PRIVATE) expect(res.body, word).not.toContain(word);
    });

    it("更新（PUT）の応答にも同じ形で載る", async () => {
        mockSend
            .mockResolvedValueOnce(stored({ supporter: supporterOf("Sandbox") }))
            .mockResolvedValueOnce({});
        const res = await update({ bio: "よろしく" });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).supporter).toEqual({ number: 1, since: SINCE, months: 2, sandbox: true });
    });

    it("公開プロフィールには載らない（本物の No.1 と重なる）。Pro の印は出る", async () => {
        mockSend.mockResolvedValueOnce(stored({ supporter: supporterOf("Sandbox") }));
        const res = await getPublic("u1");
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.pro).toBe(true);
        expect(body).not.toHaveProperty("supporter");
        expect(res.body).not.toContain("sandbox");
        // 購入の応答（`purchases.ts`）が通す形も同じ
        expect(toPublicProfile({ userId: "u1", supporter: supporterOf("Sandbox") } as never)).not.toHaveProperty("supporter");
    });

    it("Production の記録は今までどおり（本人にも公開にも3項目だけ・sandbox は付かない）", async () => {
        mockSend.mockResolvedValueOnce(stored({ supporter: supporterOf("Production") }));
        expect(JSON.parse((await getMine()).body).supporter).toEqual({ number: 1, since: SINCE, months: 2 });
        mockSend.mockResolvedValueOnce(stored({ supporter: supporterOf("Production") }));
        expect(JSON.parse((await getPublic("u1")).body).supporter).toEqual({ number: 1, since: SINCE, months: 2 });
        expect(toPublicProfile({ userId: "u1", supporter: supporterOf("Production") } as never).supporter)
            .toEqual({ number: 1, since: SINCE, months: 2 });
    });

    it("badgeFields / publicSupporter: owner を付けたときだけ Sandbox を出す", () => {
        const p = { supporter: supporterOf("Sandbox") };
        expect(publicSupporter(p)).toBeUndefined();
        expect(badgeFields(p)).not.toHaveProperty("supporter");
        expect(publicSupporter(p, Date.now(), { owner: true })).toEqual({ number: 1, since: SINCE, months: 2, sandbox: true });
        expect(badgeFields(p, Date.now(), { owner: true }).supporter).toEqual({ number: 1, since: SINCE, months: 2, sandbox: true });
        // 番号が無い Sandbox の記録は本人にも出さない（今までどおり番号を持つ人だけ）
        expect(publicSupporter({ supporter: { ...supporterOf("Sandbox"), number: undefined } }, Date.now(), { owner: true })).toBeUndefined();
    });

    it("Sandbox だけのサーバー（staging）では今までどおり公開し、sandbox は付けない", async () => {
        vi.stubEnv("APPSTORE_ENVIRONMENTS", "Sandbox");
        mockSend.mockResolvedValueOnce(stored({ supporter: supporterOf("Sandbox") }));
        expect(JSON.parse((await getMine()).body).supporter).toEqual({ number: 1, since: SINCE, months: 2 });
        mockSend.mockResolvedValueOnce(stored({ supporter: supporterOf("Sandbox") }));
        expect(JSON.parse((await getPublic("u1")).body).supporter).toEqual({ number: 1, since: SINCE, months: 2 });
    });
});
