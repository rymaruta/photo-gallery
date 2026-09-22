import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

/**
 * 🔴 **絞った写真を渡しても、描かれるものが1つも変わらないこと。**
 *
 * `SpotPage` はビューアに `slimForViewer(photo)` を渡す。項目が1つ落ちても
 * **例外にならない**ので、説明文も撮影情報も地図の導線も**黙って空**になる
 * ——同じ写真をホームから開いたときと中身が別物になる（2026-09-22 に
 * 実際に起きた。13項目が落ちてキャプションが空だった）。
 *
 * ## 綴りで数える見張り（`lib/utils/__tests__/viewerFields.test.ts`）では足りない
 *
 * あちらは `GalleryModal/*.tsx` の中の `photo.X` / `p.X` を数えるが、
 * **写真を丸ごと渡して中で項目を読む関数**は見えない。実際に見落としていた:
 *
 *     photoAltText(p, locale)   … alt / title / location   → 残っていた ✅
 *     getPreferredMapLink(p)    … **mapLinks** / coords / geoApprox → 落ちていた ❌
 *
 * `mapLinks` という綴りはビューアのソースに1文字も出てこない。
 * **だから「描いたもの」で突き合わせる**——`<a href>` も `<img src>` も
 * 文字も全部ひとつの写しにして、丸ごとと絞ったぶんで比べる。
 * 新しい項目をビューアが読み始めて `slimForViewer` に足し忘れた日に、
 * ここが落ちて教える。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import GalleryModal from "../index";
import { slimForViewer } from "@/lib/utils/related";
import type { Photo } from "@/lib/data/photos";

beforeEach(() => {
    localStorage.clear();
    mockShowToast.mockReset();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 7 }) });
    mockUserFetch.mockReset().mockImplementation((p: string) =>
        Promise.resolve(p.startsWith("/user/saves/")
            ? { ok: true, json: async () => ({ saved: false }) }
            : { ok: true, json: async () => ({ liked: false }) }));
});
afterEach(() => { localStorage.clear(); });

/**
 * ビューアが読みうる項目を全部入れた1枚。**読まない項目も混ぜる**
 * （`tags` / `date` / `createdAt`）——落ちても描画は変わらないので、
 * この突き合わせが「全部残せ」ではなく「**描くものを残せ**」であることが分かる。
 */
const BASE = {
    id: "p1",
    src: "https://cdn.example.com/uploads/u1/p1.jpg",
    srcAvif: "https://cdn.example.com/uploads/u1/p1_lg.avif",
    thumbSrc: "https://cdn.example.com/uploads/u1/p1_thumb.webp",
    thumbAvif: "https://cdn.example.com/uploads/u1/p1_thumb.avif",
    thumbSm: "https://cdn.example.com/uploads/u1/p1_thumb_sm.webp",
    thumbSmAvif: "https://cdn.example.com/uploads/u1/p1_thumb_sm.avif",
    blurDataURL: "data:image/png;base64,iVBORw0KGgo=",
    dominantColor: "#123456",
    focalPoint: "50% 20%",
    title: { ja: "オペラ座の朝", en: "Opera at dawn" },
    alt: { ja: "朝日のオペラ座", en: "Opera house at sunrise" },
    // **本物と同じ形**（段落の配列）。文字列で書くと `getLocalizedParagraphs` が
    // 空を返し、説明文が最初から描かれない＝この突き合わせが説明文を見なくなる
    description: { ja: ["ここにしかない説明文です。"], en: ["A description only here."] },
    location: "パリ, フランス",
    category: "architecture",
    tags: ["paris", "opera"],
    date: "2026-05-05",
    createdAt: "2026-05-06T00:00:00.000Z",
    exif: { camera: "SONY ILCE-7M3", lens: "FE 24-70mm", aperture: "f/2.8", iso: "400" },
    userId: "11111111-1111-4111-8111-111111111111",
    displayName: "丸田 竜平",
    uploaderUsername: "ryuhei",
    photographer: "丸田 竜平",
    license: "CC BY 4.0",
    song: { title: "Morning", artist: "Someone", previewUrl: "https://audio.example.com/a.m4a" },
    commentCount: 4,
    likes: 7,
    extraImages: [{ src: "https://cdn.example.com/uploads/u1/p1b.jpg" }],
} as unknown as Photo;

/**
 * 地図の導線は**出どころが2つ**ある（`getPreferredMapLink`）。
 * 片方だけ試すと、もう片方の項目が落ちていても気づけない:
 *
 *   - `mapLinks` … 人が入れたリンク（座標が無くても出る）
 *   - `coords`   … 座標から組み立てる（`geoApprox` なら組み立てない）
 *
 * **本番の30枚は座標を1つも持たない**ので、実際に効くのは上の経路。
 */
const VARIANTS: Array<[string, Photo]> = [
    ["人が入れた地図リンク（座標なし）", { ...BASE, mapLinks: { osm: "https://osm.example.com/?m=1" } } as unknown as Photo],
    ["座標から組み立てる地図リンク", { ...BASE, coords: { lat: 48.87, lng: 2.33 } } as unknown as Photo],
    ["おおよその座標（リンクを組み立てない）", { ...BASE, coords: { lat: 48.87, lng: 2.33 }, geoApprox: true } as unknown as Photo],
    ["地図の材料が何も無い", BASE],
];

/** 描かれたものの写し。文字・リンク・画像のURLを全部入れる */
function shot(container: HTMLElement): string {
    const attrs = (sel: string, name: string) =>
        [...container.querySelectorAll(sel)].map((e) => e.getAttribute(name) ?? "").join("\n");
    return [
        container.textContent ?? "",
        attrs("a[href]", "href"),
        attrs("img[src]", "src"),
        attrs("source[srcset]", "srcset"),
        attrs("img[alt]", "alt"),
    ].join("\n--\n");
}

async function shotOf(photo: Photo): Promise<string> {
    const r = render(
        <GalleryModal photos={[photo]} currentIndex={0} onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />,
    );
    // 取得（いいね・保存）の応答が届いてから写す。両方に同じだけ待たせる
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const s = shot(r.container);
    r.unmount();
    return s;
}

describe("ビューアに渡す写真を絞っても、描かれるものが変わらない", () => {
    it.each(VARIANTS)("%s", async (_name, full) => {
        const whole = await shotOf(full);
        const slim = await shotOf(slimForViewer(full));
        expect(slim, "絞ったぶんで描かれるものが減っている（`slimForViewer` に項目が足りない）").toBe(whole);
    });

    /**
     * **判定の自己確認。** 0件の状態では、壊れた検出器と正しい検出器が
     * 同じ答えを返す（`imageOriginSites.test.ts` が同じ自己確認を持っている）。
     * 項目を1つ抜いたら本当に落ちるか。
     */
    it("判定の自己確認: 説明文を抜くと落ちる", async () => {
        const full = VARIANTS[0][1];
        const whole = await shotOf(full);
        const holed = { ...slimForViewer(full) } as Record<string, unknown>;
        delete holed.description;
        const slim = await shotOf(holed as unknown as Photo);
        expect(slim).not.toBe(whole);
    });

    it("判定の自己確認: 地図リンクを抜くと落ちる", async () => {
        const full = VARIANTS[0][1];
        const whole = await shotOf(full);
        const holed = { ...slimForViewer(full) } as Record<string, unknown>;
        delete holed.mapLinks;
        const slim = await shotOf(holed as unknown as Photo);
        expect(slim).not.toBe(whole);
    });
});
