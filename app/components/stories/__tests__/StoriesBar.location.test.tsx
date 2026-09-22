import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **「残す」だけでは段差を渡り切れない。**
// ストーリーから作った写真は撮影地が空なので、本人が編集画面で打つまで
// 地図にも `/location/<スラッグ>` にも載らない。このサイトの価値は
// 撮影地 → 地図 → 集約ページ → 検索流入 という連なりなので、そこが切れて
// いると「残した」がただの下書きで終わる。
//
// **撮影地は、EXIF を落とす前の元ファイルから読む。** 投稿の直前に
// `toUploadSafeFile` が GPS ごと消すので、ここを逃すと二度と取れない。

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
async function pickImage() {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["img"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
    // 撮影地は「位置情報」の道具の中（1度に1つだけ開く・最終版モック 08）
    await userEvent.click(screen.getByRole("tab", { name: "位置情報" }));
}

// **投稿の往復を増やさない。** ここで `GET /user/profile` を待っていたが、
// `createStory` は**クライアントの申告を受け取らない**（なりすまし防止で
// サーバーが引く）。捨てられる値のために Lambda を1本余計に叩き、その往復ぶん
// 利用者を待たせていた——関数ごとにコールドスタートがあり、同時実行は
// アカウント全体で10しかないので、待ちはミリ秒では済まない。
describe("投稿の往復", () => {
    it("投稿の前にプロフィールを取りに行かない", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/user/profile"),
            "捨てられる値のために往復を1つ増やしている").toBe(false);
    });

    it("表示名を送らない（サーバーが引く）", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
        await waitFor(() => expect(posted()).toHaveLength(1));
        expect("displayName" in posted()[0], "受け取られない値を送っている").toBe(false);
    });
});

describe("ストーリーの撮影地", () => {
    it("写真の GPS から地名を自動で入れる", async () => {
        mockExtract.mockResolvedValue({ latitude: 35.4567, longitude: 139.6321 });
        mockReverse.mockResolvedValue("横浜市");
        await pickImage();
        await waitFor(() => expect(
            (screen.getByLabelText("撮影地") as HTMLInputElement).value,
            "GPS から地名が入っていない").toBe("横浜市"));
    });

    // **EXIF を落とす前の元ファイルから読む**（投稿時には GPS が消えている）
    it("読むのは選んだ原本", async () => {
        mockExtract.mockResolvedValue({ latitude: 1, longitude: 2 });
        await pickImage();
        await waitFor(() => expect(mockExtract).toHaveBeenCalled());
        expect(await (mockExtract.mock.calls[0][0] as File).text()).toBe("img");
    });

    it("地名と座標を投稿に載せる（残したときに地図へ載る材料）", async () => {
        mockExtract.mockResolvedValue({ latitude: 35.4567, longitude: 139.6321 });
        mockReverse.mockResolvedValue("横浜市");
        await pickImage();
        await waitFor(() => expect((screen.getByLabelText("撮影地") as HTMLInputElement).value).toBe("横浜市"));
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));

        await waitFor(() => expect(posted()).toHaveLength(1));
        expect(posted()[0].location).toBe("横浜市");
        // **送る前にも丸める**（サーバーも `sanitizeCoords` で丸めるが、
        // 写真のアップロード画面は送る前にも丸めている＝二重）。
        // 一度「丸めはサーバー側だけ」と書いていたが、それは写真側と違った
        expect(posted()[0].coords, "生の緯度経度を送っている").toEqual({ lat: 35.46, lng: 139.63 });
    });

    // 地名の無い座標は画面に出しようがなく、残しても「名前の無い点」が増えるだけ
    it("地名を消したら、座標も送らない", async () => {
        mockExtract.mockResolvedValue({ latitude: 35.45, longitude: 139.63 });
        mockReverse.mockResolvedValue("横浜市");
        await pickImage();
        const input = await screen.findByLabelText("撮影地");
        await waitFor(() => expect((input as HTMLInputElement).value).toBe("横浜市"));
        await userEvent.clear(input);
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));

        await waitFor(() => expect(posted()).toHaveLength(1));
        expect("location" in posted()[0]).toBe(false);
        expect("coords" in posted()[0], "地名の無い座標を送っている").toBe(false);
    });

    // 写真のアップロード画面と同じ設定を見る（勝手に位置を引かない）
    it("GPS 自動入力がオフなら引きに行かない", async () => {
        localStorage.setItem("jp_gps_autofill", "0");
        mockExtract.mockResolvedValue({ latitude: 35.45, longitude: 139.63 });
        await pickImage();
        await new Promise((r) => setTimeout(r, 30));
        expect(mockExtract, "設定がオフなのに位置を読んでいる").not.toHaveBeenCalled();
        expect((screen.getByLabelText("撮影地") as HTMLInputElement).value).toBe("");
    });

    // 後から届く値で、打ち始めた文字を消さない
    it("自分で打っていたら、あとから届いた地名で上書きしない", async () => {
        let release!: (v: string) => void;
        mockExtract.mockResolvedValue({ latitude: 35.45, longitude: 139.63 });
        mockReverse.mockImplementation(() => new Promise<string>((r) => { release = r; }));
        await pickImage();
        const input = await screen.findByLabelText("撮影地");
        await userEvent.type(input, "自分で打った場所");
        release("横浜市");
        await new Promise((r) => setTimeout(r, 30));
        expect((input as HTMLInputElement).value, "打った文字を上書きしている").toBe("自分で打った場所");
    });

    it("GPS が無い写真では、何も入れない（引きにも行かない）", async () => {
        mockExtract.mockResolvedValue({});
        await pickImage();
        await waitFor(() => expect(mockExtract).toHaveBeenCalled());
        expect(mockReverse, "座標が無いのに地名を引きに行っている").not.toHaveBeenCalled();
        expect((screen.getByLabelText("撮影地") as HTMLInputElement).value).toBe("");
    });
});


