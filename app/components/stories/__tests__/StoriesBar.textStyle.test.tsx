import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * ストーリーの文字を、好きな場所に・好きな字体と色で置く。
 *
 * owner:「インスタみたいにストーリーで好きな場所で文字打てるようにしたい。
 * フォントの種類や色も豊富にしたい」
 *
 * **文言は `caption` のまま**——ここが足したのは見せ方だけなので、
 * 残したときの題（`storyKeep.ts`）も検索に出る文章も変わらない。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockExtract = vi.hoisted(() => vi.fn());
const mockReverse = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_r: unknown, f: string) => f,
}));
// 画像の縮小は canvas を使うので jsdom では通らない。ここで見たいのは
// 「撮影地が投稿に載るか」なので素通しにする（他の StoriesBar のテストと同じ）
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    compressImage: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));
// 動画の位置除去は本物を通すと jsdom で走らない。ここで見たいのは
// 「動画には撮影地の欄を出さない」なので素通しにする
vi.mock("@/lib/utils/video", () => ({ toUploadSafeVideo: async (f: File) => f }));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: (f: File) => mockExtract(f),
    reverseGeocode: (...a: unknown[]) => mockReverse(...a),
    extractCameraExif: vi.fn(),
}));

import StoriesBar from "../StoriesBar";

const api = () => async (url: string, init?: { method?: string; body?: string }) => {
    if (url === "/stories" && init?.method === "POST") return { ok: true, json: async () => ({ success: true }) };
    if (url.startsWith("/presigned-url")) return { ok: true, json: async () => ({ uploadUrl: "https://s3/put", key: "uploads/me/s.webp", publicUrl: "https://cdn/uploads/me/s.webp" }) };
    if (url === "/stories") return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
};
/** POST /stories の本文 */
const posted = () => mockUserFetch.mock.calls
    .filter((c) => c[0] === "/stories" && (c[1] as { method?: string })?.method === "POST")
    .map((c) => JSON.parse((c[1] as { body: string }).body));

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation(api());
    mockExtract.mockReset().mockResolvedValue({});
    mockReverse.mockReset().mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    localStorage.clear();
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 画像を1枚選んで、下書きが開くまで待つ */

/** 画像を1枚選んで、下書きが開くまで待つ */
async function pickImage() {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["img"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
}

/** 写真の上に出ている文字（下の入力欄ではなく、置いた方） */
const overlay = () => document.querySelector('[role="dialog"] p[style*="translate"]') as HTMLElement | null;
const type = async (text: string) => {
    await userEvent.type(screen.getByPlaceholderText(/キャプション/), text);
};

describe("ストーリーの文字", () => {
    // **打ってから出す。** 文字が無いうちは動かすものも飾るものも無い
    it("文言が無いうちは、見せ方の欄を出さない", async () => {
        await pickImage();
        expect(screen.queryByRole("switch", { name: "明朝" }), "打つ前から字体の欄が出ている").toBeNull();
        expect(overlay(), "文字が無いのに写真の上に何か出ている").toBeNull();
    });

    it("打つと、写真の上に出て見せ方を選べる", async () => {
        await pickImage();
        await type("朝の空");
        expect(overlay()?.textContent).toBe("朝の空");
        expect(screen.getByRole("switch", { name: "明朝" })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "空" })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "塗り" })).toBeInTheDocument();
    });

    it("字体を選ぶと、写真の上の文字が変わる", async () => {
        await pickImage();
        await type("朝の空");
        expect(overlay()?.style.fontFamily).toContain("Hiragino Sans");
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        expect(overlay()?.style.fontFamily, "選んでも字体が変わらない").toContain("Hiragino Mincho ProN");
        expect(screen.getByRole("switch", { name: "明朝" })).toHaveAttribute("aria-checked", "true");
    });

    it("色と下地と大きさを選べる", async () => {
        await pickImage();
        await type("朝の空");
        await userEvent.click(screen.getByRole("switch", { name: "黄" }));
        expect(overlay()?.style.color).toBe("rgb(255, 214, 10)");

        await userEvent.click(screen.getByRole("switch", { name: "塗り" }));
        // 塗りでは、選んだ色が下地になり文字が反転する
        expect(overlay()?.style.background).toBe("rgb(255, 214, 10)");
        expect(overlay()?.style.color).toBe("rgb(0, 0, 0)");

        const before = overlay()?.style.fontSize;
        await userEvent.click(screen.getByRole("switch", { name: "大きさ 1" }));
        expect(overlay()?.style.fontSize, "大きさが変わらない").not.toBe(before);
    });

    it("投稿に見せ方が載る（文言は caption のまま）", async () => {
        await pickImage();
        await type("朝の空");
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        await userEvent.click(screen.getByRole("switch", { name: "桃" }));
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        const body = posted()[0];
        expect(body.caption, "文言が caption から消えている").toBe("朝の空");
        expect(body.textStyle).toMatchObject({ font: "mincho", color: "pink" });
        expect(typeof body.textStyle.x).toBe("number");
        expect(typeof body.textStyle.y).toBe("number");
    });

    // **文言が無ければ見せ方も送らない。** 置き場所だけの項目を作らない
    it("文言が無ければ、見せ方も送らない", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        expect("textStyle" in posted()[0], "文言が無いのに見せ方を送っている").toBe(false);
    });

    // 開き直したときに前の見せ方を持ち越さない
    it("下書きを閉じると見せ方も戻る", async () => {
        await pickImage();
        await type("朝の空");
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["img"], "b.jpg", { type: "image/jpeg" }));
        await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
        await type("次の一枚");
        expect(screen.getByRole("switch", { name: "明朝" }), "前の字体が残っている").toHaveAttribute("aria-checked", "false");
    });
});
