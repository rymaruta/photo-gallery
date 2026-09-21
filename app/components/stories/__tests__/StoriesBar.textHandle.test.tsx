import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * 角のハンドルで「大きさと傾きを変える」——**`StoriesBar` 側の配線**。
 *
 * 計算そのものは `lib/utils/__tests__/storyTransform.test.ts`、描き方は
 * `StoryTextOverlay.test.tsx` が見る。ここで見たいのは**繋ぎ目**:
 *
 *  1. ハンドルを掴んだ指の動きが「文字を運ぶ」に**流れない**
 *  2. **掴んだ指のぶんだけ**見る（端末を支える親指で壊れない）
 *  3. 潰れた箱からは始めない
 *
 * ⚠️ **jsdom にはレイアウトが無い**ので `getBoundingClientRect` は全部 0 を
 * 返す。ここは「箱の大きさ」が判定に効く経路なので、**測る所だけ**を
 * 差し替えて実際の寸法を与える（差し替えないと、何を試しても
 * 「潰れた箱」の枝に落ちて**何も検証しないテスト**になる）。
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
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    compressImage: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));
vi.mock("@/lib/utils/video", () => ({ toUploadSafeVideo: async (f: File) => f }));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: (f: File) => mockExtract(f),
    reverseGeocode: (...a: unknown[]) => mockReverse(...a),
    extractCameraExif: vi.fn(),
}));

import StoriesBar from "../StoriesBar";
import { STORY_STAMPS, STORY_TEXTS_MAX } from "@/lib/utils/storyText";

const api = () => async (url: string, init?: { method?: string }) => {
    if (url === "/stories" && init?.method === "POST") return { ok: true, json: async () => ({ success: true }) };
    if (url.startsWith("/presigned-url")) return { ok: true, json: async () => ({ uploadUrl: "https://s3/put", key: "uploads/me/s.webp", publicUrl: "https://cdn/uploads/me/s.webp" }) };
    if (url === "/stories") return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
};

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

async function pickImage() {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["img"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
}

const overlay = () => document.querySelector('[role="dialog"] p[style*="translate"]') as HTMLElement;
const handle = () => document.querySelector("[data-story-text-handle]") as HTMLElement | null;

/** 文字の箱に寸法を与える（中心 (100,100)・100×40） */
function sizeTheBox(el: HTMLElement, rect = { left: 50, top: 80, width: 100, height: 40 }) {
    el.getBoundingClientRect = () => ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left, y: rect.top, toJSON: () => ({}),
    }) as DOMRect;
}

/** いま出ている文字の transform から傾きを読む（無ければ 0） */
const shownRotate = () => {
    const m = /rotate\((-?\d+)deg\)/.exec(overlay()?.style.transform ?? "");
    return m ? Number(m[1]) : 0;
};

const type = async (text: string) => {
    await userEvent.type(screen.getByRole("textbox", { name: "文字" }), text);
};

