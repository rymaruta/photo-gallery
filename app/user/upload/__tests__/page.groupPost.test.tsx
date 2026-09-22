import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PHOTO_IMAGES_MAX, PHOTO_LIMIT_PER_USER } from "../../../../lib/utils/uploadLimits";

/**
 * **1投稿に複数枚**（owner のモックの「1/10」）。
 *
 * 既定は今までどおり「N枚選ぶ → N件の投稿」。まとめる指定をしたときだけ、
 * 1枚目が表紙・残りが `extraImages` の**1件**になる。
 *
 * サーバー側の検証は `api-user/src/__tests__/photoImages.test.ts` が見る。
 * ここは**画面が何を送るか**と、上限の扱い。
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(q.search),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedResult: vi.fn(async () => ({ ok: true, payload: null })),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => "#112233"),
    createBlurPlaceholder: vi.fn(async () => "data:image/webp;base64,UklGRg=="),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

/** `/upload/save` に送った本文（全部） */
function savedBodies(): Record<string, unknown>[] {
    return mockUserFetch.mock.calls
        .filter((c) => c[0] === "/upload/save")
        .map((c) => JSON.parse((c[1] as { body: string }).body));
}

/** presign は呼ばれた順に別のキーを返す（同じキーだと重複で落ちる） */
let presignSeq = 0;

beforeEach(() => {
    q.search = "";
    presignSeq = 0;
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        if (url === "/upload/presigned-url") {
            const n = presignSeq++;
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    presignedUrl: "https://s3/put",
                    publicUrl: `https://cdn/uploads/me/p${n}.jpg`,
                    key: `uploads/me/p${n}.jpg`,
                }),
            });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
});

/** N 枚選ぶ */
async function pick(container: HTMLElement, n: number) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, Array.from({ length: n },
        (_, i) => new File(["x"], `p${i}.jpg`, { type: "image/jpeg" })));
    await screen.findByRole("button", { name: /投稿する/ });
}

const groupBox = () => screen.queryByRole("checkbox", { name: /1件の投稿にまとめる/ });

async function publish() {
    const btn = await screen.findByRole("button", { name: /投稿する/ });
    await waitFor(() => expect(btn).not.toBeDisabled());
    await userEvent.click(btn);
    await waitFor(() => expect(savedBodies().length, "保存に届いていない").toBeGreaterThan(0));
}

