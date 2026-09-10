import React from "react";
import { PHOTO_LIMIT_PER_USER } from "../../../../lib/utils/uploadLimits";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 100枚の上限が**押すまで見えなかった**。サーバーは 403 で断るが、
// 数え上げ失敗の 503 と文言が違うだけで、利用者には「上限なのか障害なのか」
// も分からない。選ぶ前に残り枚数を出す。

const mockUserFetch = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
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
    // 受け皿は開けたが中身が無い（＝共有経由ではない通常の表示）
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
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, src: "s" }));

// **上限は定数から導く。** 文言の中の数字を手書きすると、上限を動かすたびに
// 「テストを実装に合わせて直す」形になり、守っている性質が分からなくなる
// （100 → 1000 に動かしたときに8本が一斉に落ちた）。
const LIMIT = PHOTO_LIMIT_PER_USER;
/** 「あと N 枚アップロードできます（… 枚まで）」 */
const remainText = (used: number) => `あと${LIMIT - used}枚アップロードできます（${LIMIT}枚まで）`;

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset();
});

describe("アップロードの残り枚数", () => {
    it("選ぶ前に残りを出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => photos(12) });
        render(<UploadPage />);
        expect(await screen.findByText(remainText(12))).toBeInTheDocument();
    });

    it("上限に達していたら、空ける方法まで書く", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => photos(LIMIT) });
        render(<UploadPage />);
        expect(await screen.findByText(new RegExp(`上限（${LIMIT}枚）に達しています`))).toBeInTheDocument();
        expect(screen.getByText(/削除すると空きができます/)).toBeInTheDocument();
    });

    // 推測した数字を見せるより、出さない方がよい
    it("枚数を取れなければ何も出さない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        render(<UploadPage />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByText(/アップロードできます/)).toBeNull();
        expect(screen.queryByText(/上限/)).toBeNull();
    });

    // サーバーも isAdmin を見て免除している
    it("管理者には出さない（上限の対象外）", async () => {
        authState.current = { isAuthenticated: true, isAdminUser: true, isGeneralUser: false, loading: false };
        // **上限未満の枚数で試す。** 120枚だと一般ユーザーでも「上限に達して
        // います」の方が出るので、免除されているかを区別できない（実測で
        // 変異が素通りした）。12枚なら一般ユーザーには「あと88枚」が出る。
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => photos(12) });
        render(<UploadPage />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByText(/アップロードできます/)).toBeNull();
        expect(screen.queryByText(/上限/)).toBeNull();
    });
});


// 残り枚数はマウント時に1回取るだけで、アップロード成功後に更新されなかった。
// 3枚上げても「あと5枚」のままで、押して初めて 403 に戻る——「上限に
// ぶつかるまで見えない」を直したはずが、半分残っていた。
describe("アップロードしたら残り枚数を減らす", () => {
    it("成功した枚数だけ減る", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (url === "/user/photos" && !init?.method) {
                return Promise.resolve({ ok: true, json: async () => photos(LIMIT - 3) });
            }
            if (url === "/upload/presigned-url") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/a.jpg", key: "uploads/me/a.jpg" }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        });
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));

        const { container } = render(<UploadPage />);
        expect(await screen.findByText(remainText(LIMIT - 3))).toBeInTheDocument();

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        expect(await screen.findByText(remainText(LIMIT - 2))).toBeInTheDocument();
    });
});

// **枠はサーバーの数え方に合わせる。**
//
// 応答から読めない行を落とすようにしたとき、`usedSlots` もふるいの
// あとの件数にしてしまった。ところがサーバーの `countUserPhotos` は
// `Select: "COUNT"` で、`id` の無い行も**上限に数える**——「あと3枚」と
// 出ているのに 403 になる（同じ上限を片方だけ守る、の型）。
describe("読めない行があっても、枠の数え方はサーバーと同じ", () => {
    it("落とした行も枠に数える", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => [...photos(LIMIT - 3), null, { src: "id なし" }],
        });
        render(<UploadPage />);
        // サーバーは 落とした2行も数える ので、残りは1枚
        expect(await screen.findByText(remainText(LIMIT - 1)),
            "ふるいのあとの件数で数えている（サーバーは 403 を返す）").toBeInTheDocument();
    });

    // 正常系: 全部読める応答は今までどおり
    it("全部読める応答は今までどおり", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => photos(12) });
        render(<UploadPage />);
        expect(await screen.findByText(remainText(12))).toBeInTheDocument();
    });
});
