import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **最終版モック（`docs/mockups/07-post-create.jpg`）に合わせて作り直した
 * 投稿作成画面の、形の見張り**（2026-09-22）。
 *
 * 見るのは2種類:
 *
 * 1. **置いたもの**——ヘッダー（✕・題・下書き保存）と、文字数カウンタ。
 *    どちらもモックに在って実装に無かったので、**作り直す前のコードでは落ちる**
 *    （確かめた: `git show HEAD:…/page.tsx` で差し戻すと **9件中6件が赤**）。
 * 2. **置かなかったもの**——モックの「BGM（任意）」と「公開範囲」の行。
 *    こちらは**元から無い**ので、前のコードでも緑になる＝回帰の再現ではなく
 *    **足し戻しの番人**（差し戻しても緑のままの3件がこれ）。owner の指示
 *    （2026-09-22）「未実装の設定を、動作するボタンとして表示しない」は、
 *    画面を触るたびに破られうる種類の約束で、
 *    破ったときに気づける場所がここにしか無い。
 *
 * **数字は実装の上限で見る。** モックの「16/50」「58/500」は絵で、この
 * サイトのサーバーは題 200字・説明 2000字を受ける
 * （`scripts/__tests__/limitParity.test.ts` が画面とサーバーの数字を突き合わせる）。
 * ここで 50/500 を期待すると、**モックの絵をテストに焼き付ける**ことになる。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));
const mockBack = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn(), back: mockBack }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
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
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockBack.mockReset();
    mockPush.mockReset();
    // **履歴の長さは自分で置く。** jsdom の window はファイル内で使い回されるので、
    // 1本目で `pushState` すると 2本目の「履歴が無い」が作れない（実際に踏んだ）
    setHistoryLength(1);
});

/** `window.history.length` を置き換える（jsdom では減らせないため） */
function setHistoryLength(n: number) {
    Object.defineProperty(window.history, "length", { value: n, configurable: true });
}

async function withOnePhoto() {
    const utils = render(<UploadPage />);
    const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByText(/全写真に適用/);
    return utils;
}

describe("投稿作成画面: モックのヘッダー", () => {
    it("題・✕・下書き保存が並ぶ", async () => {
        render(<UploadPage />);
        expect(await screen.findByRole("heading", { name: "新しい投稿を作成" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "投稿の作成をやめる" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "下書き保存" })).toBeInTheDocument();
    });

    // **写真を選ぶ前は押せない。** 押すと「アップロードする写真がありません」と
    // 言うだけの道ができる（前の画面はバーごと出さないことでそれを避けていた）
    it("写真が無いうちは下書き保存を押せない", async () => {
        render(<UploadPage />);
        expect(await screen.findByRole("button", { name: "下書き保存" })).toBeDisabled();
    });

    it("✕ は前の画面へ戻す（履歴があるとき）", async () => {
        setHistoryLength(2);
        render(<UploadPage />);
        await userEvent.click(await screen.findByRole("button", { name: "投稿の作成をやめる" }));
        expect(mockBack).toHaveBeenCalled();
        expect(mockPush, "戻れるのに行き先を作っている").not.toHaveBeenCalled();
    });

    // **履歴が無い回がある。** 共有シート（PWA Share Target）は
    // このページを新しいタブで開くので、`router.back()` はどこへも行かない
    it("履歴が無ければトップへ逃がす", async () => {
        render(<UploadPage />);
        await userEvent.click(await screen.findByRole("button", { name: "投稿の作成をやめる" }));
        expect(mockBack, "行き先の無い back を呼んでいる").not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/");
    });
});

describe("投稿作成画面: 文字数カウンタ", () => {
    it("題と説明のカウンタは、この実装の上限を出す（モックの絵を写さない）", async () => {
        await withOnePhoto();
        expect(screen.getByText("0/200"), "題のカウンタが無い").toBeInTheDocument();
        expect(screen.getByText("0/2000"), "説明のカウンタが無い").toBeInTheDocument();
        // モックの数字（50 / 500）は絵。焼き付けない
        expect(screen.queryByText("0/50")).toBeNull();
        expect(screen.queryByText("0/500")).toBeNull();
    });

    it("打った字の数について回る", async () => {
        await withOnePhoto();
        await userEvent.type(screen.getByPlaceholderText("タイトル（任意）"), "夕日");
        expect(screen.getByText("2/200")).toBeInTheDocument();
    });
});

