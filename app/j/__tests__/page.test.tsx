import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 共同アルバムの招待ページ（案C の S4）。
//
// ここで固定するのは**拡散の輪が切れないこと**:
//   - **閲覧はログイン不要**（開いた瞬間にログインを求めない）
//   - 断るときは**理由をそのまま出す**（期限切れ／取り消し／見つからない）
//   - ログインへ送るときは**戻り先を渡す**（ログイン後に招待へ帰れる）

const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ current: { isAuthenticated: false, loading: false } }));
const q = vi.hoisted(() => ({ t: "a".repeat(32) }));

vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(q.t ? `t=${q.t}` : ""),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => auth.current }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => (_r as unknown as { _msg?: string })._msg ?? f,
}));
vi.mock("next/link", () => ({
    default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a>,
}));

const InvitePage = (await import("../page")).default;

const okBody = {
    album: { id: "alb-1", title: "北欧の冬", memberCount: 3, photoCount: 5 },
    photos: [{ id: "p1", src: "https://cdn/1.jpg", thumbSrc: "https://cdn/t1.jpg" }],
};

beforeEach(() => {
    q.t = "a".repeat(32);
    auth.current = { isAuthenticated: false, loading: false };
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => okBody });
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ joined: true }) });
    mockShowToast.mockReset();
});

describe("招待ページ: 閲覧", () => {
    // **開いた瞬間にログインを求めない。** ここで求めると拡散の輪が切れる
    it("未ログインでも中身が見える", async () => {
        render(<InvitePage />);
        expect(await screen.findByText("北欧の冬")).toBeInTheDocument();
        expect(screen.getByText(/3人が参加/)).toBeInTheDocument();
        expect(document.body.querySelector("img[src='https://cdn/t1.jpg']"), "写真が出ていない").toBeTruthy();
    });

    it("未ログインならログインへ送る（戻り先つき）", async () => {
        render(<InvitePage />);
        const link = await screen.findByRole("link", { name: /ログインして参加/ });
        // **戻り先を渡す。** 渡さないと、ログインしたあと招待に帰れない
        expect(link.getAttribute("href")).toContain(`next=${encodeURIComponent(`/j?t=${"a".repeat(32)}`)}`);
    });

    it("見るだけならログインが要らないと伝える", async () => {
        render(<InvitePage />);
        expect(await screen.findByText(/見るだけならログインは要りません/)).toBeInTheDocument();
    });
});

describe("招待ページ: 断るとき", () => {
    // **理由をそのまま出す。** サーバーは期限切れ・取り消し・見つからないを
    // 書き分けている。同じ文言に潰すと、送り直せばよいのかが分からない
    it("サーバーの理由をそのまま出す", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: false, status: 410, _msg: "この招待リンクは期限が切れています" });
        render(<InvitePage />);
        expect(await screen.findByRole("alert")).toHaveTextContent("期限が切れています");
    });

    it("トークンが無ければ読みに行かない", async () => {
        q.t = "";
        render(<InvitePage />);
        expect(await screen.findByRole("alert")).toHaveTextContent("正しくありません");
        expect(mockUserPublicFetch).not.toHaveBeenCalled();
    });

    it("通信で落ちても画面は出る（真っ白にしない）", async () => {
        mockUserPublicFetch.mockRejectedValue(new Error("boom"));
        render(<InvitePage />);
        expect(await screen.findByRole("alert")).toBeInTheDocument();
    });
});

describe("招待ページ: 参加", () => {
    beforeEach(() => { auth.current = { isAuthenticated: true, loading: false }; });

    it("ログイン済みなら参加ボタンが出る", async () => {
        render(<InvitePage />);
        expect(await screen.findByRole("button", { name: /参加する/ })).toBeInTheDocument();
    });

    it("参加すると、写真を追加する導線が出る", async () => {
        render(<InvitePage />);
        await userEvent.click(await screen.findByRole("button", { name: /参加する/ }));
        const link = await screen.findByRole("link", { name: /写真を追加/ });
        // 行き先にアルバムを渡す（どのアルバムに足すかが決まっている）
        expect(link.getAttribute("href")).toContain("album=alb-1");
        expect(mockUserFetch).toHaveBeenCalledWith(
            `/invites/${"a".repeat(32)}/join`, expect.objectContaining({ method: "POST" }));
    });

    it("参加に失敗したら理由を出し、導線は出さない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 403, _msg: "このアルバムは50人までです" });
        render(<InvitePage />);
        await userEvent.click(await screen.findByRole("button", { name: /参加する/ }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("このアルバムは50人までです", "error"));
        expect(screen.queryByRole("link", { name: /写真を追加/ })).toBeNull();
    });
});
