import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * ストーリーの文字を、好きな場所に・好きな字体と色で置く。
 *
 * owner:「インスタみたいにストーリーで好きな場所で文字打てるようにしたい。
 * フォントの種類や色も豊富にしたい」
 *
 * **文言は `caption` のまま**——ここが足したのは見せ方だけなので、
 * 残したときの題（`storyKeep.ts`）も検索に出る文章も変わらない。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockExtract = vi.hoisted(() => vi.fn());
const mockReverse = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_r: unknown, f: string) => f,
}));
// 画像の縮小は canvas を使うので jsdom では通らない。ここで見たいのは
// 「撮影地が投稿に載るか」なので素通しにする（他の StoriesBar のテストと同じ）
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    compressImage: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));
// 動画の位置除去は本物を通すと jsdom で走らない。ここで見たいのは
// 「動画には撮影地の欄を出さない」なので素通しにする
vi.mock("@/lib/utils/video", () => ({ toUploadSafeVideo: async (f: File) => f }));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: (f: File) => mockExtract(f),
    reverseGeocode: (...a: unknown[]) => mockReverse(...a),
    extractCameraExif: vi.fn(),
}));

import StoriesBar from "../StoriesBar";
import { STORY_TEXTS_MAX } from "@/lib/utils/storyText";

const api = () => async (url: string, init?: { method?: string; body?: string }) => {
    if (url === "/stories" && init?.method === "POST") return { ok: true, json: async () => ({ success: true }) };
    if (url.startsWith("/presigned-url")) return { ok: true, json: async () => ({ uploadUrl: "https://s3/put", key: "uploads/me/s.webp", publicUrl: "https://cdn/uploads/me/s.webp" }) };
    if (url === "/stories") return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
};
/** POST /stories の本文 */
const posted = () => mockUserFetch.mock.calls
    .filter((c) => c[0] === "/stories" && (c[1] as { method?: string })?.method === "POST")
    .map((c) => JSON.parse((c[1] as { body: string }).body));

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation(api());
    mockExtract.mockReset().mockResolvedValue({});
    mockReverse.mockReset().mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    localStorage.clear();
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 画像を1枚選んで、下書きが開くまで待つ */

