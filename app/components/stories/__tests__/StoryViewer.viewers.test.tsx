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

    // **200 だが本文の形がおかしい場合も同じ。** 行のふるいを足したとき
    // `?? []` にしたので「まだ閲覧者はいません」と同じ見た目になっていた
    // ——すぐ上の else のコメント（SW-b8）が言っているのと同じ混同を、
    // 自分で足した行の上で作っていた
    it.each([
        ["viewers が配列でない", { viewers: { a: 1 } }],
        ["viewers が無い", { count: 0 }],
    ])("%s でも「0人」と混ぜない", async (_name, body) => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url.includes("/viewers")) return Promise.resolve({ ok: true, json: async () => body });
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

    // **見出しとボタンも「取得中」のままにしない。**
    // シートの本文は「読み込めませんでした」なのに、同じ画面の数字は
    // `viewers === null ? "…"` で**永久に取得中**に見えていた（再取得は無い）。
    // コメントには「区別は `viewersError` が持つ」と書いていたが、
    // 数字を出す2か所は `viewersError` を読んでいなかった。
    it("失敗したら、見出しの数字も「取得中」のままにしない", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url.includes("/viewers")) return Promise.resolve({ ok: true, json: async () => ({ viewers: { a: 1 } }) });
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
        await screen.findByText(/閲覧者を読み込めませんでした/);

        const heading = screen.getByRole("heading", { name: /閲覧者/ });
        expect((heading.textContent ?? "").replace("閲覧者", "").trim(),
            "失敗しているのに『取得中』のまま").toBe("");

        // **ボタン側も見る。** 見出しだけを読んでいたので、ボタンの
        // `viewersError` を消す変異が全12ファイル79件 全緑で素通りしていた
        // （このリポジトリのどのテストもボタンの文字を読んでいなかった）
        const button = screen.getByLabelText("閲覧者を見る");
        expect(button.textContent ?? "", "ボタンが『取得中』のまま").not.toContain("...");
        expect(button.textContent ?? "", "失敗しているのに人数を出している").not.toMatch(/\d/);
    });

    // 正常系: 本当に0人なら「まだ閲覧者はいません」（逆向きの混同を作らない）
    it("本当に0人なら『まだ閲覧者はいません』", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url.includes("/viewers")) return Promise.resolve({ ok: true, json: async () => ({ viewers: [] }) });
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

        expect(await screen.findByText(/まだ閲覧者はいません/)).toBeInTheDocument();
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
        // ボタンは0人でも数字を出す（失敗と混ぜない・逆向き）
        expect(screen.getByLabelText("閲覧者を見る").textContent ?? "").toContain("閲覧 0人");
    });

    // **失敗を次のストーリーへ持ち越さない。**
    // 切り替えのリセット（`setViewersError(false)`）を消しても、この周まで
    // 12ファイル79件が全緑だった。「失敗したら数字を出さない」に倒したぶん、
    // 持ち越すと**次のストーリーがずっと空のまま**になる（前は `—` が出て
    // いたので目に見えていた）——直した側の穴を新しく静かにしない
    it("1枚目が失敗しても、2枚目は「取得中（...）」に戻る", async () => {
        const slow2 = deferred<unknown>();
        mockUserFetch.mockImplementation((url: string) => {
            const u = String(url);
            if (u.includes("/viewers")) {
                return u.includes("s1")
                    ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
                    : slow2.promise;
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
        // 1枚目: 失敗したので数字も「取得中」も出ない
        await waitFor(() => expect(screen.getByLabelText("閲覧者を見る").textContent ?? "").toBe(""));

        fireEvent.keyDown(document, { key: "ArrowRight" });
        await waitFor(() => expect(
            mockUserFetch.mock.calls.some((c) => String(c[0]).includes("s2") && String(c[0]).includes("/viewers")),
        ).toBe(true));

        // 2枚目はまだ返ってきていない＝「取得中」
        expect(screen.getByLabelText("閲覧者を見る").textContent ?? "",
            "前のストーリーの失敗を持ち越している").toContain("...");

        // 返ってきたら人数に変わる（持ち越していないことを最後まで見る）
        slow2.resolve(viewersOf(["2枚目を見た人"]));
        await waitFor(() => expect(screen.getByLabelText("閲覧者を見る").textContent ?? "").toContain("閲覧 1人"));
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
