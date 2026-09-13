import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * **同じ名前の欄が、写真の枚数ぶん並んでいた。**
 *
 * 写真ごとのタイトル・説明・撮影地には `<label>` が無く placeholder だけ。
 * placeholder は名前の最後の受け皿なので「無名」ではないが、2枚選ぶと
 * **「タイトル（任意）」という同じ名前の欄が2つ**になり、読み上げでは
 * どちらがどの写真か分からない（`/user/edit` の罪として挙げたのと同じ形が、
 * 枚数ぶんに増えた形）。取り消しボタンも全部「削除」で同じだった。
 *
 * 実測（この差分の前・jsdom で2枚選んで数えた）:
 *
 *     入力欄 8 → うち placeholder だけが名前 5
 *     「タイトル（任意）」が **2つ**（＝写真の枚数ぶん）
 *     aria-describedby は **0件**
 *
 * **見た目は変えない**（属性だけ）。見えるラベルを足すのはデザインの変更で、
 * それは owner の判断。
 */
const mockReverseGeocode = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());
const mockExtractExif = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedResult: async () => ({ ok: true, payload: await mockReadSharedPayload() }),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: mockExtractExif,
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: mockReverseGeocode,
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    mockReverseGeocode.mockReset().mockResolvedValue("");
    mockExtractExif.mockReset().mockResolvedValue({});
    mockReadSharedPayload.mockReset().mockResolvedValue(null);
    localStorage.clear();
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 読み上げが言う名前（label は付いていないので aria-label → placeholder の順） */
function accName(el: Element): string {
    return el.getAttribute("aria-label")
        || el.getAttribute("placeholder")
        || el.textContent?.trim()
        || "";
}

async function withPhotos(n: number) {
    const r = render(<UploadPage />);
    const file = r.container.querySelector("input[type=file]") as HTMLInputElement;
    const files = Array.from({ length: n }, (_, i) =>
        new File([String(i)], `p${i}.jpg`, { type: "image/jpeg" }));
    fireEvent.change(file, { target: { files } });
    await new Promise((res) => setTimeout(res, 300));
    return r.container;
}

describe("/user/upload: 写真ごとの欄は、何枚目かまで名乗る", () => {
    it("2枚選ぶと、同じ名前の欄が1つも無い", async () => {
        const container = await withPhotos(2);
        const names = [...container.querySelectorAll("input,textarea")].map(accName);
        const dup = names.filter((n, i) => n && names.indexOf(n) !== i);
        expect(dup, "同じ名前の欄が並んでいる（どちらの写真か分からない）").toEqual([]);
    });

    it("タイトル欄は「N枚目のタイトル」と名乗る", async () => {
        const container = await withPhotos(2);
        const names = [...container.querySelectorAll("input,textarea")].map(accName);
        expect(names).toContain("1枚目のタイトル");
        expect(names).toContain("2枚目のタイトル");
    });

    it("取り消しボタンも何枚目か言う", async () => {
        const container = await withPhotos(2);
        const labels = [...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
        expect(labels).toContain("1枚目を削除");
        expect(labels).toContain("2枚目を削除");
    });

    // **「全写真に適用」は見えている文にしか書いていなかった。**
    // 読み上げでは箱の外の独立した1文なので、中のカテゴリ・タグが
    // 「この1枚ぶん」なのか「全部ぶん」なのか分からない
    it("共通設定の箱は、その見出しで名前が付く", async () => {
        const container = await withPhotos(1);
        const group = container.querySelector('[role="group"][aria-labelledby]');
        expect(group, "共通設定が名前の付いた集まりになっていない").not.toBeNull();
        const id = group!.getAttribute("aria-labelledby")!;
        expect(container.querySelector(`#${CSS.escape(id)}`)?.textContent)
            .toContain("全写真に適用");
    });

    // 1枚のときも番号を付ける（2枚目を足した瞬間に名前が変わらないように）
    it("1枚でも番号を付ける", async () => {
        const container = await withPhotos(1);
        const names = [...container.querySelectorAll("input,textarea")].map(accName);
        expect(names).toContain("1枚目のタイトル");
    });

    // 検出器の自己確認: 同じ名前が並べば拾えること
    it("検出器は、同じ名前が並んだら拾う", () => {
        const host = document.createElement("div");
        host.innerHTML = `<input aria-label="A"><input aria-label="A"><input placeholder="B">`;
        const names = [...host.querySelectorAll("input,textarea")].map(accName);
        expect(names.filter((n, i) => n && names.indexOf(n) !== i)).toEqual(["A"]);
    });
});
