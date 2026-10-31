import { describe, it, expect, beforeEach } from "vitest";
import { track, gaInitSnippet, signupFromVia, PENDING_QUEUE, PENDING_MAX } from "../analytics";

/**
 * 登録までの数え方（journey.photo-ios#432 の 5・2026-10-31）。
 * GA4 は `lazyOnload` なので、読み込み前に押されたイベントを落とさないことを固定する
 */
type W = Window & { gtag?: unknown; dataLayer?: unknown[]; [PENDING_QUEUE]?: unknown };
const w = window as W;

beforeEach(() => {
    delete w.gtag;
    delete w.dataLayer;
    delete w[PENDING_QUEUE];
});

describe("track", () => {
    it("gtag があればそのまま送る", () => {
        const calls: unknown[][] = [];
        w.gtag = (...a: unknown[]) => { calls.push(a); };
        track("wish_tap", { signed_in: 1, kind: "spot" });
        expect(calls).toEqual([["event", "wish_tap", { signed_in: 1, kind: "spot" }]]);
    });

    it("gtag の前は列に積み、初期化の行が config のあとに送る", () => {
        track("wish_tap", { signed_in: 0, kind: "location" });
        track("sign_up", { method: "email", from: "wish" });
        expect(w[PENDING_QUEUE]).toHaveLength(2);

        // `Analytics.tsx` の初期化の行をそのまま走らせる（中身は文字列で渡される）。
        // ブラウザの `<script>` と同じく大域で動かす（間接の eval＝`function gtag` が大域に載る）
        (0, eval)(gaInitSnippet("G-TEST"));
        const dl = (w.dataLayer as IArguments[]).map((a) => Array.from(a));
        expect(dl.map((a) => a[0])).toEqual(["js", "config", "event", "event"]);
        expect(dl[1]).toEqual(["config", "G-TEST"]);
        expect(dl[2]).toEqual(["event", "wish_tap", { signed_in: 0, kind: "location" }]);
        expect(dl[3]).toEqual(["event", "sign_up", { method: "email", from: "wish" }]);
        // 吐き出したら空に（二度送らない）。以後は gtag へ直に
        expect(w[PENDING_QUEUE]).toBeNull();
        track("wish_tap", { signed_in: 1, kind: "spot" });
        expect((w.dataLayer as unknown[]).length).toBe(5);
    });

    it("GA4 の無い環境で積み続けない（頭打ち）", () => {
        for (let i = 0; i < PENDING_MAX + 10; i++) track("wish_tap", { signed_in: 0, kind: "spot" });
        expect(w[PENDING_QUEUE]).toHaveLength(PENDING_MAX);
    });
});

describe("signupFromVia", () => {
    it("via=wish だけが wish。それ以外（無い・別の値）は other", () => {
        expect(signupFromVia("wish")).toBe("wish");
        expect(signupFromVia(null)).toBe("other");
        expect(signupFromVia("")).toBe("other");
        expect(signupFromVia("WISH")).toBe("other");
    });
});
