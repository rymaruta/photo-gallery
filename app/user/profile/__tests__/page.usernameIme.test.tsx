import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **ユーザー名の欄が、IME の変換を毎打鍵で壊していた。**
//
// `onChange` が値をその場で `[^a-z0-9_]` を削った形に作り直すので、
// かな入力のままだと**打っても画面に何も出ない**（実ブラウザで
// `compositionstart` が1回であるべきところ4回になることを確認）。
// 利用者からは「入力できない欄」に見える。
// 変換中はそのまま見せ、確定した時点でふるいに掛ける。

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
const mockSearchSongs = vi.fn();
vi.mock("../../../../lib/utils/music", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/music")>("../../../../lib/utils/music");
    return { ...actual, searchSongs: mockSearchSongs };
});

const ProfilePage = (await import("../page")).default;

beforeEach(() => {
    mockUserFetch.mockReset();
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ username: "", displayName: "" }) });
    mockShowToast.mockReset();
    mockSearchSongs.mockReset();
});

async function openAndGetUsername() {
    render(<ProfilePage />);
    await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
    return await screen.findByPlaceholderText("travel_photo") as HTMLInputElement;
}

describe("ユーザー名の欄と IME", () => {
    it("変換中は書き換えない（打った文字がそのまま見える）", async () => {
        const input = await openAndGetUsername();
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: "たび" } });
        expect(input.value, "変換中に値を作り直している（変換が壊れる）").toBe("たび");
    });

    it("確定したらふるいに掛ける", async () => {
        const input = await openAndGetUsername();
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: "たびtabi" } });
        fireEvent.compositionEnd(input, { target: { value: "たびtabi" } });
        expect(input.value).toBe("tabi");
    });

    // 正常系: 変換していないときは今までどおり、その場でふるいに掛ける
    it("変換していない入力は今までどおり", async () => {
        const input = await openAndGetUsername();
        fireEvent.change(input, { target: { value: "Travel Photo!" } });
        expect(input.value).toBe("travelphoto");
    });

    // 確定したあとの入力も、また変換中と誤解しない
    it("確定後の入力もふるいに掛ける", async () => {
        const input = await openAndGetUsername();
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: "たび" } });
        fireEvent.compositionEnd(input, { target: { value: "たび" } });
        fireEvent.change(input, { target: { value: "TABI" } });
        expect(input.value).toBe("tabi");
    });
});

// **遅れて返った古い結果が、新しい結果を上書きしていた。**
//
// 画面には**打っていない語の検索結果**が出る。`StoriesBar` は世代で
// 追い越しを捨てる形を持っているのに、こちらとプロフィールには無かった
// （対の乖離）。IME で必ず2回走っていたぶん踏みやすかったが、
// 押し直しや遅い回線でも起きる。
describe("曲検索の追い越し", () => {
    it("古い応答は捨てる", async () => {
        render(<ProfilePage />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        const box = await screen.findByPlaceholderText("曲名・アーティスト名");

        // 1回目は遅く返る（あとで解決する）
        let resolveOld: (v: unknown) => void = () => { };
        mockSearchSongs.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
        fireEvent.change(box, { target: { value: "きょう" } });
        fireEvent.keyDown(box, { key: "Enter", keyCode: 13, isComposing: false });

        // 2回目はすぐ返る
        mockSearchSongs.mockResolvedValueOnce([
            { id: "new", title: "今日の歌", artist: "A", artworkUrl: "", previewUrl: "" },
        ]);
        fireEvent.change(box, { target: { value: "今日" } });
        fireEvent.keyDown(box, { key: "Enter", keyCode: 13, isComposing: false });
        expect(await screen.findByText("今日の歌")).toBeInTheDocument();

        // ここで1回目が返る。上書きしてはいけない
        resolveOld([{ id: "old", title: "きょうの歌", artist: "B", artworkUrl: "", previewUrl: "" }]);
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByText("きょうの歌"), "打っていない語の結果が出ている").toBeNull();
        expect(screen.getByText("今日の歌")).toBeInTheDocument();
    });
});
