import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **「まだ分からない」と「0人」を混ぜていた。**
//
// 数は共有ストアから `?? EMPTY`（0/0）で読んでいたので、取得が落ちた人の
// プロフィールは「フォロワー 0 / フォロー中 0」と**言い切って**いた。
// 失敗の印も再試行の導線も無く、本当に0人の人と区別が付かない。
// この画面には読み込み中の表示が無いので、分かるまで出さずに待つ。

const mockUserPublicFetch = vi.hoisted(() => vi.fn());
// 実物を土台にする（列挙だけだと、実装が新しく使う export が undefined に
// なって投げ、catch が飲む＝緑のまま何も測らないテストになる）
vi.mock("../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/utils/api")>()),
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ userIds: [] }) })),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    publicFetch: vi.fn(),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const TARGET = "44444444-4444-4444-8444-444444444444";

beforeEach(async () => {
    vi.resetModules();
    mockUserPublicFetch.mockReset();
});

/** ストアはモジュール内に持たれるので、毎回読み込み直す */
async function renderButton(isAuthenticated = false) {
    const mod = await import("../FollowButton");
    const FollowButton = mod.default;
    return render(<FollowButton targetUserId={TARGET} isAuthenticated={isAuthenticated} locale="ja" />);
}

describe("フォロー数のピル", () => {
    // **数だけ伏せる。** 行ごと消すと、数が届いた瞬間に約33pxの行が
    // 挿入されて下が全部動く（すぐ上の「投稿・いいね」は同じ問題に
    // `photosResolved ? postCount : "…"` で答えている）
    it("取得に失敗したら数を出さない（0と言い切らない）", async () => {
        mockUserPublicFetch.mockRejectedValue(new Error("network"));
        await renderButton();

        // 取得の失敗が確定するまで待つ
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 20));

        expect(screen.queryByText("0"), "取れていないのに「0」と言い切っている").toBeNull();
        expect(screen.getAllByText("…"), "数の場所が空になっている").toHaveLength(2);
    });

    it("取得できたら数を出す（正常系）", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 501, following: 87 }) });
        await renderButton();

        expect(await screen.findByText("フォロワー")).toBeInTheDocument();
        expect(screen.getByText("501")).toBeInTheDocument();
        expect(screen.getByText("87")).toBeInTheDocument();
    });

    // **次の行に置く**（owner の指示）。以前はラッパー無しのフラグメントで
    // 返して、親の「投稿・いいね」の行に混ざっていた。ラッパーを持たせる
    // 側を間違えると、数が取れていない回に**空の行の余白だけ残る**
    it("2つのピルは、投稿・いいねとは別の1つの行にまとまっている", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 3, following: 4 }) });
        const { container } = await renderButton();
        await screen.findByText("フォロワー");
        expect(container.children, "行のラッパーが無い（親の行に混ざる）").toHaveLength(1);
        const row = container.firstElementChild!;
        expect(row.className).toContain("flex");
        expect(row.contains(screen.getByText("フォロー中"))).toBe(true);
        expect(row.contains(screen.getByText("フォロワー"))).toBe(true);
    });

    // 行の高さが動かないこと（数が届く前後で行が1つある）
    it("数が届く前も、行は1つあって高さが動かない", async () => {
        mockUserPublicFetch.mockImplementation(() => new Promise(() => { /* 返らない */ }));
        const { container } = await renderButton();
        await screen.findByText("フォロー中");
        expect(container.children, "行ごと無い（届いた瞬間に下が全部動く）").toHaveLength(1);
        expect(screen.getAllByText("…")).toHaveLength(2);
    });

    // owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
    // フォロワー側は `followers#<uid>` を足して（FOLLOWERS-1）両方押せる
    it("フォロー中もフォロワーも押して一覧を開ける", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 5, following: 4 }) });
        await renderButton(true);
        await screen.findByText("4");   // 数が届くまで待つ（届く前はどちらも押せない）
        expect(screen.getByText("フォロー中").closest("button"), "フォロー中の一覧を開けない").not.toBeNull();
        expect(screen.getByText("フォロワー").closest("button"), "フォロワーの一覧を開けない").not.toBeNull();
    });

    it("フォロワーが0人なら押させない", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 0, following: 4 }) });
        await renderButton(true);
        await screen.findByText("4");
        expect(screen.getByText("フォロワー").closest("button")).toBeNull();
    });

    it("フォロワーを押すと、フォロワーの一覧が開く", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 5, following: 4 }) });
        await renderButton(true);
        await screen.findByText("5");
        screen.getByText("フォロワー").closest("button")!.click();
        expect(await screen.findByRole("dialog", { name: "フォロワー" })).toBeInTheDocument();
    });

    it("0人なら押させない（開いても空）", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 0, following: 0 }) });
        await renderButton(true);
        await screen.findByText("フォロワー");
        expect(screen.getByText("フォロー中").closest("button")).toBeNull();
    });

    // 数が届く前は押させない（開いても空・押せる/押せないが途中で変わる）
    it("数が届く前は押させない", async () => {
        mockUserPublicFetch.mockImplementation(() => new Promise(() => { /* 返らない */ }));
        await renderButton(true);
        await screen.findByText("フォロー中");
        expect(screen.getByText("フォロー中").closest("button")).toBeNull();
    });

    // 一覧の口は認証が要る（未認証で押すと必ず失敗する）
    it("未ログインなら押させない", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 5, following: 4 }) });
        await renderButton(false);
        await screen.findByText("4");
        expect(screen.getByText("フォロー中").closest("button")).toBeNull();
    });

    it("押すと一覧が開く", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 5, following: 4 }) });
        await renderButton(true);
        await screen.findByText("4");
        screen.getByText("フォロー中").closest("button")!.click();
        expect(await screen.findByRole("dialog", { name: "フォロー中" })).toBeInTheDocument();
    });

    it("本当に0人なら0を出す（未取得と混ぜない）", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 0, following: 0 }) });
        await renderButton();

        expect(await screen.findByText("フォロワー")).toBeInTheDocument();
        expect(screen.getAllByText("0")).toHaveLength(2);
    });
});
