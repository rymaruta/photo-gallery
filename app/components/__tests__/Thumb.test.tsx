import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import Thumb, { buildSrcSet } from "../Thumb";

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
