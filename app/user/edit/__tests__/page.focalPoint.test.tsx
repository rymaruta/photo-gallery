import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * 一覧（正方形）での切り抜き位置を、**あとからでも直せる**こと。
 *
 * 読む側（`GalleryGrid` / `ModalImage` / 写真ページ）は前から `focalPoint` を
 * `object-position` に使っていたのに、**書く口がどこにも無かった**
 * （`api-user` / `api` / `scripts` を grep して 0 件）＝実質いつでも中央。
 * アップロード画面だけに付けても、**既にある写真は一生中央のまま**なので
 * ここが要る。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ id: "p1" }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(`id=${q.id}`),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const EditPage = (await import("../page")).default;

/** 保存済みの切り抜き位置を持つ写真 */
const WITH_FP = { id: "p1", src: "https://cdn/a.jpg", userId: "me", title: "湖", focalPoint: { x: 0.8, y: 0.5 } };
/** 持たない写真（＝中央。今までの30枚はこちら） */
const WITHOUT_FP = { id: "p2", src: "https://cdn/b.jpg", userId: "me", title: "海" };

beforeEach(() => {
    q.id = "p1";
    mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method
            ? { ok: true, json: async () => ({ success: true }) }
            : { ok: true, json: async () => [WITH_FP, WITHOUT_FP] }));
});

const photoImg = () => document.querySelector('img[src="https://cdn/a.jpg"]') as HTMLImageElement;
const putBody = () => {
    const call = mockUserFetch.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
};
const save = () => fireEvent.click(screen.getByRole("button", { name: /保存する/ }));

/** jsdom は大きさを持たないので、横長の写真として差し込む */
function sizeAsLandscape(img: HTMLImageElement) {
    Object.defineProperty(img, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(img, "clientHeight", { value: 200, configurable: true });
    img.getBoundingClientRect = () => ({
        width: 400, height: 200, left: 0, top: 0, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
    img.setPointerCapture = vi.fn();
    img.hasPointerCapture = () => true;
    fireEvent.load(img);
}

describe("編集画面の切り抜き位置", () => {
    it("枠を動かすと、保存で focalPoint が送られる", async () => {
        render(<EditPage />);
        await waitFor(() => expect(photoImg()).toBeTruthy());
        sizeAsLandscape(photoImg());
        fireEvent.pointerDown(photoImg(), { clientX: 120, clientY: 100, pointerId: 1 });
        save();
        await waitFor(() => expect(putBody()).toBeTruthy());
        expect(putBody().focalPoint, "動かしたのに送られていない").toBeTruthy();
        expect(putBody().focalPoint.x).toBeCloseTo(0.3, 5);
    });

    // **触っていない項目は送らない**（このリポジトリが差分送信で守っているもの
    // ——2タブで開いて片方だけ直したとき、もう片方の保存が上書きしないように）
    it("動かさなければ送らない", async () => {
        render(<EditPage />);
        await waitFor(() => expect(photoImg()).toBeTruthy());
        sizeAsLandscape(photoImg());
        save();
        await waitFor(() => expect(putBody()).toBeTruthy());
        expect("focalPoint" in putBody(), "触っていないのに送っている").toBe(false);
    });

    // **中央に戻す口が要る。** 一度ずらすと戻せないと、直すたびに
    // 近づけるしかない
    it("「中央に戻す」を押すと null を送る（＝属性を落とす）", async () => {
        render(<EditPage />);
        await waitFor(() => expect(photoImg()).toBeTruthy());
        sizeAsLandscape(photoImg());
        fireEvent.click(screen.getByRole("button", { name: "中央に戻す" }));
        save();
        await waitFor(() => expect(putBody()).toBeTruthy());
        expect(putBody().focalPoint, "中央に戻す指示が届いていない").toBeNull();
    });

    // 保存済みの値を持たない写真では、戻す口を出さない（押しても何も起きない）
    it("もともと中央の写真には「中央に戻す」を出さない", async () => {
        q.id = "p2";
        render(<EditPage />);
        await waitFor(() => expect(document.querySelector('img[src="https://cdn/b.jpg"]')).toBeTruthy());
        expect(screen.queryByRole("button", { name: "中央に戻す" })).toBeNull();
    });
});