/** 画像を1枚選んで、下書きが開くまで待つ */
async function pickImage() {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["img"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
}

/** 写真の上に出ている文字（下の入力欄ではなく、置いた方） */
const overlay = () => document.querySelector('[role="dialog"] p[style*="translate"]') as HTMLElement | null;
const type = async (text: string) => {
    await userEvent.type(screen.getByRole("textbox", { name: "文字" }), text);
};

describe("ストーリーの文字", () => {
    // **打ってから出す。** 文字が無いうちは動かすものも飾るものも無い
    it("文言が無いうちは、見せ方の欄を出さない", async () => {
        await pickImage();
        expect(screen.queryByRole("switch", { name: "明朝" }), "打つ前から字体の欄が出ている").toBeNull();
        expect(overlay(), "文字が無いのに写真の上に何か出ている").toBeNull();
    });

    // 今までどおり「開いて打つだけ」で1つ目が置ける（＋を押させない）
    it("打つと、写真の上に出て見せ方を選べる", async () => {
        await pickImage();
        await type("朝の空");
        expect(overlay()?.textContent).toBe("朝の空");
        expect(screen.getByRole("switch", { name: "明朝" })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "空" })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "塗り" })).toBeInTheDocument();
    });

    it("字体を選ぶと、写真の上の文字が変わる", async () => {
        await pickImage();
        await type("朝の空");
        expect(overlay()?.style.fontFamily).toContain("Hiragino Sans");
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        expect(overlay()?.style.fontFamily, "選んでも字体が変わらない").toContain("Hiragino Mincho ProN");
        expect(screen.getByRole("switch", { name: "明朝" })).toHaveAttribute("aria-checked", "true");
    });

    it("色と下地と大きさを選べる", async () => {
        await pickImage();
        await type("朝の空");
        await userEvent.click(screen.getByRole("switch", { name: "黄" }));
        expect(overlay()?.style.color).toBe("rgb(255, 214, 10)");

        await userEvent.click(screen.getByRole("switch", { name: "塗り" }));
        expect(overlay()?.style.background).toBe("rgb(255, 214, 10)");
        expect(overlay()?.style.color).toBe("rgb(0, 0, 0)");

        // 大きさは**つまみ**（段階のチップは見分けられず気づかれなかった）
        const before = overlay()?.style.fontSize;
        const slider = screen.getByRole("slider", { name: "文字の大きさ" });
        fireEvent.change(slider, { target: { value: "0.14" } });
        expect(overlay()?.style.fontSize, "大きさが変わらない").not.toBe(before);
    });

    /**
     * 大きさは**つまみで無段階**。4段階のチップ（A A A A）は並べても
     * 違いが見分けられず、controlが在ることに気づかれなかった
     * （owner:「文字の大きさも変えたいよね」）。
     */
    it("大きさはつまみで、キーボードでも動く", async () => {
        await pickImage();
        await type("朝の空");
        const slider = screen.getByRole("slider", { name: "文字の大きさ" });
        expect(slider).toHaveAttribute("min");
        expect(slider).toHaveAttribute("max");

        const small = "0.04", big = "0.15";
        fireEvent.change(slider, { target: { value: small } });
        const a = parseFloat(overlay()!.style.fontSize);
        fireEvent.change(slider, { target: { value: big } });
        const b = parseFloat(overlay()!.style.fontSize);
        expect(b, "つまみを右へ動かしても大きくならない").toBeGreaterThan(a);
    });

    // **範囲の外は受けない**（画面を埋め尽くす／読めない大きさを作らない）
    it("範囲の外の値は挟む", async () => {
        await pickImage();
        await type("朝の空");
        const slider = screen.getByRole("slider", { name: "文字の大きさ" });
        fireEvent.change(slider, { target: { value: "99" } });
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        expect(posted()[0].texts[0].size).toBeLessThanOrEqual(0.16);
    });

    it("投稿に置いた文字が載る", async () => {
        await pickImage();
        await type("朝の空");
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        await userEvent.click(screen.getByRole("switch", { name: "桃" }));
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        const body = posted()[0];
        expect(body.texts).toHaveLength(1);
        expect(body.texts[0]).toMatchObject({ text: "朝の空", font: "mincho", color: "pink" });
        expect(typeof body.texts[0].x).toBe("number");
        // **文言は `texts` が持つ。** `caption` はサーバーが作る（2か所で持たない）
        expect("caption" in body, "文言を2か所で送っている").toBe(false);
    });

    it("文字が無ければ、何も送らない", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        expect("texts" in posted()[0], "文字が無いのに送っている").toBe(false);
    });

    // 開き直したときに前の文字を持ち越さない
    it("下書きを閉じると文字も戻る", async () => {
        await pickImage();
        await type("朝の空");
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["img"], "b.jpg", { type: "image/jpeg" }));
        await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
        expect(overlay(), "前の文字が残っている").toBeNull();
    });
});

/**
 * owner:「複数のテキストを別々に置くのもやりたい」
 *
 * **並びが重なり順**（後ろほど手前）。操作の欄は**選んでいる1つ**に効く。
 */
