import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 再ビルド依頼。退会・写真削除・非公開のあとに1回だけ叩く。
//
// 静的エクスポートなので、DynamoDB と S3 を消しても、既に配ってある
// /photo/<id> の HTML は残り続ける（本文・撮影地・EXIF・表示名入りの
// JSON-LD まで焼き込まれている）。定期ビルドは Actions の枠の都合で
// 止めてあるので、ここが唯一の掃除経路になる。
//
// ただし、ここで例外を投げたり待たせすぎたりして削除そのものを
// 失敗させてはいけない。「消えたけど掃除は後回し」は許容できるが、
// 「消せませんでした」と言いながらデータは半分消えた、は許容できない。

// クールダウンの判定は DynamoDB を叩く。モックしないと、テストが
// 実エンドポイントへ発射して遅く・不安定になる（資格情報が無いと
// 数秒かけて失敗し、fail-open で「通った」ことになる）。
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));

const originalFetch = globalThis.fetch;
const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });

async function loadWith(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) vi.stubEnv(k, "");
        else vi.stubEnv(k, v);
    }
    return import("../rebuild");
}

beforeEach(() => { vi.unstubAllEnvs(); mockDdbSend.mockReset().mockResolvedValue({}); });
afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); });

describe("requestSiteRebuild", () => {
    it("設定が無ければ何もせず false（削除自体は失敗させない）", async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "", REBUILD_DISPATCH_TOKEN: "" });
        expect(await requestSiteRebuild("test")).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("トークンだけ無い場合も何もしない", async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "" });
        expect(await requestSiteRebuild("test")).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("設定があれば repository_dispatch を1回叩く", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });

        expect(await requestSiteRebuild("photo deleted: p1")).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.github.com/repos/o/r/dispatches");
        expect(init.method).toBe("POST");
        const body = JSON.parse(String(init.body)) as { event_type: string; client_payload: { reason: string } };
        expect(body.event_type).toBe("site-rebuild");
        expect(body.client_payload.reason).toBe("photo deleted: p1");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    });

    it("GitHub が失敗を返しても投げない", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false, status: 401, text: async () => "bad credentials",
        }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("test")).toBe(false);
    });

    it("通信そのものが失敗しても投げない", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("test")).toBe(false);
    });
});