describe("角のハンドル（StoriesBar の配線）", () => {
    it("打つとハンドルが出る", async () => {
        await pickImage();
        await type("朝");
        expect(handle(), "選んでいる文字にハンドルが出ていない").not.toBeNull();
    });

    /**
     * **掴んだ指の動きが「文字を運ぶ」に流れないこと。**
     *
     * 流れると、回しながら文字が指を追って飛んでいく。
     */
    it("ハンドルをなぞると傾きが変わり、置き場所は変わらない", async () => {
        await pickImage();
        await type("朝");
        sizeTheBox(overlay());
        const before = overlay().style.left;

        // 中心 (100,100) の右 (200,100) を掴む → 真下 (100,200) へ回す＝ +90度
        fireEvent.pointerDown(handle()!, { pointerId: 1, clientX: 200, clientY: 100 });
        fireEvent.pointerMove(overlay().parentElement!, { pointerId: 1, clientX: 100, clientY: 200 });

        expect(shownRotate(), "傾きが変わっていない").toBe(90);
        expect(overlay().style.left, "回したのに置き場所まで動いた").toBe(before);
    });

    /**
     * **掴んだ指のぶんだけ見る。**
     *
     * 囲みは画面いっぱい（`absolute inset-0`）なので、端末を支える親指が
     * 触れれば別の `pointerId` が来る。見分けずに通すと、その指の座標で
     * 回転が決まって**文字が飛ぶ**。
     */
    it("別の指が動いても、回転はその座標に引きずられない", async () => {
        await pickImage();
        await type("朝");
        sizeTheBox(overlay());

        fireEvent.pointerDown(handle()!, { pointerId: 1, clientX: 200, clientY: 100 });
        fireEvent.pointerMove(overlay().parentElement!, { pointerId: 1, clientX: 100, clientY: 200 });
        expect(shownRotate()).toBe(90);

        // 支える指（別の pointerId）が画面の隅で動く
        fireEvent.pointerMove(overlay().parentElement!, { pointerId: 2, clientX: 5, clientY: 5 });
        expect(shownRotate(), "支える指の座標で回転が決まっている").toBe(90);
    });

    /**
     * **別の指が離れても、回転を終わらせない・控えを残さない。**
     *
     * 以前はここで早く `return` していたので `bgPressRef` が残り、
     * 掴み続けている指の次の動きで**文字がその指の位置へ飛んだ**。
     */
    it("別の指が離れても、掴んでいる指の回転は続く", async () => {
        await pickImage();
        await type("朝");
        sizeTheBox(overlay());
        const left = overlay().style.left;

        fireEvent.pointerDown(handle()!, { pointerId: 1, clientX: 200, clientY: 100 });
        fireEvent.pointerMove(overlay().parentElement!, { pointerId: 1, clientX: 100, clientY: 200 });
        // 支える指が離れる
        fireEvent.pointerUp(overlay().parentElement!, { pointerId: 2, clientX: 5, clientY: 5 });
        // 掴んでいる指はまだ回せる
        fireEvent.pointerMove(overlay().parentElement!, { pointerId: 1, clientX: 0, clientY: 100 });

        expect(shownRotate(), "別の指の pointerup で回転が終わっている").toBe(180);
        expect(overlay().style.left, "文字が運ばれてしまっている").toBe(left);
    });

    // 離したあとは、選んだままにする（直した直後に選択が外れない）
    it("ハンドルを離しても、その文字は選ばれたまま", async () => {
        await pickImage();
        await type("朝");
        sizeTheBox(overlay());

        fireEvent.pointerDown(handle()!, { pointerId: 1, clientX: 200, clientY: 100 });
        fireEvent.pointerMove(overlay().parentElement!, { pointerId: 1, clientX: 100, clientY: 200 });
        fireEvent.pointerUp(overlay().parentElement!, { pointerId: 1, clientX: 100, clientY: 200 });

        expect(handle(), "離したら選択が外れてハンドルが消えた").not.toBeNull();
        expect(shownRotate()).toBe(90);
    });

    /**
     * **潰れた箱からは始めない。**
     *
     * 中心からの距離がほぼ 0 の点を掴むと、距離の比が一気に跳ねて
     * **大きさが上限に張り付き**、半径ほぼ 0 から測った角度は雑音なので
     * **傾きも無関係な値に飛ぶ**。
     */
    it("箱が潰れているときは掴めない（大きさが上限に張り付かない）", async () => {
        await pickImage();
        await type("朝");
        // jsdom の既定（全部 0）のまま＝潰れた箱
        const sizeBefore = overlay().style.fontSize;

        fireEvent.pointerDown(handle()!, { pointerId: 1, clientX: 200, clientY: 100 });
        fireEvent.pointerMove(overlay().parentElement!, { pointerId: 1, clientX: 400, clientY: 400 });

        expect(shownRotate(), "潰れた箱から傾きが決まっている").toBe(0);
        expect(overlay().style.fontSize, "潰れた箱から大きさが決まっている").toBe(sizeBefore);
    });
});

/**
 * スタンプ（⑨-2）。
 *
 * ここで見たいのは**繋ぎ目**——データの規則は
 * `lib/utils/__tests__/storyText.test.ts`、描き方は
 * `StoryTextOverlay.test.tsx` が見る。
 *
 * 固定したいのは3つ:
 *
 *  1. **文字が1つも無くても置ける**（スタンプだけの投稿はありうる）
 *  2. **スタンプに字体・色・下地の欄を出さない**（押しても効かない的）
 *  3. **上限は文字と合わせて数える**
 */
const stamps = () => screen.queryAllByRole("button", { name: STORY_STAMPS.heart.label });
const placed = () => document.querySelectorAll('[role="dialog"] p[style*="translate"]');

