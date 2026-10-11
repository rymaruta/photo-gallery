import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **カバー写真の変更と居住地の編集**（2026-10-11 owner・板 ProfileEdit）。
// - カバーはアイコンと同じ流れ（`toUploadSafeFile` → presign → S3 に PUT）で、
//   presign に **`type: "cover"`** を付ける（無いとアイコンの置き場 `profiles/<uid>` に上がる）
// - アイコンの presign には `type` を付けない（今までどおり）
// - 居住地は変えたときだけ `PUT /user/profile` に `homeLocation` を載せる

const mockShowToast = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockSafe = vi.hoisted(() => vi.fn<(f: File, maxPx?: number) => Promise<File>>(async (f) => f));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
let mockLocale = "ja";
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: mockLocale }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: (...a: unknown[]) => mockSafe(...(a as [File, number])),
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512, COVER_MAX_PX: 1280,
}));

const ProfilePage = (await import("../page")).default;

const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは", homeLocation: "東京" };
const jpg = () => new File(["x"], "sea.jpg", { type: "image/jpeg" });
const mockFetch = vi.fn();

beforeEach(() => {
    mockLocale = "ja";
    mockShowToast.mockReset();
    mockSafe.mockReset().mockImplementation(async (f: File) => f);
    mockUserFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/profile/avatar/presigned-url") {
            return { ok: true, json: async () => ({ presignedUrl: "https://s3.test/put", contentType: "image/jpeg" }) };
        }
        if (url === "/user/profile" && init?.method === "PUT") {
            return { ok: true, json: async () => ({ ...STORED, ...JSON.parse(String(init.body)) }) };
        }
        return { ok: true, json: async () => STORED };
    });
    mockFetch.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

const presignBodies = () => mockUserFetch.mock.calls
    .filter((c) => c[0] === "/profile/avatar/presigned-url")
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);

async function upload(idx: number) {
    const { container } = render(<ProfilePage />);
    await screen.findByDisplayValue("こんにちは");
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs.length).toBe(2);
    await userEvent.upload(inputs[idx], jpg());
    return container;
}

describe("カバー写真を変える", () => {
    it("presign に type: \"cover\" を付け、S3 に no-store で PUT し、カバーの文言で知らせる", async () => {
        await upload(0);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("カバー写真を更新しました", "success"));
        expect(presignBodies()).toEqual([{ fileType: "image/jpeg", type: "cover" }]);
        // カバーの大きさで縮める（アイコンの 512 ではない）
        expect(mockSafe.mock.calls[0][1]).toBe(1280);
        expect(mockFetch).toHaveBeenCalledWith("https://s3.test/put", expect.objectContaining({
            method: "PUT",
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
        }));
    });

    it("アイコンの presign には type を付けない（今までどおり）", async () => {
        await upload(1);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("プロフィール写真を更新しました", "success"));
        expect(presignBodies()).toEqual([{ fileType: "image/jpeg" }]);
        expect(mockSafe.mock.calls[0][1]).toBe(512);
    });

    it("英語の画面では、アイコン・カバーの成功と失敗の文言も英語", async () => {
        mockLocale = "en";
        await upload(1);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("Profile photo updated", "success"));
        mockShowToast.mockReset();
        mockFetch.mockResolvedValue({ ok: false });
        const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
        await userEvent.upload(inputs[1], jpg());
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("Couldn't upload the profile photo", "error"));
        mockShowToast.mockReset();
        await userEvent.upload(inputs[0], jpg());
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("Couldn't upload the cover photo", "error"));
    });

    it("「カバーを変える」は 44px で押せる", async () => {
        render(<ProfilePage />);
        const btn = await screen.findByRole("button", { name: /カバーを変える/ });
        expect(btn.style.minHeight).toBe("44px");
    });
});

describe("居住地", () => {
    it("読み込んだ値を欄に出し、変えたら homeLocation だけを送る", async () => {
        render(<ProfilePage />);
        const field = await screen.findByLabelText("居住地");
        expect((field as HTMLInputElement).value).toBe("東京");
        expect(field.getAttribute("maxLength")).toBe("60");
        await userEvent.clear(field);
        await userEvent.type(field, "札幌");
        await userEvent.click(screen.getByRole("button", { name: /保存/ }));
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "PUT")).toBe(true));
        const put = mockUserFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")!;
        expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ homeLocation: "札幌" });
    });

    it("空にしたら空文字を送る（消せる）", async () => {
        render(<ProfilePage />);
        const field = await screen.findByLabelText("居住地");
        await userEvent.clear(field);
        await userEvent.click(screen.getByRole("button", { name: /保存/ }));
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "PUT")).toBe(true));
        const put = mockUserFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")!;
        expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ homeLocation: "" });
    });
});
