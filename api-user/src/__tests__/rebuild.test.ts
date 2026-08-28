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

    // claimRebuildSlot が一度間違えた所と同じ形。判定に失敗して素通しした
    // 呼び出しは**何も加算していない**ので、戻してはいけない。戻すと、
    // スロットル中に「削除 → 依頼失敗」を繰り返すたびに count が実際の
    // 使用量より減っていき、上限を超えて依頼が通る＝予算が無いのと同じになる。
    it("予算を数えられなかった呼び出しは、失敗しても戻しに行かない", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        mockDdbSend.mockImplementation((cmd: { input?: { Key?: { id?: string } } }) => {
            const id = String(cmd?.input?.Key?.id ?? "");
            // 加算だけスロットルされる（条件失敗ではない＝素通しする側）
            if (id.startsWith("rebuild#budget#")) return Promise.reject(new Error("throttled"));
            return Promise.resolve({});
        });
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(false);
        const back = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "ADD #c :minus");
        expect(back).toHaveLength(0);
    });

    it("通信が落ちたときも、数えられていなければ戻さない", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        mockDdbSend.mockImplementation((cmd: { input?: { Key?: { id?: string } } }) => {
            const id = String(cmd?.input?.Key?.id ?? "");
            if (id.startsWith("rebuild#budget#")) return Promise.reject(new Error("throttled"));
            return Promise.resolve({});
        });
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(false);
        const back = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "ADD #c :minus");
        expect(back).toHaveLength(0);
    });

    // 確保と解放で別々に「今」を取ると、月末ぎりぎりの依頼が失敗したときに
    // 翌月の（まだ無い）アイテムを減らしにいく。条件で弾かれて握り潰されるので
    // 音もなく、前月が1本だけ過大計上のまま残る。
    it("月をまたいで失敗しても、増やしたのと同じ月から戻す", async () => {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
            vi.setSystemTime(new Date("2026-09-01T00:00:00.100Z"));   // 送っている間に月が変わる
            return { ok: false, status: 401, text: async () => "bad" };
        }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-31T23:59:59.900Z"));
        try {
            expect(await requestSiteRebuild("photo deleted: p1")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
        const back = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .filter((i) => i?.UpdateExpression === "ADD #c :minus");
        expect(back).toHaveLength(1);
        expect(back[0]?.Key).toEqual({ id: "rebuild#budget#2026-08" });
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

// ここだけ1発勝負だった。DynamoDB の競合は3回、トランザクションは3回＋
// バックオフ、S3 の失敗は 500 で押し直させる——なのに「消したのに検索に
// 残る」を止めている唯一の手段が、GitHub の 502 ひとつで落ちていた。
// 呼び出し元は戻り値を見ず、定期ビルドも止めてあるので、落ちた1本は
// 誰かが次に何かを消すまで永久に走らない。
describe("requestSiteRebuild: 依頼の再試行", () => {
    const load = () => loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
    /** 待ちを飛ばしながら最後まで走らせる */
    const runAll = async <T,>(p: Promise<T>): Promise<T> => {
        await vi.runAllTimersAsync();
        return p;
    };

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("502 は投げ直して、通れば成功", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 502, text: async () => "bad gateway" })
            .mockResolvedValueOnce({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();

        expect(await runAll(requestSiteRebuild("photo deleted: p1"))).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("通信そのものの失敗も投げ直す", async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();

        expect(await runAll(requestSiteRebuild("photo deleted: p1"))).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("429 も投げ直す", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
            .mockResolvedValueOnce({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();
        expect(await runAll(requestSiteRebuild("x"))).toBe(true);
    });

    // **やり直して直るものだけやり直す。** トークン失効やリポジトリ名違いは
    // 何度投げても同じで、削除の応答を待たせるだけになる
    it("401 は投げ直さない（設定の誤りは待っても直らない）", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad credentials" });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();

        expect(await runAll(requestSiteRebuild("x"))).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("404 も投げ直さない", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();
        expect(await runAll(requestSiteRebuild("x"))).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("回数には上限がある（削除の応答を待たせ続けない）", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();

        expect(await runAll(requestSiteRebuild("x"))).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(3);   // 最初の1回 + やり直し2回
    });

    it("諦めたら印も予算も戻す", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();
        await runAll(requestSiteRebuild("x", { coalesce: true }));

        const exprs = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression);
        expect(exprs.filter((u) => u === "REMOVE lastAt")).toHaveLength(1);
        expect(exprs.filter((u) => u === "ADD #c :minus")).toHaveLength(1);
    });

    // **成功したら何も戻さない。** 戻す2行を成功側に足す変異を当てても
    // 37件が全部緑だった＝この差分が固定できていなかった。入ると月の予算が
    // 数えられなくなり（費用の歯止めが消える）、クールダウンも効かなくなる。
    it("成功したときは印も予算も戻さない", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();
        expect(await runAll(requestSiteRebuild("x", { coalesce: true }))).toBe(true);

        const exprs = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression);
        expect(exprs.filter((u) => u === "REMOVE lastAt")).toHaveLength(0);
        expect(exprs.filter((u) => u === "ADD #c :minus")).toHaveLength(0);
    });

    // 呼び出し元（削除系）は既定6秒の Lambda。応答を返さない相手に
    // 残り時間を全部使われると、**データはもう消えているのに 500** が返り、
    // 押し直すと今度は 404 になる。しかも殺されると解放に到達しないので
    // 月の予算が1本ずつ減り続ける。
    // **`instanceof AbortSignal` だけでは何も測れない。**
    // 最初そう書いたら、`new AbortController().signal`（＝絶対に発火しない）
    // に差し替えても、期限を60秒にしても40件すべて緑だった。
    // signal が**自分で期限切れになること**を直に見る。
    // フェイクタイマーの下では AbortSignal.timeout が発火しないので、
    // この1本だけ実時計に戻す。
    it("1本ごとに期限を付ける（呼び出し元の残り時間を使い切らない）", async () => {
        vi.useRealTimers();
        let captured: AbortSignal | undefined;
        globalThis.fetch = vi.fn().mockImplementation((_u: string, init: { signal?: AbortSignal }) => {
            captured = init.signal;
            return Promise.resolve({ ok: true });
        }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();
        await requestSiteRebuild("x");

        expect(captured).toBeInstanceOf(AbortSignal);
        expect(captured!.aborted).toBe(false);
        // **上下から挟む。** 「1700ms 待って切れていること」だけだと、
        // 期限が 50ms でも 1ms でも緑になる——「800ms は攻めすぎだった」という
        // この変更の中心が、短くする方向の回帰を1つも捕まえられない。
        // 期限（1.5秒）の前後に 0.5 秒ずつ余裕を取る。300ms しか空けていな
        // かった頃は、重い機械で並列に回すと前半のスリープが 1.5 秒を超えて
        // 偽陽性で落ちうる状態だった
        await new Promise((r) => setTimeout(r, 1000));
        expect(captured!.aborted, "1.0秒では切れていない（短すぎる期限を弾く）").toBe(false);
        await new Promise((r) => setTimeout(r, 900));
        expect(captured!.aborted, "1.9秒では切れている（長すぎる期限を弾く）").toBe(true);
    }, 5000);

    it("締切を過ぎたら、残りの投げ直しをやめる", async () => {
        // 1本目が遅く、締切（3秒）を食い潰す
        const fetchMock = vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 5000));
            return { ok: false, status: 503, text: async () => "unavailable" };
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();

        expect(await runAll(requestSiteRebuild("x"))).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);   // 2本目は投げない
    });

    // 成功したのに投げ直すと、畳み込みの外で2本走る（枠を余計に食う）
    it("成功したら投げ直さない", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await load();
        expect(await runAll(requestSiteRebuild("x"))).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
