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
const search = vi.hoisted(() => ({ value: "tag=夜" }));
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
// **言語を切り替えられる形にする。** 固定だと「言語も見る」と書いた
// `aria-label` の英語側を誰も通らない（日本語固定に戻す変異が素通りした）
const uiLocale = vi.hoisted(() => ({ value: "ja" as "ja" | "en" }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: uiLocale.value }) }));
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
    // **タグは英語で保存しておく**（実データ30枚がそう）。決まった選択肢は
    // 日本語なので、寄らなければチップが光らない——そこを画面で見る
    { id: "p1", src: "s", userId: "me", location: "パリ", category: "風景", tags: ["sunset"] },
    { id: "p2", src: "s", userId: "me", location: "パリ", category: "風景", tags: ["sunset", "桜"] },
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
    await screen.findByText(/全写真に適用/);
}


/**
 * 欄の文字列ではなく、**保存されるタグ**で見る。
 *
 * チップを押すと末尾に区切りが残る（そのまま打つと前のタグに繋がるため）。
 * 生の文字列で比べると、この表示上の違いで落ちて、**守りたい性質**
 * （押したら入る／打ちかけがタグとして残らない）が見えなくなる。
 */
const savedTags = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

// **ホームの「今日のテーマ」から来た投稿（`?tag=夜`）。** タグが入っていなければ、
// 入口を押しても何も起きないのと同じ（iOS の `MissionRouter.join` と同じ働き）
describe("今日のテーマから来た投稿", () => {
    beforeEach(() => { search.value = "tag=夜"; });

    it("テーマのタグが最初から入っている", async () => {
        await pickOne();
        const field = await screen.findByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;
        await waitFor(() => expect(savedTags(field.value)).toEqual(["夜"]));
    });

    it("テーマ以外の語は URL から入れない", async () => {
        search.value = "tag=" + encodeURIComponent("知らない語");
        await pickOne();
        const field = await screen.findByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;
        expect(savedTags(field.value)).toEqual([]);
    });
});
