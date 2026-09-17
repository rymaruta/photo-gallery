import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **写真の差し替え**（消して投稿し直さずに実体だけ入れ替える）。
 *
 * 純関数とサーバーの判定は `api-user/src/__tests__/photoReplace.test.ts` が見る。
 * ここで見るのは**画面の配線**——選んだファイルが、位置情報を落として
 * S3 へ上がり、EXIF を添えて差し替えの口へ届くか。
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockPresignAndPut = vi.hoisted(() => vi.fn());
const mockToUploadSafeFile = vi.hoisted(() => vi.fn());
const mockExtractExif = vi.hoisted(() => vi.fn());
const mockExtractCameraExif = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));
vi.mock("../../../../lib/utils/uploadToS3", () => ({
    presignAndPut: (...a: unknown[]) => mockPresignAndPut(...a),
}));
// **`toUploadSafeFile` はモックしても素通しにしない。** 素通しにすると
// 「位置情報を落とす前に EXIF を読む」という順番を壊しても気づけない
vi.mock("../../../../lib/utils/image", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    toUploadSafeFile: (...a: unknown[]) => mockToUploadSafeFile(...a),
}));
vi.mock("../../../../lib/utils/exif", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    extractExifFromFile: (...a: unknown[]) => mockExtractExif(...a),
    extractCameraExif: (...a: unknown[]) => mockExtractCameraExif(...a),
}));

const EditPage = (await import("../page")).default;

const PHOTO = { id: "p1", src: "https://cdn.example/uploads/u/old.webp", userId: "me", title: "元の題", tags: ["冬"] };
const original = new File(["original-bytes"], "IMG_1234.JPG", { type: "image/jpeg" });
const stripped = new File(["stripped"], "IMG_1234.JPG", { type: "image/jpeg" });

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation((url: string, init?: { method?: string }) => {
        if (!init?.method) return Promise.resolve({ ok: true, json: async () => [PHOTO] });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    mockPush.mockReset();
    mockToast.mockReset();
    mockPresignAndPut.mockReset().mockResolvedValue({ key: "uploads/u/new.webp", publicUrl: "https://cdn.example/uploads/u/new.webp" });
    mockToUploadSafeFile.mockReset().mockResolvedValue(stripped);
    mockExtractExif.mockReset().mockResolvedValue({ dateTimeOriginal: "2024-11-01" });
    mockExtractCameraExif.mockReset().mockResolvedValue({ camera: "SONY ILCE-7M4", iso: 400 });
});

const pick = async () => {
    render(<EditPage />);
    await screen.findByDisplayValue("元の題");
    const input = document.getElementById("replace-photo") as HTMLInputElement;
    await userEvent.upload(input, original);
    return input;
};
const putBody = () => {
    const call = mockUserFetch.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
    return JSON.parse((call?.[1] as { body: string }).body) as { replace?: Record<string, unknown> };
};

