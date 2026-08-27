import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 投稿は「S3 に上げる → DynamoDB に書く」の2段。保存に失敗した項目を
// そのまま捨てると**実体だけが S3 に残る**。どの削除経路も DynamoDB の
// 項目からキーを引くので、項目の無いオブジェクトには誰も手が届かない
// ——退会しても、写真を消しても残り続ける（原本は GPS 入りのまま
// 公開URLで取れる）。捨てるときに DELETE /upload/discard を叩く。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("from=share"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedPayload: mockReadSharedPayload,
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),        // サムネは作らない（本体のキーだけを見る）
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

const UploadPage = (await import("../page")).default;

const KEY = "uploads/me/abc.jpg";
const PUBLIC_URL = `https://cdn.example.com/${KEY}`;

/** 保存だけ失敗させる。presign と S3 の PUT は成功させる */
function apiThatFailsSave() {
    return (url: string) => {
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }),
            });
        }
        if (url === "/upload/save") {
            return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "保存できませんでした" }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    };
}

const discardCalls = () => mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/discard");

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation(apiThatFailsSave());
    mockReadSharedPayload.mockReset().mockResolvedValue({
        files: [new File(["x"], "shared.jpg", { type: "image/jpeg" })], title: "", text: "", t: Date.now(),
    });
    // S3 への PUT は素の fetch
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 共有シート経由の1枚を、保存失敗まで進める */
async function uploadAndFail() {
    render(<UploadPage />);
    const publish = await screen.findByRole("button", { name: /枚を公開/ });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await userEvent.click(publish);
    // S3 には上がったが保存で落ちた状態
    await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));
}

describe("保存に失敗した項目を捨てるとき", () => {
    it("S3 に上がったキーを消しに行く（孤児を残さない）", async () => {
        await uploadAndFail();
        expect(discardCalls()).toHaveLength(0);   // 捨てるまでは消さない

        await userEvent.click(await screen.findByRole("button", { name: "削除" }));

        await waitFor(() => expect(discardCalls()).toHaveLength(1));
        const [, init] = discardCalls()[0] as [string, { method: string; body: string }];
        expect(init.method).toBe("DELETE");
        expect(JSON.parse(init.body)).toEqual({ key: KEY });
    });

    // 連打しても DELETE は1回。updater の中で `prev` を見ているので、
    // 2回目は項目が見つからず投げない（この性質があるので、副作用を
    // updater の外に出す「規約どおりの直し方」は逆効果になる）。
    it("削除を連打しても DELETE は1回", async () => {
        await uploadAndFail();
        const btn = await screen.findByRole("button", { name: "削除" });
        await userEvent.click(btn);
        await userEvent.click(btn).catch(() => { /* 消えていれば押せない */ });

        await waitFor(() => expect(discardCalls().length).toBeGreaterThan(0));
        await new Promise((r) => setTimeout(r, 30));
        expect(discardCalls()).toHaveLength(1);
    });

    it("保存まで通った項目のキーは消さない（写真が使っている）", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/upload/presigned-url") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        });
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));

        await userEvent.click(await screen.findByRole("button", { name: "削除" }));
        await new Promise((r) => setTimeout(r, 20));
        expect(discardCalls()).toHaveLength(0);
    });
});
