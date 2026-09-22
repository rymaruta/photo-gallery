import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * ストーリーの公開設定（モックの「公開設定」）。
 *
 * ここで見るのは**画面が何を送るか**だけ。実際に絞るのはサーバー
 * （`api-user/src/__tests__/storyPrivacy.test.ts`）——画面だけで守ると、
 * 直接叩く経路が素通りになる。
 *
 * **既定と同じときは送らない。** サーバーも既定は保存しないので結果は
 * 同じだが、送らなければ古い版のサーバーでも今までどおり動く。
 *
 * 🔴 **公開範囲はもう無い**（ストーリーはフォロワーだけが見る）。
 * その節はいちばん上で、選ぶ口が戻っていないことを見る。
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

const api = () => async (url: string, init?: { method?: string; body?: string }) => {
    if (url === "/stories" && init?.method === "POST") return { ok: true, json: async () => ({ success: true }) };
    if (url.startsWith("/upload/presigned-url")) {
        return { ok: true, json: async () => ({ presignedUrl: "https://s3/put", key: "uploads/me/s.webp", publicUrl: "https://cdn/uploads/me/s.webp" }) };
    }
    if (url === "/stories") return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
};
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

async function pick(file: File) {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
}
const pickImage = () => pick(new File(["img"], "a.jpg", { type: "image/jpeg" }));
/** 撮影地の欄は「位置情報」の道具の中（1度に1つだけ開く・最終版モック 08） */
const openLocationTool = async () => {
    await userEvent.click(screen.getByRole("tab", { name: "位置情報" }));
};
const post = async () => {
    await userEvent.click(screen.getByRole("button", { name: /ストーリーに投稿/ }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    return posted()[0] as Record<string, unknown>;
};

describe("公開設定: 公開範囲は選ばせない", () => {
    // 🔴 ストーリーはフォロワーだけが見る（2026-09-22・owner の判断。
    // 経緯は `api-user/src/storyVisibility.ts`）。以前ここには
    // 「全員に公開／フォロワーのみ」の2択があり、その「全員」は
    // **ログインした全員**の意味で、追っていない会員にも配っていた
    it("公開範囲の選択肢を出さない", async () => {
        await pickImage();
        for (const name of [/全員に公開/, /フォロワーのみ/, /親しい友達/]) {
            expect(screen.queryByRole("button", { name }), String(name)).toBeNull();
        }
    });

    // **選べないからこそ、誰に届くかは言う**
    it("フォロワーだけに出ると書いてある", async () => {
        await pickImage();
        expect(screen.getByText(/ストーリーはフォロワーだけに表示されます/)).toBeTruthy();
    });

    // 送ると、古い版のサーバーがその値で絞る（画面には選ぶ口が無いので直せない）
    it("`visibility` を送らない", async () => {
        await pickImage();
        expect(await post(), "死んだ列を送っている").not.toHaveProperty("visibility");
    });
});

describe("公開設定: アーカイブに自動保存", () => {
    // **既定は切**＝これまでどおり24時間で消える。残るのは本人が入にしたぶんだけ
    it("既定は切で、その値は送らない", async () => {
        await pickImage();
        expect(screen.getByRole("switch", { name: "アーカイブに自動保存" })).toHaveAttribute("aria-checked", "false");
        expect(await post()).not.toHaveProperty("archive");
    });

    it("入にすると archive: true を送る", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("switch", { name: "アーカイブに自動保存" }));
        expect(screen.getByRole("switch", { name: "アーカイブに自動保存" })).toHaveAttribute("aria-checked", "true");
        expect((await post()).archive).toBe(true);
    });

    // 残すと、次の投稿が黙ってアーカイブに残る（公開範囲と同じ理由で戻す）
    it("閉じて選び直すと切に戻っている", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("switch", { name: "アーカイブに自動保存" }));
        await userEvent.click(screen.getByRole("button", { name: /キャンセル|閉じる/ }));
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["img2"], "b.jpg", { type: "image/jpeg" }));
        await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
        expect(screen.getByRole("switch", { name: "アーカイブに自動保存" })).toHaveAttribute("aria-checked", "false");
    });
});

describe("公開設定: 返信を許可", () => {
    it("既定は入で、その値は送らない", async () => {
        await pickImage();
        expect(screen.getByRole("switch", { name: "返信を許可" })).toHaveAttribute("aria-checked", "true");
        expect(await post()).not.toHaveProperty("allowReplies");
    });

    it("切ると allowReplies: false を送る", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("switch", { name: "返信を許可" }));
        expect(screen.getByRole("switch", { name: "返信を許可" })).toHaveAttribute("aria-checked", "false");
        expect((await post()).allowReplies).toBe(false);
    });
});

