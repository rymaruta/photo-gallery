import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
// **上限は定数から導く**（文言の中の数字を手書きすると、上限を動かすたびに
// テストを実装に合わせて直すことになる。実際 100 → 1000 でここが落ちた）
import { PHOTO_LIMIT_PER_USER } from "../../../../lib/utils/uploadLimits";
import userEvent from "@testing-library/user-event";

// **入力候補（前に使った撮影地・カテゴリ）を見るテストが1本も無かった。**
// `setOwnValues(collectOwnValues(all))` を丸ごと消しても
// `app/user/upload` の8ファイル43件が全緑だった（実測）。
// 隣の編集画面（`app/user/edit`）には同じ形のテストがある。
// 候補が出ないと、同じ場所が別々の名前に散る（「パリ」「パリ, フランス」…）。

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
    UnstrippableFileError: class extends Error { },
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

// 「パリ」2枚・「京都」1枚（下書きも混ぜる。候補は公開状態に関係なく出す）
const PHOTOS = [
    { id: "p1", src: "s", userId: "me", location: "パリ", category: "風景", tags: ["夜景"] },
    { id: "p2", src: "s", userId: "me", location: "パリ", category: "風景", tags: ["夜景", "街"] },
    { id: "p3", src: "s", userId: "me", location: "京都", category: "街", published: false },
];

const optionValues = (id: string) =>
    Array.from(document.querySelectorAll(`#${id} option`)).map((o) => (o as HTMLOptionElement).value);

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => PHOTOS });
});

/** 共通設定（＝候補の datalist）は写真を選んでから出る */
async function pickOne() {
    const { container } = render(<UploadPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByText(/共通設定/);
}

describe("アップロード画面の入力候補", () => {
    it("前に使った撮影地を、よく使う順に候補へ出す", async () => {
        await pickOne();
        await waitFor(() => expect(optionValues("own-locations").length).toBeGreaterThan(0));
        expect(optionValues("own-locations"), "候補が出ていない／並びが違う").toEqual(["パリ", "京都"]);
    });

    it("下書きのカテゴリも候補に入る（公開状態は関係ない）", async () => {
        await pickOne();
        await waitFor(() => expect(optionValues("own-categories").length).toBeGreaterThan(0));
        expect(optionValues("own-categories")).toContain("街");
    });

    // **読めない行が混じっても候補は出す**（1件の巻き添えで全部を失わない）。
    // 枠の数え方は別: `countUserPhotos` は `Select: "COUNT"` なので、
    // 落とした行も上限に数える（「あと3枚」と出て 403 にしない）
    it("読めない行が混じっても、残りから候補を作る", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => [...PHOTOS, null, { src: "id無し" }] });
        await pickOne();
        await waitFor(() => expect(optionValues("own-locations").length).toBeGreaterThan(0));
        expect(optionValues("own-locations")).toEqual(["パリ", "京都"]);
        // PHOTOS の3件 + 読めない2行 = サーバーは5件と数える
        const used = PHOTOS.length + 2;
        expect(screen.getByText(`あと${PHOTO_LIMIT_PER_USER - used}枚アップロードできます（${PHOTO_LIMIT_PER_USER}枚まで）`),
            "落とした行を枠から引いている（サーバーは数える）").toBeInTheDocument();
    });
});