// **待っている間に別の写真へ移っても、前の場所を持ち越さない。**
// 位置を引くのに数秒かかるので、その間に閉じて別の写真（や動画）を選ぶと、
// 前の写真の撮影地が次の投稿に載る——自宅で撮った1枚を選んで閉じ、次に
// 別の写真を上げると、**ログイン中の全員のトレイに自宅の地名が出る**。
// そのまま「残す」を押せば公開写真の撮影地と地図のピンになる。
describe("撮影地を持ち越さない", () => {
    /** 逆ジオコーディングを手で解決できるようにする */
    const heldReverse = () => {
        let release!: (v: string) => void;
        mockReverse.mockImplementation(() => new Promise<string>((r) => { release = r; }));
        return { release: (v: string) => release(v) };
    };

    it("閉じて別の写真を選んだら、前の撮影地は載らない", async () => {
        const held = heldReverse();
        mockExtract.mockResolvedValue({ latitude: 35.45, longitude: 139.63 });
        const { container } = render(<StoriesBar />);
        await screen.findByText("あなた");
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["A"], "a.jpg", { type: "image/jpeg" }));
        await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });

        // 引いている途中で閉じて、別の写真（GPS 無し）を選ぶ
        await userEvent.click(screen.getByLabelText("キャンセル"));
        mockExtract.mockResolvedValue({});
        await userEvent.upload(input, new File(["B"], "b.jpg", { type: "image/jpeg" }));
        await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
        await userEvent.click(screen.getByRole("tab", { name: "位置情報" }));

        // ここで1枚目の地名がようやく届く
        held.release("横浜 みなとみらい");
        await new Promise((r) => setTimeout(r, 30));

        expect((screen.getByLabelText("撮影地") as HTMLInputElement).value,
            "前の写真の撮影地が次の下書きに載っている").toBe("");
    });

    // 動画は `toUploadSafeVideo` が GPS を落とす前提。**欄そのものを出さない**
    // （押しても効かない欄を置かない。サーバーも動画の位置は受けない）
    it("動画には撮影地の欄を出さない", async () => {
        const restore = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
            const el = Object.getPrototypeOf(document).createElement.call(document, tag);
            if (tag === "video") {
                Object.defineProperty(el, "duration", { configurable: true, get: () => 5 });
                Object.defineProperty(el, "src", {
                    configurable: true,
                    set() { (el as HTMLVideoElement).onloadedmetadata?.(new Event("loadedmetadata")); },
                    get() { return "blob:x"; },
                });
            }
            return el;
        }) as typeof document.createElement);
        try {
            const { container } = render(<StoriesBar />);
            await screen.findByText("あなた");
            const input = container.querySelector('input[type="file"]') as HTMLInputElement;
            await userEvent.upload(input, new File(["V"], "v.mp4", { type: "video/mp4" }));
            await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
            expect(screen.queryByLabelText("撮影地"), "動画に撮影地の欄を出している").toBeNull();
        } finally {
            restore.mockRestore();
        }
    });

    // 引いたのは選んだ時点。待っている間に切られたら送らない
    it("待っている間に GPS 自動入力を切ったら、送らない", async () => {
        mockExtract.mockResolvedValue({ latitude: 35.45, longitude: 139.63 });
        mockReverse.mockResolvedValue("横浜 みなとみらい");
        await pickImage();
        await waitFor(() => expect((screen.getByLabelText("撮影地") as HTMLInputElement).value).toBe("横浜 みなとみらい"));

        localStorage.setItem("jp_gps_autofill", "0");
        await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));

        await waitFor(() => expect(posted()).toHaveLength(1));
        expect("location" in posted()[0], "切ったのに送っている").toBe(false);
    });
});