// クールダウンは一度作りを誤った。すべての依頼に一律でかけたところ、
// 当たった依頼は**見送られるだけで後から実行されない**ので、
// 「12:00 に写真削除 → 12:04 に別の人が退会」だと退会分の掃除が
// 永久に走らなくなった（定期ビルドは止めてあり、本人はもうアカウントが
// 無いので手動実行もできない）。
// 連打の畳み込みはワークフロー側で済んでいるので、ここで要るのは
// 「データを壊さずに何度でも起こせる操作」を抑えることだけ。
describe("requestSiteRebuild: クールダウン", () => {
    const setup = async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        return loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
    };

    /** ロックの取得だけ失敗させる（予算は通す） */
    const lockBusy = () => {
        mockDdbSend.mockImplementation((cmd: { input?: { Key?: { id?: string } } }) => {
            const id = String(cmd?.input?.Key?.id ?? "");
            if (id === "rebuild#lock") return Promise.reject(condFail());
            return Promise.resolve({});
        });
    };

    it("削除・退会は畳まない（指定しなければ素通し）", async () => {
        const { requestSiteRebuild } = await setup();
        lockBusy();   // 直近に依頼済みでも
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("coalesce を指定したときだけ、直近の依頼があれば見送る", async () => {
        const { requestSiteRebuild } = await setup();
        lockBusy();
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("見送る判定は条件付き書き込みで行う（呼び出し順ではなく）", async () => {
        const { requestSiteRebuild } = await setup();
        await requestSiteRebuild("photo updated: p1", { coalesce: true });
        const claim = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => String(i?.UpdateExpression ?? "").startsWith("SET lastAt"));
        expect(claim?.ConditionExpression).toBe("attribute_not_exists(lastAt) OR lastAt < :cutoff");
        expect(claim?.Key).toEqual({ id: "rebuild#lock" });
    });

    it("直近の依頼が無ければ通す", async () => {
        const { requestSiteRebuild } = await setup();
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("依頼そのものが失敗したら印を戻す（次の依頼を巻き添えにしない）", async () => {
        // トークン失効中に削除 → 印だけ残ると、直したあとも次の依頼が
        // 見送られて掃除が落ちる。
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("x", { coalesce: true })).toBe(false);
        const removes = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "REMOVE lastAt");
        expect(removes).toHaveLength(1);
    });

    // 戻すのは**自分が書いた印**だけ。無条件に消していた頃は、
    // 判定に失敗して素通しした呼び出し（何も書いていない）が失敗すると、
    // 同じ瞬間に印を取って実際にビルドを始めた別の呼び出しの印まで
    // 消していた——ロックが無いより弱い。
    it("戻すときは自分が書いた印かどうかを条件に付ける", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        await requestSiteRebuild("x", { coalesce: true });
        const release = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => i?.UpdateExpression === "REMOVE lastAt");
        expect(release?.ConditionExpression).toBe("lastAt = :mine");
        const claim = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => String(i?.UpdateExpression ?? "").startsWith("SET lastAt"));
        const claimed = (claim?.ExpressionAttributeValues as Record<string, unknown>)[":now"];
        expect((release?.ExpressionAttributeValues as Record<string, unknown>)[":mine"]).toBe(claimed);
    });

    it("印を書けていない呼び出しは、他人の印を消しに行かない", async () => {
        // 判定そのものが落ちた（＝素通しした）ケース。書いていないので戻すものも無い。
        mockDdbSend.mockRejectedValue(new Error("ddb down"));
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("x", { coalesce: true })).toBe(false);
        const removes = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "REMOVE lastAt");
        expect(removes).toHaveLength(0);
    });

    // 見送った分は後から実行されない。一度「見送った」印を lock に書いたが、
    // それを読む所がどこにも無く、書くだけの死にコードだった。読む側を
    // 作らないなら置かない——見送りのたびに DynamoDB へ1回書くだけ損をする。
    it("見送るときに余計な書き込みをしない", async () => {
        const { requestSiteRebuild } = await setup();
        mockDdbSend.mockRejectedValueOnce(condFail());
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(false);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);   // 印を取ろうとした1回だけ
    });
});


