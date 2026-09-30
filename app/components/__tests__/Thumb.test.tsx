// @vitest-environment jsdom
// ↑ happy-dom では <img> の属性（loading・srcset・src）が jsdom と違う値になる。DOM のテストの既定は happy-dom（vitest.config.ts）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import Thumb, { buildSrcSet, thumbDescriptor } from "../Thumb";

// ここで見るのは**組み立て方**（並び順と幅の指定）。
// URL を1本ずつ `publicImageUrl` に通すようになったので、入力は
// 保存されている形（絶対URL）にする——相対パスを渡すと配信元が補われて、
// 見たいものと関係ないところで値が変わる。
// **ホストを揃える側は描画で見る**（`imageOrigin.test.tsx`）。
describe("buildSrcSet", () => {
    const A = "https://cdn.example/a256.webp";
    const B = "https://cdn.example/b512.webp";
    it("256/512 の両方があれば srcset を組む", () => {
        expect(buildSrcSet(A, B)).toBe(`${A} 256w, ${B} 512w`);
    });
    it("片方だけ・無しに対応", () => {
        expect(buildSrcSet(undefined, B)).toBe(`${B} 512w`);
        expect(buildSrcSet(A, undefined)).toBe(`${A} 256w`);
        expect(buildSrcSet(undefined, undefined)).toBeUndefined();
    });
});

// 派生は長辺で縮めているので、`512w` が本当に幅 512 なのは横長だけ。
// iPhone の縦位置（3:4）は 384 × 512。幅を多く申告すると、ブラウザは足りない方を
// 選んで引き伸ばす（docs/ios-bug-audit-2026-09-25.md #40）。
describe("派生の実際の幅を申告する", () => {
    const A = "https://cdn.example/a256.webp";
    const B = "https://cdn.example/b512.webp";

    it("縦位置（3:4）は長辺ではなく実際の幅", () => {
        expect(buildSrcSet(A, B, { width: 3024, height: 4032 })).toBe(`${A} 192w, ${B} 384w`);
    });

    it("横長はそのまま（今までと同じ）", () => {
        expect(buildSrcSet(A, B, { width: 4032, height: 3024 })).toBe(`${A} 256w, ${B} 512w`);
    });

    it("寸法が無ければ今までどおり長辺を申告する", () => {
        expect(buildSrcSet(A, B, {})).toBe(`${A} 256w, ${B} 512w`);
    });

    it("4:3 のマスに敷くパノラマは、足りなくなる高さで決まる", () => {
        // 512 × 128 を 4:3 のマスに cover で敷くと、使える幅は 128 × 4/3 ≒ 171
        expect(thumbDescriptor(512, { width: 16000, height: 4000 }, 4 / 3)).toBe(171);
        // 縦位置は幅で決まる（384）
        expect(thumbDescriptor(512, { aspectRatio: 0.75 }, 4 / 3)).toBe(384);
    });

    it("一覧のグリッドは寸法を渡し、マスの形（4:3）も渡す", () => {
        const { container } = render(
            <Thumb
                photo={{ src: "https://cdn/x.jpg", thumbSrc: B, thumbSm: A, width: 3000, height: 4000 }}
                alt="" cellAspect={4 / 3}
            />,
        );
        expect(container.querySelector('source[type="image/webp"]')?.getAttribute("srcset")).toBe(`${A} 192w, ${B} 384w`);
        const grid = readFileSync(join(__dirname, "../GalleryGrid.tsx"), "utf8");
        expect(grid).toMatch(/cellAspect=\{4 \/ 3\}/);
    });
});