describe("投稿作成画面: 実装の無い設定は出さない（owner 指示 2026-09-22）", () => {
    /**
     * モックの⑥「BGM（任意）」と⑦「公開範囲」。
     *
     * - BGM: `/upload/save` が `song` を受け取らない（`api-user/src/upload.ts`）。
     *   投稿したあと写真ページで付ける経路しか無い
     * - 公開範囲: 写真が持つのは `published` の真偽だけ。「フォロワーのみ」
     *   「自分のみ」はデータにもAPIにも無い（`docs/redesign-2026-09.md` P6・P7）。
     *   2択は「下書き保存」と「投稿する」の2つのボタンが担う
     *
     * どちらも `api-user/**` を触らないと動かないので、**押せる形では出さない**。
     */
    it("BGM の行を置かない", async () => {
        await withOnePhoto();
        expect(screen.queryByText(/BGM/), "投稿時に曲を付ける口が無いのに欄がある").toBeNull();
    });

    /**
     * **公開範囲は「実装のある設定」になった**（2026-09-28）。サーバーは `audience` を
     * 受けて静的サイトから外す（`api-user/src/upload.ts`）。以前ここは「置かない」を
     * 縛っていた——当時は published の真偽しか無かったため。
     * 残す見張りは「**サーバーに無い選択肢を出さない**」: 「自分のみ」は無い（下書きが担う）。
     * 行が保存に効くことは `page.audience.test.tsx` が見る
     */
    it("公開範囲はサーバーにある三択だけ（「自分のみ」は出さない）", async () => {
        await withOnePhoto();
        expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value).filter((v) => ["everyone", "followers", "closeFriends"].includes(v)))
            .toEqual(["everyone", "followers", "closeFriends"]);
        expect(screen.queryByText(/自分のみ/)).toBeNull();
    });

    // モックのシートに並ぶ「人気」「評価」「口コミ」の類は、この画面の
    // どこにも根拠が無い（owner 指示「架空のデータを出さない」）
    it("持っていない数字を出さない", async () => {
        await withOnePhoto();
        // フォロワーは**数**を探す（公開範囲の「フォロワーのみ」は数ではない）
        for (const word of [/人気/, /レビュー/, /評価/, /フォロワー\s*[0-9０-９]|[0-9０-９]+\s*(人の)?フォロワー/]) {
            expect(screen.queryByText(word), `${word} の欄がある`).toBeNull();
        }
    });
});

describe("投稿作成画面: まとめる回は、保存に使われる1枚の欄を出す", () => {
    /**
     * `handleUploadAll` は `pending` の**先頭**を表紙にして、その1枚の
     * 題・説明・撮影地だけを投稿に載せる。前の画面は全部の欄が同時に
     * 見えていたので気づけたが、**1枚ぶんしか描かない形では3枚目に書いた
     * キャプションが黙って捨てられる**（レビューで出た）。
     */
    it("チェックを入れると、欄が表紙の1枚に切り替わる", async () => {
        const { container } = render(<UploadPage />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, [
            new File(["a"], "a.jpg", { type: "image/jpeg" }),
            new File(["b"], "b.jpg", { type: "image/jpeg" }),
        ]);
        await screen.findByText(/全写真に適用/);

        // 2枚目を選んでから「まとめる」を入れる
        await userEvent.click(screen.getByRole("button", { name: "2枚目を選ぶ" }));
        expect(screen.getByLabelText("2枚目のタイトル（任意）")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("checkbox", { name: /1件の投稿にまとめる/ }));
        expect(screen.getByLabelText("1枚目のタイトル（任意）"),
            "まとめる回なのに、保存されない写真の欄を出している").toBeInTheDocument();
        expect(screen.queryByLabelText("2枚目のタイトル（任意）")).toBeNull();
        // ヒーローは選んだままの2枚目（写真は見比べられる）
        expect(screen.getByText("2/2")).toBeInTheDocument();
    });
});

describe("投稿作成画面: サムネの「削除」の的の大きさ", () => {
    // **24px を下回らない**（WCAG 2.5.8・AA）。この的は 64×80 の「選ぶ」
    // ボタンの**上に乗る**ので、小さい的に許される「間隔の例外」は使えない。
    // jsdom はレイアウトを計算しないので、直書きの寸法そのものを見る
    // （数値の根拠は WCAG。`chipTapSpacing.test.tsx` と同じ立場）
    it("24px 未満にしない", async () => {
        await withOnePhoto();
        const btn = screen.getByRole("button", { name: "1枚目を削除" });
        for (const side of ["width", "height"] as const) {
            const px = Number.parseFloat(btn.style[side]);
            expect(px, `${side} が ${btn.style[side]}（24px 未満）`).toBeGreaterThanOrEqual(24);
        }
    });
});

describe("投稿作成画面: タグのチップ", () => {
    // 生の綴りで並べると `桜, 桜` が同じ React の key で2つ並び、
    // `自然, nature` は2つ出るのに ✕ が両方消す（`toggleTag` はキーで外す）
    it("同じタグは畳んで1つだけ出す", async () => {
        await withOnePhoto();
        const field = screen.getByPlaceholderText("タグ（カンマ区切り）");
        await userEvent.type(field, "桜, 桜");
        expect(screen.getAllByRole("button", { name: 'タグ「桜」を外す' }),
            "同じタグのチップが2つ並んでいる").toHaveLength(1);
    });

    it("押すとそのタグが欄から外れる", async () => {
        await withOnePhoto();
        const field = screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;
        await userEvent.type(field, "桜, 海");
        await userEvent.click(screen.getByRole("button", { name: 'タグ「桜」を外す' }));
        expect(field.value.split(",").map((t) => t.trim()).filter(Boolean)).toEqual(["海"]);
    });
});
