import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **保存済みの機材名には二重のメーカー名が残っている。**
// 実データに "Hasselblad Hasselblad X2D II 100C" が実在（`formatCameraName` を
// 使う前に保存された行）。この画面の撮影情報の要約は保存値をそのまま出していた。
//
// **配線を見るテスト。** `dedupeCameraName` を外す変異が 642件すべて緑のまま
// 通っていた（レビューが実証）。関数の単体テストとは別に、画面に出る文字で見る。
//
// この要約は**読み取り専用**（`buildFields()` の項目に `exif` は無い）なので、
// 畳んでも保存の差分には載らない。`/admin/edit` の入力欄には当てていない
// ——あちらは値が保存ペイロードに載るため。

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

const photoWith = (camera: string) => [{
    id: "p1", src: "https://cdn/ok.jpg", userId: "me", title: "湖",
    exif: { camera, lens: "XCD 35-100E" },
}];

function mount(camera: string) {
    mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method
            ? { ok: true, json: async () => ({ success: true }) }
            : { ok: true, json: async () => photoWith(camera) }));
    render(<EditPage />);
}

beforeEach(() => { q.id = "p1"; });

describe("編集画面の撮影情報: 機材名", () => {
    it("保存済みの二重のメーカー名は畳んで出す", async () => {
        mount("Hasselblad Hasselblad X2D II 100C");
        await waitFor(() => expect(screen.getByText(/Hasselblad X2D II 100C/)).toBeInTheDocument());
        expect(screen.queryByText(/Hasselblad Hasselblad/), "二重のまま出ている").toBeNull();
    });

    // **正当な値を壊さない**（こちらの方が大事）
    it("二重でない機材名はそのまま出す", async () => {
        mount("SONY ILCE-7M3");
        await waitFor(() => expect(screen.getByText(/SONY ILCE-7M3/)).toBeInTheDocument());
    });
});
