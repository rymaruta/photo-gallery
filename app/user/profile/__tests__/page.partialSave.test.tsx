import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// プロフィール編集は「開いた時点の値」を毎回まるごと PUT していた。
// サーバーは rev で競合を見ているが、rev が守れるのは「送っていない項目」だけ。
// 同じ画面を PC とスマホで開き、片方で自己紹介を直したあと、
// もう片方でテーマ色だけ変えて保存すると、**自己紹介が元に戻った**。
// 変えた項目だけ送れば、触っていない項目は上書きされない。

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja" }),
}));
vi.mock("../../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
}));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512,
    COVER_MAX_PX: 1280,
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));

const ProfilePage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });

/** 保存された PUT の body */
function savedBody(): Record<string, unknown> {
    const put = mockUserFetch.mock.calls.find((c) => c[1]?.method === "PUT");
    if (!put) throw new Error("PUT が投げられていない");
    return JSON.parse(put[1].body as string) as Record<string, unknown>;
}

const STORED = {
    userId: "u1",
    username: "tabibito",
    displayName: "旅人",
    bio: "こんにちは",
    instagram: "tabi",
    website: "https://example.com",
    themeColor: "#38bdf8",
};

async function openLoaded(stored: Record<string, unknown> = STORED) {
    mockUserFetch
        .mockResolvedValueOnce(ok(stored))
        .mockResolvedValueOnce(ok({}));
    render(<ProfilePage />);
    await screen.findByDisplayValue(String(stored.displayName ?? "旅人"));
}

const save = async () => {
    await userEvent.click(await screen.findByRole("button", { name: /保存/ }));
    await waitFor(() => expect(mockUserFetch).toHaveBeenCalledTimes(2));
};

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
});

describe("プロフィール編集: 変えた項目だけ送る", () => {
    it("何も変えずに保存しても、項目を1つも送らない", async () => {
        await openLoaded();
        await save();
        expect(savedBody()).toEqual({});
    });

    it("自己紹介だけ直したら、送るのは bio だけ（表示名を巻き戻さない）", async () => {
        await openLoaded();
        const bio = screen.getByDisplayValue("こんにちは");
        await userEvent.clear(bio);
        await userEvent.type(bio, "旅の記録");
        await save();

        const body = savedBody();
        expect(body).toEqual({ bio: "旅の記録" });
        // 別タブで変わっているかもしれない項目に触っていない
        expect(body).not.toHaveProperty("displayName");
        expect(body).not.toHaveProperty("username");
        expect(body).not.toHaveProperty("themeColor");
    });

    it("読み込めた値と同じ文字を打ち直しただけなら送らない", async () => {
        await openLoaded();
        const bio = screen.getByDisplayValue("こんにちは");
        await userEvent.clear(bio);
        await userEvent.type(bio, "こんにちは");
        await save();
        expect(savedBody()).toEqual({});
    });

    it("保存済みの項目を空にした回は、その項目を空で送る（消せる）", async () => {
        await openLoaded();
        await userEvent.clear(screen.getByDisplayValue("こんにちは"));
        await save();
        expect(savedBody()).toEqual({ bio: "" });
    });
});

describe("プロフィール編集: 貼付リンクの曲は3つ一緒に送る", () => {
    const withSong = {
        ...STORED,
        songUrl: "https://youtu.be/abc12345678",
        songStart: 30,
        songEnd: 90,
    };

    it("開始位置だけ変えても、songUrl と songEnd を添える", async () => {
        await openLoaded(withSong);
        const start = await screen.findByDisplayValue("0:30");
        await userEvent.clear(start);
        await userEvent.type(start, "0:45");
        await save();

        const body = savedBody();
        // サーバーは songUrl を送った回だけ位置を触る（E-4）
        expect(body.songUrl).toBe("https://youtu.be/abc12345678");
        expect(body.songStart).toBe(45);
        expect(body.songEnd).toBe(90);
    });

    it("曲を何も触らなければ、3つとも送らない", async () => {
        await openLoaded(withSong);
        await save();
        const body = savedBody();
        expect(body).not.toHaveProperty("songUrl");
        expect(body).not.toHaveProperty("songStart");
        expect(body).not.toHaveProperty("songEnd");
    });
});