describe("公開設定: 位置情報を表示", () => {
    const withGps = async () => {
        mockExtract.mockResolvedValue({ latitude: 35.4567, longitude: 139.6321 });
        mockReverse.mockResolvedValue("横浜市");
        await pickImage();
        await openLocationTool();
        await waitFor(() => expect((screen.getByLabelText("撮影地") as HTMLInputElement).value).toBe("横浜市"));
    };
    /** 「位置情報を表示」は公開設定の中（道具の欄とは別に常に出ている） */

    it("既定は入。地名と座標をそのまま送る", async () => {
        await withGps();
        expect(screen.getByRole("switch", { name: "位置情報を表示" })).toHaveAttribute("aria-checked", "true");
        const body = await post();
        expect(body.location).toBe("横浜市");
        expect(body.coords).toBeDefined();
    });

    // **隠すのではなく持たない。** 保存しなければ、一覧にも、残した写真の
    // 撮影地（`storyKeep.ts`）にも、地図にも出ない
    it("切ると地名も座標も送らない", async () => {
        await withGps();
        await userEvent.click(screen.getByRole("switch", { name: "位置情報を表示" }));
        const body = await post();
        expect(body, "切ったのに地名を送っている").not.toHaveProperty("location");
        expect(body, "切ったのに座標を送っている").not.toHaveProperty("coords");
    });

    it("切っても撮影地の欄の文字は消さない（入れ直せる）", async () => {
        await withGps();
        await userEvent.click(screen.getByRole("switch", { name: "位置情報を表示" }));
        expect((screen.getByLabelText("撮影地") as HTMLInputElement).value).toBe("横浜市");
        await userEvent.click(screen.getByRole("switch", { name: "位置情報を表示" }));
        expect((await post()).location).toBe("横浜市");
    });

    // **設定（`jp_gps_autofill`）が効くのは、GPS から来た地名だけ。**
    //
    // 設定を切っている人は自動入力を受けないので、欄に在る文字は必ず自分で
    // 打ったもの。そこまで落としていたので、「位置情報を表示」が入のままで
    // **何も送られない**——画面に出した入切がそのまま嘘になっていた
    it("GPS 自動入力を切っていても、手で打った撮影地は送る", async () => {
        localStorage.setItem("jp_gps_autofill", "0");
        await pickImage();
        await openLocationTool();
        expect((screen.getByLabelText("撮影地") as HTMLInputElement).value,
            "前提が崩れている（設定オフなのに自動で入っている）").toBe("");
        await userEvent.type(screen.getByLabelText("撮影地"), "京都 嵐山");
        expect((await post()).location, "手で打った撮影地が落ちている").toBe("京都 嵐山");
    });

    it("GPS から入った地名は、待っている間に設定を切られたら送らない", async () => {
        // 既存の守り（選んだ時点の値を、あとで切られたら出さない）はそのまま
        await withGps();
        localStorage.setItem("jp_gps_autofill", "0");
        expect(await post()).not.toHaveProperty("location");
    });

    it("GPS で入った地名を打ち直したら、設定を切られても送る（本人の文字）", async () => {
        await withGps();
        await userEvent.clear(screen.getByLabelText("撮影地"));
        await userEvent.type(screen.getByLabelText("撮影地"), "嵐山 竹林の小径");
        localStorage.setItem("jp_gps_autofill", "0");
        expect((await post()).location).toBe("嵐山 竹林の小径");
    });

    // 動画は `toUploadSafeVideo` が GPS を落とし、サーバーも位置を受けない
    // ——撮影地の欄と同じ条件で出す（押しても効かない欄を置かない）
    it("動画には出さない（撮影地の欄と同じ条件）", async () => {
        // jsdom は動画のメタデータを読まないので、長さを同期で返す
        // （`StoriesBar.video.test.tsx` の `stubVideoMetadata` と同じ手）
        const real = document.createElement.bind(document);
        const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string, opts?: ElementCreationOptions) => {
            const el = real(tag, opts);
            if (tag === "video") {
                Object.defineProperty(el, "duration", { value: 5, configurable: true });
                Object.defineProperty(el, "src", {
                    configurable: true,
                    set() { (el as HTMLVideoElement).onloadedmetadata?.(new Event("loadedmetadata")); },
                    get() { return "blob:x"; },
                });
            }
            return el;
        });
        await pick(new File(["vid"], "a.mp4", { type: "video/mp4" }));
        spy.mockRestore();
        expect(screen.queryByLabelText("撮影地"), "前提が崩れている（動画に撮影地の欄が出ている）").toBeNull();
        expect(screen.queryByRole("switch", { name: "位置情報を表示" })).toBeNull();
        // 公開範囲と返信は動画にも要る
        expect(screen.getByRole("switch", { name: "返信を許可" })).toBeTruthy();
    });
});

describe("公開設定: 下書きを閉じたら戻す", () => {
    // 残すと、一度返信を切った人の次の投稿が黙って切られたまま出る
    // （画面は閉じているので気づけない）
    it("閉じて選び直すと既定に戻っている", async () => {
        await pickImage();
        await userEvent.click(screen.getByRole("switch", { name: "返信を許可" }));
        await userEvent.click(screen.getByRole("switch", { name: "位置情報を表示" }));
        await userEvent.click(screen.getByRole("button", { name: /キャンセル|閉じる/ }));

        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["img2"], "b.jpg", { type: "image/jpeg" }));
        await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
        expect(screen.getByRole("switch", { name: "返信を許可" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("switch", { name: "位置情報を表示" })).toHaveAttribute("aria-checked", "true");
    });
});
