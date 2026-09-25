import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * プッシュの宛先を預ける・外す。**ネイティブの殻より先に置ける部分。**
 *
 * ここで守るのは3つ:
 *   1. **投げない。** 失敗してログアウトが止まる方が、通知が届かないより困る
 *   2. **同じ宛先を二度送らない**（起動ごとに呼ばれてよい形にする）
 *   3. **覚えた印は、送信の成否に関わらず捨てる**（残すと「預けてある」と
 *      誤判定して、次にこの端末でログインした人が登録できない）
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({ userFetch: (...a: unknown[]) => mockUserFetch(...(a as [])) }));
vi.mock("../../utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const {
    registerPushToken, unregisterPushToken, storedDeviceToken, forgetStoredDeviceToken,
    isValidDeviceToken, normalizeToken, DEVICE_TOKEN_RE,
} = await import("../deviceToken");

const T = "a".repeat(64);
const U = "b".repeat(64);
const sent = () => mockUserFetch.mock.calls.map((c) => [
    c[0],
    (c[1] as { method?: string })?.method,
    JSON.parse(String((c[1] as { body?: string })?.body ?? "{}")),
]);

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, status: 200 });
    localStorage.clear();
});

describe("宛先の形", () => {
    it("16進32〜200文字だけ通す", () => {
        expect(isValidDeviceToken(T)).toBe(true);
        expect(isValidDeviceToken("a".repeat(31)), "短すぎる").toBe(false);
        expect(isValidDeviceToken("a".repeat(201)), "長すぎる").toBe(false);
        expect(isValidDeviceToken("z".repeat(64)), "16進でない").toBe(false);
        for (const v of [undefined, null, 1, {}, [], ""]) {
            expect(isValidDeviceToken(v), JSON.stringify(v)).toBe(false);
        }
    });

    it("前後の空白を落とし、小文字に畳む", () => {
        expect(normalizeToken(`  ${T.toUpperCase()}  `)).toBe(T);
        expect(isValidDeviceToken(` ${T} `), "空白つきを弾いている").toBe(true);
    });
});

describe("預ける", () => {
    it("小文字にして POST する", async () => {
        expect(await registerPushToken(T.toUpperCase())).toBe(true);
        expect(sent()).toEqual([["/user/devices", "POST", { token: T }]]);
        expect(storedDeviceToken()).toBe(T);
    });

    // 起動ごとに呼ばれてよい形にする（1往復を毎回増やさない）
    it("同じ宛先なら二度送らない", async () => {
        await registerPushToken(T);
        mockUserFetch.mockClear();
        expect(await registerPushToken(T), "預かられているのに false を返している").toBe(true);
        expect(mockUserFetch, "同じ宛先を送り直している").not.toHaveBeenCalled();
    });

    it("宛先が変わったら送る", async () => {
        await registerPushToken(T);
        mockUserFetch.mockClear();
        await registerPushToken(U);
        expect(sent()).toEqual([["/user/devices", "POST", { token: U }]]);
        expect(storedDeviceToken()).toBe(U);
    });

    it("形が違えば送らない", async () => {
        expect(await registerPushToken("nope")).toBe(false);
        expect(mockUserFetch).not.toHaveBeenCalled();
        expect(storedDeviceToken()).toBeNull();
    });

    // **失敗を覚えない。** 覚えると、次の起動で「もう預けてある」と誤判定する
    it("サーバーが断ったら覚えない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 400 });
        expect(await registerPushToken(T)).toBe(false);
        expect(storedDeviceToken(), "失敗を覚えている").toBeNull();
    });

    // `userFetch` は未ログイン・通信不能で**投げる**
    it("投げられても投げ返さない", async () => {
        mockUserFetch.mockRejectedValue(new Error("ログインが必要です"));
        await expect(registerPushToken(T)).resolves.toBe(false);
        expect(storedDeviceToken()).toBeNull();
    });
});

describe("外す", () => {
    it("覚えている宛先を DELETE する", async () => {
        await registerPushToken(T);
        mockUserFetch.mockClear();
        expect(await unregisterPushToken()).toBe(true);
        expect(sent()).toEqual([["/user/devices", "DELETE", { token: T }]]);
        expect(storedDeviceToken(), "印が残っている").toBeNull();
    });

    it("渡された宛先を優先する", async () => {
        await registerPushToken(T);
        mockUserFetch.mockClear();
        await unregisterPushToken(U.toUpperCase());
        expect(sent()).toEqual([["/user/devices", "DELETE", { token: U }]]);
    });

    // ブラウザで開いているだけの人はここを通る（1往復も起こさない）
    it("覚えていなければ何もしない", async () => {
        expect(await unregisterPushToken()).toBe(false);
        expect(mockUserFetch, "宛先が無いのに送っている").not.toHaveBeenCalled();
    });

    // 🔴 **送信の成否に関わらず印は捨てる。** 残すと、次にこの端末で
    // ログインした人の `registerPushToken` が「もう預けてある」と判断して
    // 送らない——実際には外れているのに
    it("外せなくても印は捨てる", async () => {
        await registerPushToken(T);
        mockUserFetch.mockReset().mockResolvedValue({ ok: false, status: 500 });
        expect(await unregisterPushToken()).toBe(false);
        expect(storedDeviceToken(), "外せなかったのに印を残している").toBeNull();
    });

    it("投げられても投げ返さない（ログアウトを止めない）", async () => {
        await registerPushToken(T);
        mockUserFetch.mockReset().mockRejectedValue(new Error("boom"));
        await expect(unregisterPushToken()).resolves.toBe(false);
        expect(storedDeviceToken()).toBeNull();
    });
});

describe("印だけ捨てる（退会の経路）", () => {
    it("サーバーへは送らない", async () => {
        await registerPushToken(T);
        mockUserFetch.mockClear();
        forgetStoredDeviceToken();
        expect(storedDeviceToken()).toBeNull();
        expect(mockUserFetch, "退会の経路で宛先を送っている").not.toHaveBeenCalled();
    });
});

describe("localStorage が使えないとき", () => {
    it("読めなくても投げない", () => {
        const spy = vi.spyOn(window.localStorage, "getItem")
            .mockImplementation(() => { throw new Error("denied"); });
        expect(() => storedDeviceToken()).not.toThrow();
        expect(storedDeviceToken()).toBeNull();
        spy.mockRestore();
    });

    it("書けなくても登録は成功として扱う", async () => {
        const spy = vi.spyOn(window.localStorage, "setItem")
            .mockImplementation(() => { throw new Error("full"); });
        await expect(registerPushToken(T)).resolves.toBe(true);
        spy.mockRestore();
    });

    // 壊れた値が入っていても「覚えている」と読まない
    it("壊れた値は覚えていない扱い", () => {
        localStorage.setItem("jp_push_device_token", "garbage");
        expect(storedDeviceToken()).toBeNull();
    });
});

describe("形の定義", () => {
    it("グローバルフラグを持たない（`test` の呼び出しで状態が進まない）", () => {
        expect(DEVICE_TOKEN_RE.global,
            "g 付きだと lastIndex が残って2回目が false になる").toBe(false);
        expect(DEVICE_TOKEN_RE.test(T)).toBe(true);
        expect(DEVICE_TOKEN_RE.test(T), "2回目が false になっている").toBe(true);
    });
});