describe("ストーリーの文字: 複数置く", () => {
    const all = () => [...document.querySelectorAll('[role="dialog"] p[style*="translate"]')].map((e) => e.textContent);
    const add = () => userEvent.click(screen.getByRole("button", { name: "文字を追加" }));

    it("もう1つ置ける。打つ欄は選んでいる方に効く", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");
        expect(all(), "2つ目が置けていない").toEqual(["いち", "に"]);
    });

    it("触ると選べて、そちらの見せ方が変わる", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");
        // いま選んでいるのは2つ目。1つ目に触って選び直す
        await userEvent.pointer({ target: screen.getByText("いち"), keys: "[MouseLeft>]" });
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        expect(screen.getByText("いち").style.fontFamily, "選んだ方が変わっていない").toContain("Mincho");
        expect(screen.getByText("に").style.fontFamily, "選んでいない方まで変わった").not.toContain("Mincho");
    });

    // **触ったものが選ばれる**（いつも1つ目が選ばれるのでは困る）
    it("2つ目に触れば2つ目が選ばれる", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");
        // まず1つ目を選んでおく → 2つ目に触る
        await userEvent.pointer({ target: screen.getByText("いち"), keys: "[MouseLeft>]" });
        await userEvent.pointer({ target: screen.getByText("に"), keys: "[MouseLeft>]" });
        await userEvent.click(screen.getByRole("switch", { name: "明朝" }));
        expect(screen.getByText("に").style.fontFamily, "触った方が選ばれていない").toContain("Mincho");
        expect(screen.getByText("いち").style.fontFamily, "触っていない方が変わった").not.toContain("Mincho");
        // 打つ欄も、触った方を直す
        await type("ばん");
        expect(all()).toEqual(["いち", "にばん"]);
    });

    it("選んだものを消せる", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");
        await userEvent.click(screen.getByRole("button", { name: "この文字を消す" }));
        expect(all()).toEqual(["いち"]);
    });

    // 🔴 **消したあとに打つと、直すつもりで新しい文字ができていた。**
    // 選択が外れたままだと `editText` が「1つ目を作る」経路に入る
    it("消したあとは、残っている文字が選ばれる（打つと新しく作らない）", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");
        // 1つ目を選んでから消す
        await userEvent.pointer({ target: screen.getByText("いち"), keys: "[MouseLeft>]" });
        await userEvent.click(screen.getByRole("button", { name: "この文字を消す" }));
        expect(all()).toEqual(["に"]);
        await type("！");
        expect(all(), "打ったら新しい文字ができている").toEqual(["に！"]);
    });

    it("全部消すと、選ぶものが無くなる", async () => {
        await pickImage();
        await type("いち");
        await userEvent.click(screen.getByRole("button", { name: "この文字を消す" }));
        expect(all()).toEqual([]);
        expect(screen.queryByRole("button", { name: "この文字を消す" }), "押しても効かない的が残っている").toBeNull();
    });

    // **並びが重なり順**なので、手前に出すとは配列の最後へ移すこと
    it("いちばん手前へ動かせる", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");
        await userEvent.pointer({ target: screen.getByText("いち"), keys: "[MouseLeft>]" });
        await userEvent.click(screen.getByRole("button", { name: "いちばん手前へ" }));
        expect(all(), "手前へ動いていない").toEqual(["に", "いち"]);
    });

    it("1つしか無いときは「手前へ」を出さない（重なりようが無い）", async () => {
        await pickImage();
        await type("いち");
        expect(screen.queryByRole("button", { name: "いちばん手前へ" })).toBeNull();
    });

    it("上限まで置いたら「文字を追加」は押せない", async () => {
        await pickImage();
        await type("1");
        for (let i = 2; i <= STORY_TEXTS_MAX; i++) { await add(); await type(String(i)); }
        expect(all()).toHaveLength(STORY_TEXTS_MAX);
        expect(screen.getByRole("button", { name: "文字を追加" })).toBeDisabled();
    });

    /**
     * **掴んだ文字だけが動く。** いつも先頭が飛んでくると、2つ目を掴んだ
     * つもりで1つ目が消えた場所へ行く。
     *
     * jsdom にはレイアウトが無い（`getBoundingClientRect` が全部 0）ので、
     * 囲みの矩形だけ差し込む——`moveTextTo` は測れないと早期 return する
     */
    it("掴んだ文字だけが動く", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");

        const area = document.querySelector('[role="dialog"] .absolute.inset-0') as HTMLElement;
        area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });

        const before = [...document.querySelectorAll('[role="dialog"] p[style*="translate"]')]
            .map((e) => (e as HTMLElement).style.left);
        // 2つ目を掴んで、右下へ動かす
        fireEvent.pointerDown(screen.getByText("に"), { pointerId: 1, clientX: 200, clientY: 400 });
        fireEvent.pointerMove(area, { pointerId: 1, clientX: 320, clientY: 640 });
        fireEvent.pointerUp(area, { pointerId: 1 });

        const after = [...document.querySelectorAll('[role="dialog"] p[style*="translate"]')]
            .map((e) => (e as HTMLElement).style.left);
        expect(after[0], "掴んでいない方まで動いた").toBe(before[0]);
        expect(after[1], "掴んだ方が動いていない").not.toBe(before[1]);
        expect(after[1]).toBe("80%");
    });

    it("投稿には置いた順で全部載る", async () => {
        await pickImage();
        await type("いち");
        await add();
        await type("に");
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        expect(posted()[0].texts.map((t: { text: string }) => t.text)).toEqual(["いち", "に"]);
    });
});