// クールダウンでは費用は止まらない。deploy.yml の concurrency は
// **待機中**の実行を常に1つに畳むので、依頼を何本投げても走るのは
// 「1本ずつ、8分かけて」——本数の天井は依頼の間隔ではなくビルドの長さで
// 決まる。効くのは総量の予算だけ。
//
// しかも削除経路は素通し（見送った分が後から実行されないため）なので、
// 「上げて消す」を繰り返せば依頼は無限に作れる。費用の歯止めはここにしか
// 置けない。
describe("requestSiteRebuild: 月の予算", () => {
    /** 予算の確保だけ失敗させる（ロックは通す） */
    const budgetFull = () => {
        mockDdbSend.mockImplementation((cmd: { input?: { Key?: { id?: string } } }) => {
            const id = String(cmd?.input?.Key?.id ?? "");
            if (id.startsWith("rebuild#budget#")) return Promise.reject(condFail());
            return Promise.resolve({});
        });
    };
    const budgetCall = () => mockDdbSend.mock.calls
        .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
        .find((i) => String((i?.Key as { id?: string })?.id ?? "").startsWith("rebuild#budget#"));

    it("上限に達していたら、削除経路でも依頼を投げない", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        budgetFull();
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("上限に達したら、取った印も戻す（次の依頼を巻き添えにしない）", async () => {
        // 予算切れで見送ったのに印だけ残ると、枠が戻った翌月も
        // クールダウン中は依頼が通らない。
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        budgetFull();
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(false);
        const removes = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "REMOVE lastAt");
        expect(removes).toHaveLength(1);
    });

    it("数えるのは月ごとの別アイテム（月が変われば 0 から）", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
        try {
            await requestSiteRebuild("photo deleted: p1");
        } finally {
            vi.useRealTimers();
        }
        expect(budgetCall()?.Key).toEqual({ id: "rebuild#budget#2026-08" });
    });

    it("count は DynamoDB の予約語なので名前を割り当てる（実データでは式が壊れる）", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        await requestSiteRebuild("photo deleted: p1");
        const call = budgetCall();
        expect(call?.UpdateExpression).toBe("ADD #c :one");
        expect(call?.ConditionExpression).toBe("attribute_not_exists(#c) OR #c < :max");
        expect(call?.ExpressionAttributeNames).toEqual({ "#c": "count" });
    });

    it("上限は環境変数で上げられる（枠を増やしたときに合わせる）", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({
            REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok", REBUILD_MONTHLY_MAX: "500",
        });
        await requestSiteRebuild("photo deleted: p1");
        expect((budgetCall()?.ExpressionAttributeValues as Record<string, unknown>)[":max"]).toBe(500);
    });

    it("依頼そのものが失敗したら予算を戻す（使っていない分を数えない）", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(false);
        const back = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .filter((i) => i?.UpdateExpression === "ADD #c :minus");
        expect(back).toHaveLength(1);
        expect((back[0]?.ExpressionAttributeValues as Record<string, unknown>)[":minus"]).toBe(-1);
        // 0 を下回らせない（戻し忘れより、戻しすぎの方が直しにくい）
        expect(back[0]?.ConditionExpression).toBe("#c > :z");
    });

    it("通信そのものが失敗したときも予算を戻す", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(false);
        const back = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "ADD #c :minus");
        expect(back).toHaveLength(1);
    });

    it("予算を判定できないときは通す（掃除が落ちる方が困る）", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        mockDdbSend.mockImplementation((cmd: { input?: { Key?: { id?: string } } }) => {
            const id = String(cmd?.input?.Key?.id ?? "");
            if (id.startsWith("rebuild#budget#")) return Promise.reject(new Error("ddb down"));
            return Promise.resolve({});
        });
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("クールダウンで見送ったときは予算を使わない", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        mockDdbSend.mockImplementation((cmd: { input?: { Key?: { id?: string } } }) => {
            const id = String(cmd?.input?.Key?.id ?? "");
            if (id === "rebuild#lock") return Promise.reject(condFail());
            return Promise.resolve({});
        });
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(false);
        expect(budgetCall()).toBeUndefined();
    });
});

describe("REBUILD_MONTHLY_MAX の読み取り", () => {
    const maxOf = async (raw: string | undefined) => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({
            REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok", REBUILD_MONTHLY_MAX: raw,
        });
        await requestSiteRebuild("photo deleted: p1");
        const call = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => String((i?.Key as { id?: string })?.id ?? "").startsWith("rebuild#budget#"));
        return (call?.ExpressionAttributeValues as Record<string, unknown>)[":max"];
    };

    // serverless.yml は未指定のパラメータを**空文字**で渡す（REBUILD_REPO と同じ書き方）。
    // `?? "200"` だけだと空文字は素通りして Number("") = 0 になり、
    // 予算が最初から尽きた状態＝掃除が二度と走らない。
    it("空文字は 0 ではなく既定の 200 として読む", async () => {
        expect(await maxOf("")).toBe(200);
    });

    it("未設定なら 200", async () => {
        expect(await maxOf(undefined)).toBe(200);
    });

    it("数値でない値も既定に落とす", async () => {
        expect(await maxOf("いくつでも")).toBe(200);
    });

    it("0 や負数も既定に落とす（事故で掃除を止めない）", async () => {
        expect(await maxOf("0")).toBe(200);
        expect(await maxOf("-5")).toBe(200);
    });
});