describe("Thumb <picture> の出し分け", () => {
    const base = { src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x_thumb.webp" };

    it("派生があれば avif/webp の <source> を出す", () => {
        const { container } = render(
            <div style={{ position: "relative" }}>
                <Thumb
                    photo={{
                        ...base,
                        thumbAvif: "https://cdn/x_thumb.avif",
                        thumbSm: "https://cdn/x_thumb_sm.webp",
                        thumbSmAvif: "https://cdn/x_thumb_sm.avif",
                    }}
                    alt="t"
                    sizes="50vw"
                />
            </div>
        );
        const sources = container.querySelectorAll("picture source");
        const types = Array.from(sources).map((s) => s.getAttribute("type"));
        expect(types).toContain("image/avif");
        expect(types).toContain("image/webp");
        const avif = Array.from(sources).find((s) => s.getAttribute("type") === "image/avif")!;
        expect(avif.getAttribute("srcset")).toContain("256w");
        expect(avif.getAttribute("srcset")).toContain("512w");
        // フォールバック img は従来サムネ
        expect(container.querySelector("picture > img")?.getAttribute("src")).toBe(base.thumbSrc);
    });

    it("派生が無ければ <source> は出さず img フォールバックのみ", () => {
        const { container } = render(
            <div style={{ position: "relative" }}>
                <Thumb photo={base} alt="t" sizes="50vw" />
            </div>
        );
        expect(container.querySelectorAll("picture source").length).toBe(0);
        expect(container.querySelector("picture > img")?.getAttribute("src")).toBe(base.thumbSrc);
    });
});

// **ハイドレーションまでは隠さない。** 以前は `opacity-0` を静的HTMLに焼いていたので、
// JS が届いて React が付くまで画像が透明のままだった（Chromium 実測・
// Fast 3G + CPU 4倍: 画像は 1.6秒で届いているのに、見えるのは 5.9秒）。
// 読み込み中の <img> は何も描かない（下のぼかしが透ける。実測）ので、
// 「まだ分からない」間は見せておき、React が付いた時点で決める
describe("Thumb: ハイドレーション前は隠さない", () => {
    const base = { src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x_thumb.webp", blurDataURL: "data:image/webp;base64,AAAA" };
    const setReady = (ready: boolean) => {
        Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => ready });
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => (ready ? 512 : 0) });
    };
    // jsdom は `complete`/`naturalWidth` をプロトタイプ自身のアクセサとして
    // 持つので、`delete` すると**定義ごと消えて** `img.complete` が undefined に
    // なる。控えて戻す
    const saved = {
        complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete")!,
        naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")!,
    };
    const restore = () => {
        Object.defineProperty(HTMLImageElement.prototype, "complete", saved.complete);
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", saved.naturalWidth);
    };

    it("静的HTML（サーバー描画）では画像を透明にしない。ぼかしは敷く", () => {
        const html = renderToString(<Thumb photo={base} alt="t" />);
        expect(html, "JS が届くまで写真が透明のまま").not.toContain("opacity-0");
        expect(html).toContain("opacity-100");
        // ぼかしは JS 無しでも出る（届くまでの間の絵）
        expect(html).toContain('src="data:image/webp;base64,AAAA"');
    });

    it("クライアント遷移で新しく作った画像は、届くまで隠して届いたらフェードで出す", () => {
        setReady(false);
        try {
            const { container } = render(<div style={{ position: "relative" }}><Thumb photo={base} alt="t" /></div>);
            const img = container.querySelector("picture > img")!;
            expect(img.className).toContain("opacity-0");
            expect(container.querySelector('img[src^="data:"]'), "ぼかしが消えている").not.toBeNull();
            fireEvent.load(img);
            expect(img.className).toContain("opacity-100");
            expect(img.className).not.toContain("opacity-0");
            expect(container.querySelector('img[src^="data:"]'), "届いたのにぼかしが残っている").toBeNull();
        } finally { restore(); }
    });

    it("新しく作った時点で既に届いていれば、隠さずぼかしも外す", () => {
        setReady(true);
        try {
            const { container } = render(<div style={{ position: "relative" }}><Thumb photo={base} alt="t" /></div>);
            const img = container.querySelector("picture > img")!;
            expect(img.className).toContain("opacity-100");
            expect(img.className).not.toContain("opacity-0");
            expect(container.querySelector('img[src^="data:"]')).toBeNull();
        } finally { restore(); }
    });
});