describe("スタンプ（StoriesBar の配線）", () => {
    it("文字が1つも無くても置ける", async () => {
        await pickImage();
        expect(placed(), "まだ何も置いていない").toHaveLength(0);
        await userEvent.click(stamps()[0]);
        expect(placed(), "スタンプが写真の上に出ていない").toHaveLength(1);
        expect(placed()[0].textContent).toBe(STORY_STAMPS.heart.glyph);
    });

    // **押しても効かない欄を置かない。** 字体・色・下地は絵柄に効かない
    it("スタンプを選んでいる間は、字体・色・下地の欄を出さない", async () => {
        await pickImage();
        await userEvent.click(stamps()[0]);
        for (const name of ["字体", "色", "下地"]) {
            expect(screen.queryByRole("tab", { name }), `${name} の欄が出ている`).toBeNull();
        }
        // 大きさは効くので出す
        expect(screen.getByRole("slider", { name: "スタンプの大きさ" })).toBeInTheDocument();
    });

    // 文字を選び直せば、文字の欄が戻る
    it("文字を選び直すと、字体の欄が戻る", async () => {
        await pickImage();
        await type("朝");
        await userEvent.click(stamps()[0]);
        expect(screen.queryByRole("tab", { name: "字体" })).toBeNull();
        // 置いた文字を触って選び直す
        fireEvent.pointerDown(placed()[0]);
        expect(screen.getByRole("tab", { name: "字体" })).toBeInTheDocument();
    });

    it("置いたスタンプにもハンドルが出て、回せる", async () => {
        await pickImage();
        await userEvent.click(stamps()[0]);
        const el = placed()[0] as HTMLElement;
        sizeTheBox(el);
        expect(handle(), "スタンプにハンドルが出ていない").not.toBeNull();
        fireEvent.pointerDown(handle()!, { pointerId: 1, clientX: 200, clientY: 100 });
        fireEvent.pointerMove(el.parentElement!, { pointerId: 1, clientX: 100, clientY: 200 });
        const m = /rotate\((-?\d+)deg\)/.exec(el.style.transform);
        expect(m && Number(m[1]), "スタンプが回っていない").toBe(90);
    });

    // **上限は文字と合わせて数える**（多いほど読めなくなるのは絵柄も同じ）
    it("上限まで置いたら、スタンプを押せなくする", async () => {
        await pickImage();
        for (let i = 0; i < STORY_TEXTS_MAX; i++) await userEvent.click(stamps()[0]);
        expect(placed()).toHaveLength(STORY_TEXTS_MAX);
        expect(stamps()[0], "上限を超えて置ける").toBeDisabled();
    });
});

/**
 * **スタンプを置いたあと、そのまま題を打てること。**
 *
 * `editText` だけが共用体に追従しておらず、スタンプを選んだ状態で打つと
 * `{...スタンプ, text: 値}` を当てていた。欄は文字の側しか見ないので
 * **1文字も入らず**、そのくせスタンプの中身に `text` が生えて
 * サーバーが落とす＝**打った文字が黙って消える**。
 * `addStamp` は置いた直後に選ぶので、いちばん自然な流れで踏む。
 */
describe("スタンプを置いたあとに打つ", () => {
    it("スタンプを置いてから打つと、新しい文字ができる", async () => {
        await pickImage();
        await userEvent.click(stamps()[0]);
        expect(placed()).toHaveLength(1);

        await type("朝の空");

        // スタンプ＋文字の2つになっている
        expect(placed(), "文字が増えていない").toHaveLength(2);
        const shown = [...placed()].map((p) => p.textContent);
        expect(shown, "打った文字が写真の上に出ていない").toContain("朝の空");
        // スタンプは絵柄のまま（文言が生えていない）
        expect(shown[0]).toBe(STORY_STAMPS.heart.glyph);
        // 打つ欄にも入っている（選び直せている）
        expect((screen.getByRole("textbox", { name: "文字" }) as HTMLInputElement).value).toBe("朝の空");
    });

    // 読み上げの名前も、消す相手に合わせる
    it("スタンプを選んでいるときは「このスタンプを消す」と名乗る", async () => {
        await pickImage();
        await userEvent.click(stamps()[0]);
        expect(screen.getByRole("button", { name: "このスタンプを消す" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "この文字を消す" })).toBeNull();
    });
});
