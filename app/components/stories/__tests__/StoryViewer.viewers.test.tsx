import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoryGroup } from "@/lib/stories";

// 自分のストーリーを見ているとき、「誰が見たか」を取りにいく。
// ストーリーは左右で次々に切り替わるので、前のストーリーの応答が後から届く。
// 中断ガードが無かった頃は**別のストーリーの閲覧者数と名前**が出ていた。
// 「誰が見たか」は見せ方として敏感な情報なので、取り違えたまま出すのは特に悪い。

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));

import StoryViewer from "../StoryViewer";

const groups = (): StoryGroup[] => [{
    userId: "me",
    displayName: "自分",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "me", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" },
        { id: "s2", src: "https://cdn/x/b.jpg", userId: "me", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z" },
    ],
}];

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

const viewersOf = (names: string[]) => ({
    ok: true,
    json: async () => ({ viewers: names.map((displayName) => ({ userId: displayName, displayName, at: "2026-07-04T12:00:00Z" })) }),
});

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("閲覧者一覧: 別のストーリーのものを出さない", () => {
    it("切り替えたあとに届いた古い応答を捨てる", async () => {
        const slow1 = deferred<unknown>();
        mockUserFetch.mockImplementation((url: string) => {
            if (url.includes("/viewers")) {
                return url.includes("s1") ? slow1.promise : Promise.resolve(viewersOf(["2枚目を見た人"]));
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(
            <StoryViewer
                groups={groups()}
                initialGroupIndex={0}
                locale="ja"
                isAuthenticated
                ownUserId="me"
                onSeen={() => { /* noop */ }}
                onClose={() => { /* noop */ }}
            />,
        );
        await waitFor(() => expect(
            mockUserFetch.mock.calls.some((c) => String(c[0]).includes("s1") && String(c[0]).includes("/viewers")),
        ).toBe(true));

        // 2枚目へ進む（キーボード操作。document で keydown を拾っている）
        fireEvent.keyDown(document, { key: "ArrowRight" });

        await waitFor(() => expect(
            mockUserFetch.mock.calls.some((c) => String(c[0]).includes("s2") && String(c[0]).includes("/viewers")),
        ).toBe(true));

        // **閲覧者一覧を開く。** 開かないと名前は DOM に出ないので、
        // 中断ガードを外しても落ちないテストになってしまう（実際に一度そうなった）。
        await userEvent.click(await screen.findByLabelText("閲覧者を見る"));
        expect(await screen.findByText("2枚目を見た人")).toBeInTheDocument();

        // ここで1枚目の応答がようやく届く
        slow1.resolve(viewersOf(["1枚目を見た人", "もう一人"]));
        await new Promise((r) => setTimeout(r, 20));

        // 1枚目の閲覧者は出ない。2枚目のぶんは残る
        expect(screen.queryByText("1枚目を見た人")).toBeNull();
        expect(screen.queryByText("もう一人")).toBeNull();
        expect(screen.getByText("2枚目を見た人")).toBeInTheDocument();
    });
});

// 取得の失敗が「まだ閲覧者はいません」と同じ表示だった（SW-b8）
describe("閲覧者一覧: 取得の失敗", () => {
    it("0人の表示と混ぜず、読み込めなかったことを伝える", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url.includes("/viewers")) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(
            <StoryViewer
                groups={groups()}
                initialGroupIndex={0}
                locale="ja"
                isAuthenticated
                ownUserId="me"
                onSeen={() => { /* noop */ }}
                onClose={() => { /* noop */ }}
            />,
        );
        await userEvent.click(await screen.findByLabelText("閲覧者を見る"));

        expect(await screen.findByText(/閲覧者を読み込めませんでした/)).toBeInTheDocument();
        expect(screen.queryByText(/まだ閲覧者はいません/)).toBeNull();
    });
});


// **見出しだけ、取得中を「0」と出していた。**
//
// 同じ画面のボタン側は `viewers === null` を "..." と正しく出しているのに、
// 見出しは `{viewers?.length ?? 0}` で null を 0 に潰していた。自分の
// はじめてのストーリーで開くと「閲覧者 0」が出てから数字が入る
// ——「誰にも見られていない」と読んで閉じる人が出る。
describe("閲覧者一覧: 見出しの数字", () => {
    /** 「閲覧者」の見出しに添えられた文字（数字 or …） */
    const headingCount = () =>
        (screen.getByRole("heading", { name: /閲覧者/ }).textContent ?? "").replace("閲覧者", "").trim();

    const open = () => {
        render(
            <StoryViewer
                groups={groups()}
                initialGroupIndex={0}
                locale="ja"
                isAuthenticated
                ownUserId="me"
                onSeen={() => { /* noop */ }}
                onClose={() => { /* noop */ }}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /閲覧/ }));
    };

    it("取得中は数字を出さない（0 と言わない）", () => {
        const d = deferred<unknown>();
        mockUserFetch.mockImplementation((path: string) =>
            String(path).includes("/viewers") ? d.promise : Promise.resolve({ ok: true, json: async () => ({}) }));

        open();
        expect(headingCount(), "取得中なのに「0」と言っている").not.toBe("0");
    });

    it("届いたらその数を出す", async () => {
        mockUserFetch.mockImplementation((path: string) =>
            Promise.resolve(String(path).includes("/viewers")
                ? viewersOf(["旅子", "山田"])
                : { ok: true, json: async () => ({}) }));

        open();
        await waitFor(() => expect(headingCount()).toBe("2"));
    });

    // 正常系: 本当に0人なら 0 を出す（取得中と取り違えない）
    it("本当に0人なら 0 を出す", async () => {
        mockUserFetch.mockImplementation((path: string) =>
            Promise.resolve(String(path).includes("/viewers")
                ? viewersOf([])
                : { ok: true, json: async () => ({}) }));

        open();
        await waitFor(() => expect(headingCount()).toBe("0"));
    });
});
