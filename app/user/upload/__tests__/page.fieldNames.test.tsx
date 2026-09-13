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

/**
 * 読み上げが言う名前。**`<label>` も見る。**
 *
 * 最初 `aria-label` → `placeholder` → 中の文字 だけを見ていたが、この画面には
 * `<label>` で名前が付いている欄がある（写真を選ぶ3つと GPS のチェック）。
 * 見落とすとそれらの名前が `""` になり、**重複の判定から丸ごと外れる**
 * （空は数えないので）——検出器の側の穴だった。
 */
function accName(el: Element): string {
    const byLabel = [...(el.ownerDocument?.querySelectorAll("label") ?? [])]
        .find((l) => (l as HTMLLabelElement).control === el)?.textContent?.trim();
    return el.getAttribute("aria-label")
        || byLabel
        || el.getAttribute("placeholder")
        || el.textContent?.trim()
        || "";
}

/** 「詳細」を開く（説明・撮影地の欄はここでしか描かれない） */
function openDetails(container: HTMLElement): void {
    for (const b of container.querySelectorAll("button")) {
        if (/詳細/.test(b.getAttribute("aria-label") ?? "")) fireEvent.click(b);
    }
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

    it("タイトル欄は「N枚目のタイトル（任意）」と名乗る", async () => {
        const container = await withPhotos(2);
        const names = [...container.querySelectorAll("input,textarea")].map(accName);
        expect(names).toContain("1枚目のタイトル（任意）");
        expect(names).toContain("2枚目のタイトル（任意）");
    });

    // **詳細を開かないと描かれない欄がある。** 開かずに数えていたので、
    // 説明と撮影地の名前は**一度も描かれず、外しても全件緑**だった
    it("詳細を開いた説明・撮影地の欄も、何枚目か名乗る", async () => {
        const container = await withPhotos(2);
        openDetails(container);
        const names = [...container.querySelectorAll("input,textarea")].map(accName);
        for (const n of ["1枚目の説明（任意）", "2枚目の説明（任意）",
                         "1枚目の場所（任意）", "2枚目の場所（任意）"]) {
            expect(names, `${n} が無い`).toContain(n);
        }
        const dup = names.filter((n, i) => n && names.indexOf(n) !== i);
        expect(dup, "詳細を開くと同じ名前の欄が並ぶ").toEqual([]);
    });

    // **見えている placeholder と、読み上げる名前を同じ言葉にする。**
    // `aria-label` は placeholder を上書きするので、違う語だと
    // 「場所をタップ」のような音声操作がその欄にだけ当たらない
    it("読み上げる名前は、見えている placeholder を含む", async () => {
        const container = await withPhotos(1);
        openDetails(container);
        for (const el of container.querySelectorAll<HTMLInputElement>("input,textarea")) {
            const ph = el.getAttribute("placeholder");
            const al = el.getAttribute("aria-label");
            if (!ph || !al) continue;
            expect(al, `「${ph}」の欄が「${al}」と名乗っている`).toContain(ph);
        }
    });

    // **ボタンも同じ。** `toContain` だけだと、別のボタンが枚数ぶん同じ名前で
    // 並んでいても拾えない（「詳細」が実際そうだった）
    it("写真ごとのボタンに、同じ名前が1つも無い", async () => {
        const container = await withPhotos(2);
        const names = [...container.querySelectorAll("button")].map(accName);
        expect(names).toContain("1枚目を削除");
        expect(names).toContain("2枚目を削除");
        expect(names).toContain("1枚目の詳細");
        expect(names).toContain("2枚目の詳細");
        const dup = names.filter((n, i) => n && names.indexOf(n) !== i);
        expect(dup, "同じ名前のボタンが並んでいる").toEqual([]);
    });

    // 開いているかどうかが読み上げに出る
    it("詳細ボタンは開閉の状態を言う", async () => {
        const container = await withPhotos(1);
        const btn = [...container.querySelectorAll("button")]
            .find((b) => b.getAttribute("aria-label") === "1枚目の詳細")!;
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(btn);
        expect(btn.getAttribute("aria-expanded")).toBe("true");
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
        expect(names).toContain("1枚目のタイトル（任意）");
    });

    // 検出器の自己確認: 同じ名前が並べば拾えること
    it("検出器は、同じ名前が並んだら拾う", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        host.innerHTML = `<input aria-label="A"><input aria-label="A"><input placeholder="B">`;
        const names = [...host.querySelectorAll("input,textarea")].map(accName);
        expect(names.filter((n, i) => n && names.indexOf(n) !== i)).toEqual(["A"]);
        host.remove();
    });

    // **`<label>` を見ないと、名前が空になって重複の判定から外れる**
    it("検出器は `<label>` で付いた名前も見る", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        host.innerHTML = `<label for="x">写真を選ぶ</label><input id="x">
                          <label>包む<input id="y"></label>`;
        const names = [...host.querySelectorAll("input")].map(accName);
        expect(names, "label で付いた名前を見ていない").toEqual(["写真を選ぶ", "包む"]);
        host.remove();
    });
});
