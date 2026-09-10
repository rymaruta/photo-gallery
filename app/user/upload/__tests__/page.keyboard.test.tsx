import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// キーボードだけで写真を選べなかった件。
//
// ファイル入力を `className="hidden"`（= display:none）にしていたので、
// その input は**フォーカスできない**。`<label>` 自体もタブ順に入らないので、
// Tab を押し続けても「タップして写真を選ぶ」にも「写真を撮る」にも止まらず、
// **このページでは何もできなかった**（ドロップも貼り付けも ref.click() も無い）。
//
// jsdom は Tailwind のクラスを解決しないので display を測れない。
// 代わりに「display:none にしない」「ラベルと結ばれている」という、
// その挙動を担っている不変条件を見る。

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
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 「読めた／読めなかった」を分ける口。既存のモックから組み立てる
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
    mockReverseGeocode.mockReset().mockResolvedValue("札幌市");
    mockExtractExif.mockReset().mockResolvedValue({
        dateTimeOriginal: "2024-10-12T09:00:00",
        latitude: 43.06,
        longitude: 141.35,
    });
    mockReadSharedPayload.mockReset().mockResolvedValue(null);
    localStorage.clear();
    // ブラウザ環境の穴埋め（プレビュー用の Object URL）
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});


describe("アップロード: キーボードで写真を選べる", () => {
    const fileInputs = (c: HTMLElement) => Array.from(c.querySelectorAll('input[type="file"]'));

    it("ファイル入力を display:none にしない（フォーカスできなくなる）", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByRole("checkbox");   // 描画が終わるまで待つ

        const inputs = fileInputs(container);
        expect(inputs.length).toBeGreaterThan(0);
        for (const el of inputs) {
            const classes = el.className.split(/\s+/);
            // `hidden` は display:none、`invisible` は visibility:hidden。
            // どちらもフォーカスできない＝元のバグと同じ結果になる。
            // 綴りを1つだけ見ていたら `sr-only invisible` がすり抜けた
            for (const bad of ["hidden", "invisible", "collapse"]) {
                expect(classes, `${bad} が付いているとフォーカスできない`).not.toContain(bad);
            }
            expect(classes).toContain("sr-only");
        }
    });

    it("どのファイル入力もラベルと結ばれている（押す手段がある）", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByRole("checkbox");

        for (const el of fileInputs(container)) {
            const byFor = el.id ? container.querySelector(`label[for="${el.id}"]`) : null;
            const wrapped = el.closest("label");
            expect(byFor ?? wrapped).not.toBeNull();
        }
    });

    // 見えない入力にフォーカスが移ったとき、どこにいるか分かるようにする
    it("入力を包むラベルが focus-within で見た目を変える", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByRole("checkbox");

        for (const el of fileInputs(container)) {
            // **祖先**に付いていること。`querySelector` で子孫を探していた頃は、
            // input の**兄弟**に付いている（＝永久に発火しない）形を通していた。
            // :focus-within は自分自身か子孫にしか当たらない。
            const holder = el.closest('[class*="focus-within"]');
            expect(holder, `focus-within が input の祖先に無い: ${el.id || "(id なし)"}`).not.toBeNull();
        }
    });
});

// サーバーは超えた分を黙って切る。上限を入力にも入れる。
// 説明とタグに入れない理由は /user/edit と同じ（段落ごと／タグ1つあたり）。
describe("アップロード: サーバーの上限を入力にも入れる", () => {
    // 共通設定の欄は、写真を1枚選ぶまで描かれない
    async function withOnePhoto() {
        const utils = render(<UploadPage />);
        const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
        Object.defineProperty(input, "files", {
            value: [new File(["x"], "a.jpg", { type: "image/jpeg" })], configurable: true,
        });
        fireEvent.change(input);
        return utils;
    }

    it("カテゴリは maxLength=100", async () => {
        await withOnePhoto();
        const el = await screen.findByPlaceholderText(/カテゴリ/);
        expect(el.getAttribute("maxlength")).toBe("100");
    });

    it("タイトルは maxLength=200", async () => {
        await withOnePhoto();
        const el = await screen.findByPlaceholderText(/タイトル/);
        expect(el.getAttribute("maxlength")).toBe("200");
    });

    it("タグには maxLength を入れない（上限はタグ1つあたりなので）", async () => {
        await withOnePhoto();
        const el = await screen.findByPlaceholderText(/タグ/);
        expect(el.getAttribute("maxlength")).toBeNull();
    });
});
