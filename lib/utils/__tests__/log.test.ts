import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("log (NODE_ENV=test ≠ production)", () => {
    it("log.debug は console.debug を呼ぶ", async () => {
        const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
        const { log } = await import("../log");
        log.debug("msg");
        expect(spy).toHaveBeenCalledWith("[debug]", "msg");
    });

    it("log.info は console.info を呼ぶ", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        const { log } = await import("../log");
        log.info("info-msg");
        expect(spy).toHaveBeenCalledWith("[info]", "info-msg");
    });

    it("log.warn は console.warn を呼ぶ", async () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { log } = await import("../log");
        log.warn("warn-msg");
        expect(spy).toHaveBeenCalledWith("[warn]", "warn-msg");
    });

    it("log.error は console.error を呼ぶ", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const { log } = await import("../log");
        log.error("err", { detail: 1 });
        expect(spy).toHaveBeenCalledWith("[error]", "err", { detail: 1 });
    });

    it("複数引数を受け取れる", async () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { log } = await import("../log");
        log.warn("a", "b", 3);
        expect(spy).toHaveBeenCalledWith("[warn]", "a", "b", 3);
    });
});