/**
 * 置いている最中に**写真がどれだけ見えるか**。
 *
 * 320×568 の実測で**写真が 95px しか見えていなかった**——文字をどこへ置くか
 * 決められない。撮影地・曲・表示時間は最後に1回さわるもので、置いている
 * 最中には要らないので畳む。写真の余白をさわると選択が外れて戻る。
 */
describe("ストーリーの文字: 置いている間は、ほかの欄を畳む", () => {
    const area = () => document.querySelector('[role="dialog"] .absolute.inset-0') as HTMLElement;

    it("文字を選んでいる間は、撮影地・曲・表示時間を出さない", async () => {
        await pickImage();
        expect(screen.getByPlaceholderText(/撮影地/), "最初から隠れている").toBeInTheDocument();
        await type("朝の空");
        expect(screen.queryByPlaceholderText(/撮影地/), "選んでいるのに撮影地が出ている").toBeNull();
        expect(screen.queryByRole("button", { name: /曲を付ける/ })).toBeNull();
    });

    it("写真の余白をさわると選択が外れて、ほかの欄が戻る", async () => {
        await pickImage();
        await type("朝の空");
        fireEvent.pointerDown(area(), { pointerId: 9 });
        expect(screen.getByPlaceholderText(/撮影地/), "外しても戻らない").toBeInTheDocument();
        // 文字は消えていない（選択が外れただけ）
        expect(overlay()?.textContent).toBe("朝の空");
    });

    // 🔴 **文字の上で止めた指では外れない。** 伝わると選んだ直後に外れる
    it("文字をさわったときは外れない", async () => {
        await pickImage();
        await type("朝の空");
        fireEvent.pointerDown(area(), { pointerId: 9 });
        await userEvent.pointer({ target: screen.getByText("朝の空"), keys: "[MouseLeft>]" });
        expect(screen.queryByPlaceholderText(/撮影地/), "選んだ直後に外れている").toBeNull();
    });

    // **選んでいないのに字体や色を出さない**（押しても効かない的を並べない）
    it("選んでいなければ、字体や色の欄は出さない", async () => {
        await pickImage();
        await type("朝の空");
        expect(screen.getByRole("switch", { name: "明朝" })).toBeInTheDocument();
        fireEvent.pointerDown(area(), { pointerId: 9 });
        expect(screen.queryByRole("switch", { name: "明朝" }), "効かない的が残っている").toBeNull();
        // もう1つ足す口は残す（外したあとに増やせなくならない）
        expect(screen.getByRole("button", { name: "文字を追加" })).toBeInTheDocument();
    });
});

