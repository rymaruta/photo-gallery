import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **打ちかけがあるときは送り返さない**（`useMemberGate` の性質）。
// `/user/profile` で同じものを直した回に、この画面を取りこぼしていた
// ——「横断で探した」と書いておきながら3件目を見落としていた。
//
// **そして直した回に、今度は「画面も出す」を落とした。**
// `gate !== "ok"` でスピナーに落としていたので、送り返さなくても
// **見えないまま止まる**だけだった（`/user/upload:1016` のコメントが
// この形を名指しで戒めている）。
//
// **`useMemberGate` をモックしない。** 既存の `page.test.tsx` は
// あちらをモックしているので、引数を渡したかどうかは原理的に観測できない。
// `useAuth` を差し替えて本物の門を通す。

const mockShowToast = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AlbumsPage = (await import("../page")).default;

const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));
/** 種別まで見る（`/user/edit` の `typed()` と同じ形。緑で出していないこと） */
const typed = () => mockShowToast.mock.calls.map((c) => `${String(c[1] ?? "")}:${String(c[0])}`);

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockShowToast.mockReset();
    mockReplace.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ albums: [] }) });
});

/** 読み込み終わりまで待って、新しいアルバム名を打つ */
async function typeNewAlbumName() {
    const { rerender } = render(<AlbumsPage />);
    const input = await screen.findByPlaceholderText("例: 北欧の冬");
    await userEvent.type(input, "石垣島の3日間");
    return rerender;
}

describe("共同アルバム: ログインが切れたときに打ちかけを守る", () => {
    it("打ちかけがあれば送り返さず、画面も消さない", async () => {
        const rerender = await typeNewAlbumName();

        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(toasts().some((t) => t.includes("保存できません"))).toBe(true));
        // **文言と種別まで見る**（`/user/edit` は `error:` 接頭辞まで見ている）。
        // 「別のタブでログインし直してから」は**唯一の対処法**なので落とさない
        expect(typed().some((t) => t.startsWith("error:")), "知らせを緑で出している").toBe(true);
        expect(toasts()[0], "何が起きたか言っていない").toContain("ログインが切れました");
        expect(toasts()[0], "唯一の対処法が落ちている").toContain("別のタブで");
        expect(mockReplace, "打ちかけごと画面を作り直している").not.toHaveBeenCalled();
        // **スピナーに落とさない**——見えないまま止まるのは送り返すのと同じ
        expect(screen.getByDisplayValue("石垣島の3日間"), "打った名前が画面から消えている").toBeInTheDocument();
    });

    // **改名欄も打って入れる欄。** 新規名の分しか打っていなかったので、
    // `hasUnsavedWork` から改名の項を丸ごと削除しても緑だった
    // （前のコミットが「新規アルバム名と改名の欄」と書いて直した、その片方）
    it("改名の途中でも、送り返さず画面も消さない", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true, json: async () => ({ albums: [{ id: "a1", title: "北欧の冬", photoIds: [], memberIds: [] }] }),
        });
        const { rerender } = render(<AlbumsPage />);
        await userEvent.click(await screen.findByRole("button", { name: "名前を変える" }));
        const input = await screen.findByDisplayValue("北欧の冬");
        await userEvent.clear(input);
        await userEvent.type(input, "北欧の冬 2026");

        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(toasts().some((t) => t.includes("保存できません"))).toBe(true));
        expect(mockReplace, "打ちかけごと画面を作り直している").not.toHaveBeenCalled();
        expect(screen.getByDisplayValue("北欧の冬 2026"), "打った名前が画面から消えている").toBeInTheDocument();
    });

    // **開いただけは打ちかけに数えない**（元の名前がそのまま入る）
    it("改名を開いただけなら、今までどおり送り返す", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true, json: async () => ({ albums: [{ id: "a1", title: "北欧の冬", photoIds: [], memberIds: [] }] }),
        });
        const { rerender } = render(<AlbumsPage />);
        await userEvent.click(await screen.findByRole("button", { name: "名前を変える" }));
        await screen.findByDisplayValue("北欧の冬");

        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(mockReplace, "開いただけで留まり続けている").toHaveBeenCalled());
    });

    // **ログインしているが権限が無い人に、ログインの話をしない。**
    // `/user/edit` が同じテストを持ち、そのコメントに「この campaign で
    // 3回出ている」と書いてある——**4回目をやった**。
    // `no-group` は再ログインでも直らない（`useMemberGate` の doc）ので、
    // 「別のタブでログインし直して」は絶対に効かない対処法になる
    it("権限が無いだけの人には、ログインの話をしない", async () => {
        const rerender = await typeNewAlbumName();

        authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: false, loading: false };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(screen.queryByDisplayValue("石垣島の3日間")).toBeNull());
        expect(toasts().some((t) => t.includes("ログインが切れました")),
            "権限の話とログインの話を混ぜている").toBe(false);
    });

    // 判定中も同じ（まだ分からないうちに「切れました」と言わない）
    it("判定中には、ログインの話をしない", async () => {
        const rerender = await typeNewAlbumName();

        authState.current = { ...authState.current, isAuthenticated: false, loading: true };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(toasts().some((t) => t.includes("ログインが切れました")),
            "まだ分からないのに切れたと言っている").toBe(false);
    });

    // **留めすぎない。** 打ちかけが無ければ今までどおり送り返す
    it("打ちかけが無ければ、今までどおり送り返す", async () => {
        render(<AlbumsPage />);
        await screen.findByPlaceholderText("例: 北欧の冬");

        authState.current = { ...authState.current, isAuthenticated: false };
        render(<AlbumsPage />);

        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
    });

    // **二度目を無言にしない**（他の3画面と同じ理由で札を下ろす）
    it("ログインし直してまた切れたら、もう一度言う", async () => {
        const rerender = await typeNewAlbumName();

        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);
        await waitFor(() => expect(toasts().filter((t) => t.includes("保存できません"))).toHaveLength(1));

        authState.current = { ...authState.current, isAuthenticated: true };
        rerender(<AlbumsPage />);
        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(
            toasts().filter((t) => t.includes("保存できません")),
            "二度目が無言になっている",
        ).toHaveLength(2));
    });
});