// **静的HTML由来の <img> は、届いていなくても隠さない。** Chromium は JPEG/WebP を
// 届いた行まで逐次描くので、途中まで見えている写真を React が付いた瞬間に
// `opacity-0` にすると「見えた → 消える → 出る」になる。ここは本物のハイドレーション
// （`renderToString` → `hydrateRoot`）で確かめる
describe("Thumb: ハイドレーション由来の画像はブラウザに任せる", () => {
    const base = { src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x_thumb.webp", blurDataURL: "data:image/webp;base64,AAAA" };
    const hydrate = async (photo: typeof base) => {
        const { hydrateRoot } = await import("react-dom/client");
        const { act } = await import("react");
        const host = document.createElement("div");
        host.innerHTML = renderToString(<div style={{ position: "relative" }}><Thumb photo={photo} alt="t" /></div>);
        document.body.appendChild(host);
        const errors: unknown[] = [];
        let root: ReturnType<typeof hydrateRoot> | null = null;
        await act(async () => {
            root = hydrateRoot(host, <div style={{ position: "relative" }}><Thumb photo={photo} alt="t" /></div>, { onRecoverableError: (e) => errors.push(e) });
        });
        return { host, errors, act, cleanup: async () => { await act(async () => { root?.unmount(); }); host.remove(); } };
    };

    it("React が付いてもまだ届いていない画像を隠さず、届いたらぼかしだけ外す", async () => {
        const { host, errors, act, cleanup } = await hydrate(base);
        try {
            expect(errors, "ハイドレーションの不一致").toEqual([]);
            const img = host.querySelector("picture > img")!;
            expect(img.className, "静的HTML由来の画像を隠している").not.toContain("opacity-0");
            expect(host.querySelector('img[src^="data:"]'), "届く前にぼかしを外している").not.toBeNull();
            await act(async () => { fireEvent.load(img); });
            expect(img.className).toContain("opacity-100");
            expect(host.querySelector('img[src^="data:"]')).toBeNull();
        } finally { await cleanup(); }
    });

    const stub = (complete: boolean, naturalWidth: number) => {
        const saved = {
            complete: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete")!,
            naturalWidth: Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")!,
        };
        Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => complete });
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => naturalWidth });
        return () => {
            Object.defineProperty(HTMLImageElement.prototype, "complete", saved.complete);
            Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", saved.naturalWidth);
        };
    };

    it("React が付く前に届いていれば（キャッシュ済みの再訪）、ぼかしを外す", async () => {
        // `load` は React が付く前に発火し終えていて拾えない。ref で見る
        const restore = stub(true, 512);
        try {
            const { host, errors, cleanup } = await hydrate(base);
            try {
                expect(errors).toEqual([]);
                expect(host.querySelector("picture > img")!.className).toContain("opacity-100");
                expect(host.querySelector('img[src^="data:"]'), "届いているのにぼかしが下に敷かれたまま").toBeNull();
            } finally { await cleanup(); }
        } finally { restore(); }
    });

    // **ここが本丸。** 静的HTMLの `<img>` はパースの時点で要求され、SW は
    // キャッシュ優先で即座に返すので、毒を食った控えは**JS が届くより前に**
    // 失敗し終える＝`onError` には来ない（`attach` が拾う）。一覧の上段と
    // 写真ページの本体はこの経路なので、ここが抜けると「いちばん出る場所
    // だけ一生直らない」。最初の実装は `onError` にしか配線していなかった
    it("React が付く前に失敗し終えていた写真も、控えを捨てる", async () => {
        const deleted: string[] = [];
        const opened: string[] = [];
        vi.stubGlobal("caches", {
            open: async (name: string) => {
                opened.push(name);
                return { delete: async (u: string) => { deleted.push(u); return true; } };
            },
        });
        const restore = stub(true, 0);
        try {
            const { cleanup } = await hydrate(base);
            try {
                await Promise.resolve();
                await Promise.resolve();
                expect(opened, "違う入れ物を開いている").toEqual(["journey-photo-img-v1"]);
                expect(deleted, "onError に来ない経路で控えを残している")
                    .toEqual(["https://cdn/x_thumb.webp"]);
            } finally { await cleanup(); }
        } finally { restore(); vi.unstubAllGlobals(); }
    });

    it("React が付く前に失敗し終えていれば、失敗の絵に切り替える（破損表示を出さない）", async () => {
        // 静的HTMLに残った削除済み写真の 404 が JS より先に届く形
        const restore = stub(true, 0);
        try {
            const { host, errors, cleanup } = await hydrate(base);
            try {
                expect(errors).toEqual([]);
                expect(host.querySelector("picture > img"), "壊れた画像をそのまま出している").toBeNull();
                expect(host.querySelector("svg")).not.toBeNull();
            } finally { await cleanup(); }
        } finally { restore(); }
    });
});