describe("写真の差し替え（画面の配線）", () => {
    it("差し替えの導線がある", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("元の題");
        expect(screen.getByText("写真を差し替える")).toBeInTheDocument();
    });

    /**
     * **入力欄を `display:none` にしない。** キーボードだけで選べなくなる
     * （`f83da94` で一度踏んだ型）。`sr-only` ＋ `<label>` で結ぶ
     */
    it("キーボードからも選べる（入力欄を消していない）", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("元の題");
        const input = document.getElementById("replace-photo") as HTMLInputElement;
        expect(input, "入力欄が無い").toBeTruthy();
        expect(input.className, "display:none で隠している").toContain("sr-only");
        expect(document.querySelector('label[for="replace-photo"]'), "ラベルが結ばれていない").toBeTruthy();
    });

    it("選んだ写真を S3 へ上げ、差し替えの口へ送る", async () => {
        await pick();
        await waitFor(() => expect(mockPresignAndPut).toHaveBeenCalled());
        const body = putBody();
        expect(body.replace, "差し替えとして送っていない").toBeTruthy();
        expect(body.replace!.publicUrl).toBe("https://cdn.example/uploads/u/new.webp");
        expect(body.replace!.key).toBe("uploads/u/new.webp");
    });

    /** この機能の目的そのもの */
    it("新しい写真の EXIF と撮影日を添える", async () => {
        await pick();
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => (c[1] as { method?: string })?.method === "PUT")).toBe(true));
        const r = putBody().replace!;
        expect((r.exif as Record<string, unknown>).camera, "EXIF を送っていない").toBe("SONY ILCE-7M4");
        expect(r.date, "撮影日を送っていない").toBe("2024-11-01");
    });

    /**
     * 🔴 **位置情報は上げる前に端末で落とす。**
     * 通さないと、差し替えが**位置情報を消す仕組みの抜け穴**になる。
     */
    it("位置情報を落としたファイルを上げる（原本を上げない）", async () => {
        await pick();
        await waitFor(() => expect(mockPresignAndPut).toHaveBeenCalled());
        expect(mockToUploadSafeFile, "原本をそのまま上げている").toHaveBeenCalledWith(original);
        expect(mockPresignAndPut.mock.calls[0][0], "**原本が S3 へ行っている**").toBe(stripped);
    });

    /**
     * 🔴 **EXIF は落とす前の元ファイルから読む。** 順番が逆だと
     * 何も読めず、この機能の目的そのものが不発になる。
     */
    it("EXIF は原本から読む（落としたファイルからではない）", async () => {
        await pick();
        await waitFor(() => expect(mockPresignAndPut).toHaveBeenCalled());
        expect(mockExtractCameraExif).toHaveBeenCalledWith(original);
        expect(mockExtractExif).toHaveBeenCalledWith(original);
    });

    it("位置情報を落とせないファイルは、理由を出して上げない", async () => {
        mockToUploadSafeFile.mockRejectedValueOnce(new Error("nope"));
        await pick();
        await waitFor(() => expect(mockToast).toHaveBeenCalled());
        expect(mockPresignAndPut, "**落とせていないのに上げている**").not.toHaveBeenCalled();
    });

    it("サーバーが断ったら、その理由を出して遷移しない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (!init?.method) return Promise.resolve({ ok: true, json: async () => [PHOTO] });
            return Promise.resolve({ ok: false, json: async () => ({ error: "x" }) });
        });
        await pick();
        await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("差し替え"), "error"));
        expect(mockPush, "失敗したのに遷移している").not.toHaveBeenCalled();
    });

    /**
     * 差し替えた姿を見せる。**行き先は `ROUTES.PHOTO` が決める**
     * （個別ページがまだ無ければ `/?photo=` に落ちる）ので、
     * ここでは「その写真へ送ったか」だけを見る
     * ——同じ関数で期待値を作ると何も確かめていないことになる
     */
    it("成功したら、その写真を見せに行く", async () => {
        await pick();
        await waitFor(() => expect(mockPush).toHaveBeenCalled());
        expect(String(mockPush.mock.calls[0][0]), "別の場所へ送っている").toContain("p1");
    });

    /** **位置は本人が選ぶもの。** 差し替えでピンを黙って動かさない */
    it("座標は送らない", async () => {
        mockExtractExif.mockResolvedValueOnce({ dateTimeOriginal: "2024-11-01", latitude: 35.6, longitude: 139.7 });
        await pick();
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => (c[1] as { method?: string })?.method === "PUT")).toBe(true));
        expect(putBody().replace!.coords, "地図のピンが黙って動く").toBeUndefined();
    });

    /** サムネ・代表色・ぼかしはサーバーが消してビルドが作り直す */
    it("サムネや代表色は送らない（2か所で作らない）", async () => {
        await pick();
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => (c[1] as { method?: string })?.method === "PUT")).toBe(true));
        const r = putBody().replace!;
        expect(r.thumbUrl).toBeUndefined();
        expect(r.dominantColor).toBeUndefined();
        expect(r.blurDataURL).toBeUndefined();
    });
});