/**
 * 🔴 **投稿のボタンは、巻き取られる欄の外に置く。**
 *
 * 中に置いていたので、欄が伸びると画面の外へ落ちた——320×568 の実測で
 * **画面外**（スクロールすれば届くが、いちばん押すものが見えない）。
 * 文字の欄を足したこの差分で再発させた（台帳の `STORY-4` と同じ形）。
 *
 * jsdom にレイアウトは無いので**入れ子で見る**——外に在れば、
 * これから何を足しても落ちない。
 */
describe("ストーリーの下書き: 投稿のボタンの置き場所", () => {
    it("巻き取られる欄の中に入っていない", async () => {
        await pickImage();
        const post = screen.getByRole("button", { name: /ストーリーに投稿/ });
        const scroller = document.querySelector('[role="dialog"] .overflow-y-auto');
        expect(scroller, "巻き取られる欄が見つからない").not.toBeNull();
        expect(scroller!.contains(post), "投稿のボタンが巻き取られる欄の中にある").toBe(false);
    });
});

/**
 * キーボードで置き場所を決められるか。**指でなぞる以外の手が無いと、
 * 置き場所を決められない人がいる**（このリポジトリは同じ形を何度も直している）。
 */
describe("ストーリーの文字: キーボード", () => {
    it("文字に到達できて、押された状態が分かる", async () => {
        await pickImage();
        await type("朝の光");
        const el = screen.getByRole("button", { name: /文字「朝の光」/ });
        expect(el.tabIndex, "キーボードで到達できない").toBe(0);
        expect(el).toHaveAttribute("aria-pressed", "true");
    });

    it("矢印キーで動く", async () => {
        await pickImage();
        await type("朝の光");
        const el = screen.getByRole("button", { name: /文字「朝の光」/ });
        const before = el.style.left;
        fireEvent.keyDown(el, { key: "ArrowRight" });
        const after = (screen.getByRole("button", { name: /文字「朝の光」/ }) as HTMLElement).style.left;
        expect(after, "矢印キーで動かない").not.toBe(before);
        expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
    });

    it("上下にも動く。Shift で大きく動く", async () => {
        await pickImage();
        await type("朝の光");
        const top0 = screen.getByRole("button", { name: /文字「朝の光」/ }).style.top;
        fireEvent.keyDown(screen.getByRole("button", { name: /文字「朝の光」/ }), { key: "ArrowDown" });
        const top1 = screen.getByRole("button", { name: /文字「朝の光」/ }).style.top;
        expect(parseFloat(top1), "下へ動かない").toBeGreaterThan(parseFloat(top0));

        fireEvent.keyDown(screen.getByRole("button", { name: /文字「朝の光」/ }), { key: "ArrowDown", shiftKey: true });
        const top2 = screen.getByRole("button", { name: /文字「朝の光」/ }).style.top;
        expect(parseFloat(top2) - parseFloat(top1), "Shift でも同じ幅しか動かない")
            .toBeGreaterThan(parseFloat(top1) - parseFloat(top0));
    });

    // **端は必ず挟む**（半分が画面の外へ出ない）
    it("端まで行っても外へ出ない", async () => {
        await pickImage();
        await type("朝の光");
        for (let i = 0; i < 40; i++) {
            fireEvent.keyDown(screen.getByRole("button", { name: /文字「朝の光」/ }), { key: "ArrowLeft", shiftKey: true });
        }
        expect(parseFloat(screen.getByRole("button", { name: /文字「朝の光」/ }).style.left)).toBeGreaterThan(0);
    });

    // 見る側では押せるものを増やさない
    it("見る側では、文字はキーボードの的にしない", async () => {
        await pickImage();
        await type("朝の光");
        // 下書きの中でだけ的になる。見る側は `StoryViewer.textStyle.test.tsx` が見る
        expect(screen.getByRole("button", { name: /文字「朝の光」/ })).toBeInTheDocument();
    });
});