// **失敗した写真の控えを捨てる。** SW の写真はキャッシュ優先で寿命が無いので、
// 中身が写真でないものを一度控えると再読込では直らない（別オリジンの写真は
// 応答が opaque で、SW 側では種別を確かめようが無い）。一覧は写真がいちばん
// 多く出る画面なので、ここが抜けると症状も一番出る。
describe("Thumb: 読み込めなかった写真の控えを捨てる", () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it("失敗した URL を写真の入れ物から消す", async () => {
        const deleted: string[] = [];
        const opened: string[] = [];
        vi.stubGlobal("caches", {
            open: async (name: string) => {
                opened.push(name);
                return { delete: async (u: string) => { deleted.push(u); return true; } };
            },
        });

        const { container } = render(
            <div style={{ position: "relative" }}>
                <Thumb photo={{ src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x_thumb.webp" } as never} alt="湖" />
            </div>,
        );
        const img = container.querySelector("picture > img") as HTMLImageElement;
        fireEvent.error(img);
        await Promise.resolve();
        await Promise.resolve();

        expect(opened, "違う入れ物を開いている").toEqual(["journey-photo-img-v1"]);
        expect(deleted).toEqual(["https://cdn/x_thumb.webp"]);
    });
});

/**
 * 🔴 **写真を歪ませない**（owner の指示・2026-09-22「さがす」は写真の
 * 縦横比を維持すること）。
 *
 * 一覧の枠は縦横比が決まっている（`GalleryGrid` は `padding-top:75%` で
 * 4:3 を先に確保する＝**読み込み前から場所が決まっていて画面が飛ばない**）。
 * その中で `object-fit` が何であるかが「歪むか／切り抜くか」を決める:
 *
 *     cover    … 縦横比を保ったまま**切り抜く**（いまの形）
 *     contain  … 縦横比を保ったまま**余白を足す**
 *     fill     … **枠に合わせて伸ばす＝歪む**（これを入れてはいけない）
 *
 * ⚠️ **切り抜きを無くすには写真ごとの寸法が要る。** `width`/`height` は
 * 型には在るが、**本番の30枚は1枚も持っていない**（`app/data/photos.json`
 * を数えた: 0/30）。書く側は `scripts/generate-thumbnails.js` の
 * `META_FIELDS` で、そこを流さないと埋まらない。
 */
describe("写真を歪ませない", () => {
    it("🔴 `object-fit` は cover（`fill` は縦横比を壊す）", () => {
        const src = readFileSync(join(process.cwd(), "app/components/Thumb.tsx"), "utf8");
        expect(src, "`object-fill` で枠に合わせて伸ばしている").not.toMatch(/object-fill|objectFit:\s*["']fill["']/);
        expect(src.match(/object-cover/g)?.length ?? 0, "`object-cover` が消えている").toBeGreaterThanOrEqual(2);
    });
});
