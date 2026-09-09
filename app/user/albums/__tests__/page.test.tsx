import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 共同アルバムの管理画面（案C）。作る・招待リンクを配る・取り消す。
//
// ここで固定するのは:
//   - **招待リンクがそのまま読める形で出ること**（配れないと意味が無い）
//   - **作り直すと前のリンクが死ぬことを画面に書くこと**（書かないと、
//     配ったリンクが黙って切れる）
//   - 断るときはサーバーの理由を出すこと

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ current: "ok" as string }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/hooks/useMemberGate", () => ({ useMemberGate: () => gate.current }));
vi.mock("../../../components/MemberOnlyNotice", () => ({ default: () => <p>会員限定</p> }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (r: Response, f: string) => (r as unknown as { _msg?: string })._msg ?? f,
}));
vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const AlbumsPage = (await import("../page")).default;

const album = (extra: Record<string, unknown> = {}) => ({
    id: "alb-1", title: "北欧の冬", memberCount: 2, ...extra,
});

beforeEach(() => {
    gate.current = "ok";
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ albums: [album()] }) });
});

describe("アルバムの一覧", () => {
    it("自分のアルバムが出る", async () => {
        render(<AlbumsPage />);
        expect(await screen.findByText("北欧の冬")).toBeInTheDocument();
        expect(screen.getByText(/2人が参加/)).toBeInTheDocument();
    });

    it("1つも無ければそう言う", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ albums: [] }) });
        render(<AlbumsPage />);
        expect(await screen.findByText(/まだアルバムがありません/)).toBeInTheDocument();
    });

    // 読めなかったことを「0件」と同じ顔で出さない（このリポジトリの型 0d）
    it("読めなかったら理由を出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, _msg: "アルバムを読み込めませんでした" });
        render(<AlbumsPage />);
        expect(await screen.findByRole("alert")).toHaveTextContent("読み込めませんでした");
    });

    it("会員でなければ案内を出す", () => {
        gate.current = "no-group";
        render(<AlbumsPage />);
        expect(screen.getByText("会員限定")).toBeInTheDocument();
    });
});

describe("招待リンク", () => {
    it("そのまま配れる形で出る", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ albums: [album({ inviteToken: "a".repeat(32) })] }),
        });
        render(<AlbumsPage />);
        // **`/j?t=` の形はサーバーと画面で対。** ここが違うと配ったリンクが開かない
        expect(await screen.findByText(new RegExp(`/j\\?t=${"a".repeat(32)}`))).toBeInTheDocument();
    });

    // **書かないと、配ったリンクが黙って切れる**
    it("作り直すと前のリンクが死ぬことを書く", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ albums: [album({ inviteToken: "a".repeat(32) })] }),
        });
        render(<AlbumsPage />);
        expect(await screen.findByText(/前のリンクは使えなくなります/)).toBeInTheDocument();
    });

    it("まだ無ければ「作る」を出す", async () => {
        render(<AlbumsPage />);
        expect(await screen.findByRole("button", { name: "招待リンクを作る" })).toBeInTheDocument();
    });

    it("作ると発行の口を叩き、一覧を取り直す", async () => {
        render(<AlbumsPage />);
        await userEvent.click(await screen.findByRole("button", { name: "招待リンクを作る" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith(
            "/albums/alb-1/invite", expect.objectContaining({ method: "POST" })));
    });

    it("取り消すと DELETE を叩く", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ albums: [album({ inviteToken: "a".repeat(32) })] }),
        });
        render(<AlbumsPage />);
        await userEvent.click(await screen.findByRole("button", { name: "取り消す" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith(
            "/albums/alb-1/invite", expect.objectContaining({ method: "DELETE" })));
    });
});

describe("アルバムを作る", () => {
    it("名前を入れて作ると POST /albums を叩く", async () => {
        render(<AlbumsPage />);
        await userEvent.type(await screen.findByLabelText("アルバムの名前"), "夏の旅");
        await userEvent.click(screen.getByRole("button", { name: "作る" }));
        await waitFor(() => {
            const call = mockUserFetch.mock.calls.find((c) => c[0] === "/albums" && c[1]?.method === "POST");
            expect(call, "作る口を叩いていない").toBeTruthy();
            expect(JSON.parse(call![1].body).title).toBe("夏の旅");
        });
    });

    it("名前が空なら叩かない", async () => {
        render(<AlbumsPage />);
        await screen.findByRole("button", { name: "作る" });
        mockUserFetch.mockClear();
        await userEvent.click(screen.getByRole("button", { name: "作る" }));
        expect(mockUserFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    });

    // 上限に達したときの理由（サーバーが書き分けている）を潰さない
    it("断られたら理由を出す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) =>
            Promise.resolve(init?.method === "POST"
                ? { ok: false, status: 403, _msg: "アルバムは50個までです" }
                : { ok: true, json: async () => ({ albums: [] }) }));
        render(<AlbumsPage />);
        await userEvent.type(await screen.findByLabelText("アルバムの名前"), "51個目");
        await userEvent.click(screen.getByRole("button", { name: "作る" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("アルバムは50個までです", "error"));
    });
});