describe("1件の投稿にまとめる", () => {
    it("1枚しか無いときは、まとめる指定を出さない（押せる物を増やさない）", async () => {
        const { container } = render(<UploadPage />);
        await pick(container, 1);
        expect(groupBox()).toBeNull();
    });

    it("2枚以上あれば出る。既定はオフ", async () => {
        const { container } = render(<UploadPage />);
        await pick(container, 2);
        expect(groupBox()).not.toBeNull();
        expect(groupBox()).not.toBeChecked();
    });

    it("🔴 既定（オフ）は今までどおり、1枚ずつ別々の投稿になる", async () => {
        const { container } = render(<UploadPage />);
        await pick(container, 3);
        await publish();
        await waitFor(() => expect(savedBodies()).toHaveLength(3));
        for (const b of savedBodies()) expect("extraImages" in b, "まとめていないのに載せている").toBe(false);
    });

    it("🔴 オンなら、保存は1回。1枚目が表紙で残りが extraImages", async () => {
        const { container } = render(<UploadPage />);
        await pick(container, 3);
        await userEvent.click(groupBox()!);
        await publish();
        await waitFor(() => expect(savedBodies()).toHaveLength(1));
        const b = savedBodies()[0];
        expect(b.publicUrl, "1枚目が表紙になっていない").toBe("https://cdn/uploads/me/p0.jpg");
        expect(b.key).toBe("uploads/me/p0.jpg");
        expect((b.extraImages as Array<{ src: string }>).map((i) => i.src)).toEqual([
            "https://cdn/uploads/me/p1.jpg",
            "https://cdn/uploads/me/p2.jpg",
        ]);
    });

    it("2枚目以降にも鍵・代表色・ぼかしを載せる（1枚目だけ blur-up しない）", async () => {
        const { container } = render(<UploadPage />);
        await pick(container, 2);
        await userEvent.click(groupBox()!);
        await publish();
        const extra = (savedBodies()[0].extraImages as Array<Record<string, unknown>>)[0];
        expect(extra.key).toBe("uploads/me/p1.jpg");
        expect(extra.dominantColor).toBe("#112233");
        expect(extra.blurDataURL).toBe("data:image/webp;base64,UklGRg==");
    });

    it(`🔴 ${PHOTO_IMAGES_MAX}枚を超えたら、まとめられないと言って押させない`, async () => {
        const { container } = render(<UploadPage />);
        await pick(container, PHOTO_IMAGES_MAX + 1);
        expect(groupBox()).toBeDisabled();
        expect(screen.getByText(new RegExp(`${PHOTO_IMAGES_MAX}枚までです`))).toBeTruthy();
    });

    it(`🔴 上限を超えていたら、指定が残っていても1枚ずつにする（黙って${PHOTO_IMAGES_MAX}枚に切らない）`, async () => {
        const { container } = render(<UploadPage />);
        // 2枚のうちに押してから、上限を超えるまで足す
        await pick(container, 2);
        await userEvent.click(groupBox()!);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, Array.from({ length: PHOTO_IMAGES_MAX },
            (_, i) => new File(["x"], `more${i}.jpg`, { type: "image/jpeg" })));
        await publish();
        // まとめず1枚ずつ＝保存の回数が枚数ぶん
        await waitFor(() => expect(savedBodies().length).toBe(PHOTO_IMAGES_MAX + 2));
    });

    // 🔴 **半端な枚数で1件できると「やめた」のに投稿が世に出る。**
    // 上げ終わったぶんは控えてあるので、押し直せば使い回せる
    it("🔴 途中でやめたら、まとめた保存をしない", async () => {
        // 2枚目の PUT が返らない回線。1枚目は S3 に上がっている
        let puts = 0;
        vi.stubGlobal("fetch", vi.fn((_u: string, init?: { signal?: AbortSignal }) => {
            if (puts++ === 0) return Promise.resolve({ ok: true, status: 200 });
            return new Promise((_res, reject) => {
                if (init?.signal?.aborted) reject(new DOMException("cancelled", "AbortError"));
                init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
            });
        }));
        const { container } = render(<UploadPage />);
        await pick(container, 3);
        await userEvent.click(groupBox()!);
        const btn = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(btn).not.toBeDisabled());
        await userEvent.click(btn);

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(screen.getByRole("button", { name: /投稿する/ })).not.toBeDisabled());
        expect(savedBodies(), "やめたのに投稿が1件できている").toHaveLength(0);
    });

    // 🔴 投稿が1件なら、枠（1000枚）も1件ぶんしか減らない。枚数ぶん引くと
    // 「あと N 枚」が実際より少なく出て、まだ上げられるのに諦めさせる
    it("🔴 まとめた回は、残り枚数が1件ぶんしか減らない", async () => {
        const { container } = render(<UploadPage />);
        await pick(container, 3);
        await userEvent.click(groupBox()!);
        await publish();
        await waitFor(() => expect(
            screen.getByText(new RegExp(`あと${PHOTO_LIMIT_PER_USER - 1}枚`)),
            "枚数ぶん引いている（投稿は1件しかできていない）",
        ).toBeTruthy());
    });

    it("まとめた回のトーストは「1件の投稿」と言う（枠も1件しか減らない）", async () => {
        const { container } = render(<UploadPage />);
        await pick(container, 2);
        await userEvent.click(groupBox()!);
        await publish();
        await waitFor(() => expect(
            mockShowToast.mock.calls.some(([m]) => typeof m === "string" && m.includes("1件の投稿")),
            "「N枚アップロードしました」だと N 件できたように読める",
        ).toBe(true));
    });
});
