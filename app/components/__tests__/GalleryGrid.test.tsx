import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GalleryGrid, { GRID_INITIAL_VISIBLE, GRID_STEP } from "../GalleryGrid";
import { GRID_SIZES_5XL } from "../gridSizes";
import PHOTOS_JSON from "../../data/photos.json";
import type { Photo } from "@/lib/data/photos";

// ビルド時の photos.json に居る写真は /photo/<id> の静的ページを持つ。
// 居ない写真（ビルド後の新着）は静的ページが無いので /?photo=<id> になり、
// ホームのモーダルだけが閲覧手段になる。
const BUILT_ID = (PHOTOS_JSON as Array<{ id: string }>)[0].id;
const NEW_ID = "brand-new-photo-id";

const photo = (id: string): Photo => ({
    id,
    src: `https://cdn.example.com/uploads/${id}.jpg`,
    title: { ja: "写真", en: "Photo" },
    tags: [],
});

function setup(ids: string[], onOpenPhoto?: (id: string) => boolean, openInPlace?: boolean, priorityCount?: number) {
    render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={ids.map(photo)} locale="ja" onOpenPhoto={onOpenPhoto} openInPlace={openInPlace} priorityCount={priorityCount} />);
}

describe("GalleryGrid: 新着写真のタップ", () => {
    it("静的ページの無い写真は /?photo= を指す", () => {
        setup([NEW_ID]);
        expect(screen.getByRole("link")).toHaveAttribute("href", `/?photo=${NEW_ID}`);
    });

    it("ホームでは遷移せずその場でモーダルを開く", () => {
        // /?photo= は「今いるURL」なので、Next のルーターは何もしない。
        // 以前はそのせいで新着写真をタップしても無反応だった
        // （新着写真にとっては唯一の閲覧手段なのに）。
        const onOpenPhoto = vi.fn().mockReturnValue(true);
        setup([NEW_ID], onOpenPhoto);
        const link = screen.getByRole("link");
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(link, ev);
        expect(onOpenPhoto).toHaveBeenCalledWith(NEW_ID);
        expect(ev.defaultPrevented).toBe(true);
    });

    // **`openInPlace` は撮影スポット詳細のモック⑧**（「タップで拡大表示に
    // 切り替わる」）のための opt-in。既定は false なので、これを渡していない
    // 画面（ホーム・お気に入り・保存・他の集約ページ）の振る舞いは変わらない
    // ——それを見張るのが1つ下の「静的ページのある写真はそのまま遷移させる」。
    it("openInPlace なら、静的ページのある写真もその場で開く", () => {
        const onOpenPhoto = vi.fn().mockReturnValue(true);
        setup([BUILT_ID], onOpenPhoto, true);
        const link = screen.getByRole("link");
        // 🔴 **`href` は消さない。** 消すと `/location/*`（検索に載っている
        // ページ）から写真の個別ページへの内部リンクが丸ごと消える
        expect(link).toHaveAttribute("href", `/photo/${BUILT_ID}`);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(link, ev);
        expect(onOpenPhoto).toHaveBeenCalledWith(BUILT_ID);
        expect(ev.defaultPrevented).toBe(true);
    });

    // **開けなかったら遷移を止めない。** 止めると「タップしても何も起きない」
    // になる——写真ページへ行く方がずっと良い
    it("openInPlace でも、開けなかった（false）なら遷移はそのまま", () => {
        const onOpenPhoto = vi.fn().mockReturnValue(false);
        setup([BUILT_ID], onOpenPhoto, true);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(screen.getByRole("link"), ev);
        expect(onOpenPhoto).toHaveBeenCalledWith(BUILT_ID);
        expect(ev.defaultPrevented).toBe(false);
    });

    /**
     * **先に読む枚数は呼ぶ側が決められる。**
     *
     * 既定は 8（ホームのように格子が画面の最初のもの）。撮影スポット詳細は
     * 上にヒーローが在り、**格子の1枚目は折り返しのずっと下**なので 0 を渡す
     * ——実測（Chromium 390x844）で格子の1枚目は **y=1064 / 画面 844**。
     */
    it("priorityCount=0 なら1枚目も先に読まない", () => {
        setup([BUILT_ID], undefined, undefined, 0);
        const img = screen.getByRole("img");
        expect(img.getAttribute("loading")).toBe("lazy");
        expect(img.getAttribute("fetchpriority")).not.toBe("high");
    });

    // **既定は今までどおり**（ホーム・お気に入り・保存・他の集約ページ）
    it("既定では1枚目を先に読む", () => {
        setup([BUILT_ID]);
        const img = screen.getByRole("img");
        expect(img.getAttribute("loading")).not.toBe("lazy");
    });

    it("静的ページのある写真はそのまま個別ページへ遷移させる", () => {
        const onOpenPhoto = vi.fn().mockReturnValue(true);
        setup([BUILT_ID], onOpenPhoto);
        const link = screen.getByRole("link");
        expect(link).toHaveAttribute("href", `/photo/${BUILT_ID}`);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(link, ev);
        expect(onOpenPhoto).not.toHaveBeenCalled();
        expect(ev.defaultPrevented).toBe(false);
    });

    it("新しいタブで開く操作（⌘/Ctrl+クリック）は邪魔しない", () => {
        const onOpenPhoto = vi.fn().mockReturnValue(true);
        setup([NEW_ID], onOpenPhoto);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
        fireEvent(screen.getByRole("link"), ev);
        expect(onOpenPhoto).not.toHaveBeenCalled();
        expect(ev.defaultPrevented).toBe(false);
    });

    it("ホーム以外（onOpenPhoto なし）では通常の遷移のまま", () => {
        setup([NEW_ID]);
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(screen.getByRole("link"), ev);
        expect(ev.defaultPrevented).toBe(false);
    });
});

// **一覧は全部を一度に DOM へ置いていた。** 枚数に比例して重くなり、
// Chromium 実測（390x844・CPU 4倍遅い）で 1,000枚 → 2.7秒、3,000枚 → 8.8秒の
// 「何も反応しない時間」が出ていた。下端に近づいたぶんだけ足す
describe("GalleryGrid: 枚数が増えても一度に全部は描かない", () => {
    const many = (n: number): Photo[] => Array.from({ length: n }, (_, i) => ({
        id: `p${i}`, src: `https://cdn/${i}.jpg`, userId: "u1", title: `写真${i}`, published: true,
    } as Photo));

    /**
     * IntersectionObserver の差し替え。**本物の契約に寄せる**——
     * `observe()` の直後に必ず1回配送し、交差していなければ `isIntersecting: false`
     * が来る。これを模していなかったので「`isIntersecting` を見ない」変異が
     * 素通りしていた（見ないと、作り直すたびに1回発火して結局全部描く）
     */
    function stubObserver() {
        const instances: Array<{ cb: IntersectionObserverCallback; el: Element | null; options?: IntersectionObserverInit; disconnected: boolean }> = [];
        class IO {
            cb: IntersectionObserverCallback;
            el: Element | null = null;
            options?: IntersectionObserverInit;
            disconnected = false;
            constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.cb = cb; this.options = options; instances.push(this); }
            observe(el: Element) {
                this.el = el;
                // 本物と同じく、まず「いまの状態」を配る（画面外なら false）
                this.cb([{ isIntersecting: false, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
            }
            disconnect() { this.disconnected = true; }
            unobserve() { /* noop */ }
            takeRecords() { return []; }
            root = null; rootMargin = ""; thresholds = [];
        }
        (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
        return {
            instances,
            /** いちばん新しい観測者に「見えた」と伝える */
            fire: () => {
                const io = instances[instances.length - 1];
                act(() => io.cb([{ isIntersecting: true } as IntersectionObserverEntry], io as unknown as IntersectionObserver));
            },
        };
    }
    const cards = (c: HTMLElement) => c.querySelectorAll("[data-photo-id]").length;

    afterEach(() => {
        delete (globalThis as unknown as Record<string, unknown>).IntersectionObserver;
    });

    it("最初は先頭ぶんだけ描く", () => {
        stubObserver();
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500)} locale="ja" />);
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE);
    });

    it("枚数が少なければ何も変わらない（今の30枚はこちら）", () => {
        stubObserver();
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(30)} locale="ja" />);
        expect(cards(container)).toBe(30);
    });

    it("下端が近づくたびに足す", () => {
        const io = stubObserver();
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500)} locale="ja" />);
        io.fire();
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE + GRID_STEP);
        io.fire();
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE + GRID_STEP * 2);
    });

    // **足したあとに観測者を作り直す。** 番兵が画面に入ったままだと交差の状態が
    // 変わらず、ブラウザは二度と呼んでくれない（＝そこで止まる）。jsdom には
    // レイアウトが無いので「止まる」ことは再現できない——作り直していることを見る。
    // 実ブラウザでは 300枚→7回・1,000枚→19回に分けて最後まで読めることを実測済み
    it("足すたびに番兵を見張り直す（入ったままだと二度と呼ばれない）", () => {
        const io = stubObserver();
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500)} locale="ja" />);
        const before = io.instances.length;
        io.fire();
        expect(io.instances.length, "足したあと観測者を作り直していない").toBeGreaterThan(before);
        expect(io.instances[io.instances.length - 1].el, "作り直した観測者が番兵を見ていない").not.toBeNull();
    });

    // **見えていないのに足さない。** 本物は observe の直後にも配ってくるので、
    // `isIntersecting` を見ないと作り直すたびに1回発火し、結局全部描いてしまう
    it("番兵が見えていないうちは増やさない", () => {
        stubObserver();
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500)} locale="ja" />);
        expect(cards(container), "見えていないのに足している").toBe(GRID_INITIAL_VISIBLE);
    });

    it("下端に着く前に足す（画面に入ってからでは間に合わない）", () => {
        const io = stubObserver();
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500)} locale="ja" />);
        const margin = io.instances[0].options?.rootMargin ?? "";
        expect(margin, "余裕を持たずに観測している").toMatch(/[1-9]\d{2,}px/);
    });

    it("作り直すときは前の観測者を捨てる（積み上げない）", () => {
        const io = stubObserver();
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500)} locale="ja" />);
        io.fire();
        expect(io.instances[0].disconnected, "前の観測者を捨てていない").toBe(true);
    });

    it("最後まで足したら番兵を外す（無限に観測しない）", () => {
        const io = stubObserver();
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(GRID_INITIAL_VISIBLE + 10)} locale="ja" />);
        io.fire();
        expect(cards(container)).toBe(GRID_INITIAL_VISIBLE + 10);
        expect(container.querySelector('[data-testid="gallery-sentinel"]'), "番兵が残っている").toBeNull();
    });

    // **出さない方に倒さない。** 監視できない環境で60枚に打ち切ると、
    // その環境では残りの写真に一生辿り着けない
    it("IntersectionObserver が無い環境では全部描く", () => {
        delete (globalThis as unknown as Record<string, unknown>).IntersectionObserver;
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(200)} locale="ja" />);
        expect(cards(container)).toBe(200);
    });

    it("絞り込みが変わったら最初から数え直す", () => {
        // **差し替えは1回だけ。** 2回呼ぶと、部品が掴んでいるのは1つ目の
        // クラスなのに2つ目の控えを見にいって空になる（最初そう書いて落とした）
        const io = stubObserver();
        const { container, rerender } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500)} locale="ja" />);
        io.fire();
        expect(cards(container)).toBeGreaterThan(GRID_INITIAL_VISIBLE);
        rerender(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many(500).slice(0, 300)} locale="ja" />);
        expect(cards(container), "絞り込んでも前の枚数のままになっている").toBe(GRID_INITIAL_VISIBLE);
    });
});

// **地図と読む側の契約。**
//
// ここは `categoryDisplayMap?.[photo.category ?? ""]` と**生の値**で引き、
// 落とし先を持たない——鍵が外れると文字が丸ごと消える。実際、地図の鍵を
// スラッグに変えた回で `/favorites` のカテゴリ行が空欄になった（実データ
// 30枚中9枚）。**地図を作る側と読む側を、同じ入力で突き合わせる。**
describe("GalleryGrid: カテゴリ名", () => {
    const withCategory = (id: string, category: string): Photo => ({
        ...photo(id), category,
    } as Photo);

    it("地図を作る側と同じ写真なら、必ず名前が出る", async () => {
        const { photoCategoryMap } = await import("@/lib/utils/categoryMap");
        const { ja } = await import("@/app/i18n/labels");
        // 別名（建物）・日本語（風景）・スラッグ（landscape）・表に無い値（travel）
        const photos = [
            withCategory("a", "建物"), withCategory("b", "風景"),
            withCategory("c", "landscape"), withCategory("d", "travel"),
        ];
        const map = photoCategoryMap(photos, (ja.category?.names ?? {}) as Record<string, string>);
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={photos} locale="ja" categoryDisplayMap={map} />);
        // 別名で保存されていても、飛び先の集約ページと同じ言葉
        expect(screen.getByText("建築"), "別名の写真だけ名前が消えている").toBeInTheDocument();
        expect(screen.getAllByText("風景"), "landscape と 風景 が同じ名前になっていない").toHaveLength(2);
        // 表に無いカテゴリは本人が書いた言葉のまま（写真ページと同じ）
        expect(screen.getByText("travel")).toBeInTheDocument();
    });
});

/**
 * **最初の画面に出る写真を「すぐ読む」にする枚数。**
 *
 * `index < 8` は `GalleryGrid.tsx` にあるが、**それを見るテストが1本も
 * 無かった**（`fetchPriority` を見るテストがリポジトリ全体で0件だった）。
 * 外すと最初の画面の写真まで後回しになり、入れすぎると画面外の写真が
 * 高い優先度で主役と帯域を取り合う。
 *
 * 8 という数の根拠は実測（`IMG-2`）——390x844 で画面内10枚・1280x800 で12枚
 * なので、**どちらでも画面内の枚数を超えない**。
 */
describe("読み込みの優先度", () => {
    const many = Array.from({ length: 12 }, (_, i) => photo(`p${i}`));

    // alt は全部同じ（フィクスチャの題が共通）なので、**出た順**で見る
    const renderMany = () => {
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={many} locale="ja" />);
        return Array.from(container.querySelectorAll("picture img"));
    };

    it("先頭8枚は eager + high、9枚目からは lazy + auto", () => {
        const imgs = renderMany();
        expect(imgs).toHaveLength(many.length);
        imgs.slice(0, 8).forEach((img, i) => {
            expect(img.getAttribute("loading"), `${i}枚目が後回し指定`).toBe("eager");
            expect(img.getAttribute("fetchpriority")?.toLowerCase()).toBe("high");
        });
        imgs.slice(8).forEach((img, i) => {
            expect(img.getAttribute("loading"), `${i + 8}枚目を無駄に先読みしている`).toBe("lazy");
            expect(img.getAttribute("fetchpriority")?.toLowerCase()).toBe("auto");
        });
    });

    it("「すぐ読む」はちょうど8枚（0枚でも全部でも通らない）", () => {
        const eager = renderMany().filter((i) => i.getAttribute("loading") === "eager");
        expect(eager).toHaveLength(8);
    });
});

/**
 * **「無題」は render のときの代わりの言葉ではなく、保存されている値。**
 *
 * サーバーが題の無い投稿に `無題` / `Untitled` を入れていたので、一覧には
 * 「無題」が並んでいた（owner:「タイトルなくてもいいよ」）。書き込み側は
 * 直したが、**既にある写真は直らない**ので読む側でも落とす。
 *
 * 落とすのは**丸ごとその言葉のときだけ**——「無題の風景」は人が書いた題。
 */
describe("GalleryGrid: 題の無い写真", () => {
    const titled = (id: string, title: unknown): Photo =>
        ({ id, src: `https://cdn.example.com/uploads/${id}.jpg`, tags: [], title } as Photo);

    const cardText = (container: HTMLElement) =>
        (container.querySelector("[data-photo-id]") as HTMLElement).textContent ?? "";
    // 帯は写真の下に敷く黒いグラデーション。**文字の有無では見分けられない**
    // ——中身が空でも帯そのものは描かれてしまう（最初そう書いて変異を逃した）
    const band = (container: HTMLElement) =>
        container.querySelector('[style*="linear-gradient"]');

    it("保存されている「無題」は題として出さない", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={[titled("a", { ja: "無題", en: "Untitled" })]} locale="ja" />);
        expect(screen.queryByText("無題"), "保存されていた「無題」がそのまま並んでいる").toBeNull();
        // 読み上げる名前も「無題 を開く」にしない
        expect(screen.getByRole("link")).toHaveAccessibleName("写真を開く");
    });

    it("素の文字列で保存された「Untitled」も同じ", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={[titled("a", "Untitled")]} locale="ja" />);
        expect(screen.queryByText("Untitled")).toBeNull();
    });

    // **落としすぎない。** 「無題」で始まる題は人が書いたもの
    it("「無題の風景」は人が書いた題なので消さない", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={[titled("a", "無題の風景")]} locale="ja" />);
        expect(screen.getByText("無題の風景")).toBeInTheDocument();
    });

    it("題も分類も無ければ、写真の下の帯ごと出さない", () => {
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={[titled("a", "無題")]} locale="ja" />);
        expect(cardText(container), "題が無いのに文字が出ている").toBe("");
        expect(band(container), "中身が無いのに黒い帯だけ敷いている").toBeNull();
    });

    it("題が無くても分類があれば帯は出す", () => {
        const { container } = render(
            <GalleryGrid sizes={GRID_SIZES_5XL} photos={[{ ...titled("a", "無題"), category: "landscape" } as Photo]} locale="ja" categoryDisplayMap={{ landscape: "風景" }} />,
        );
        expect(band(container), "分類があるのに帯が出ていない").not.toBeNull();
        expect(cardText(container)).toBe("風景");
    });

    it("題だけでも帯は出す", () => {
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={[titled("a", "白鳥と湖")]} locale="ja" />);
        expect(band(container), "題があるのに帯が出ていない").not.toBeNull();
    });
});

// **1投稿に複数枚**（owner のモックの「1/5」）。一覧で枚数を出さないと、
// 1枚の投稿と見分けが付かない——開いて初めて「他にもある」と分かる
describe("GalleryGrid: 複数枚の投稿", () => {
    const withExtra = (id: string, extra: unknown[]): Photo => ({
        ...photo(id),
        extraImages: extra as Photo["extraImages"],
    });

    it("1枚だけなら枚数を出さない（今までと同じ見え方）", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={[photo(BUILT_ID)]} locale="ja" />);
        expect(screen.queryByText(/^1\//)).toBeNull();
    });

    it("🔴 複数枚なら「1/N」を出す", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} locale="ja"
            photos={[withExtra(BUILT_ID, [{ src: "https://cdn.example.com/b.jpg" }, { src: "https://cdn.example.com/c.jpg" }])]} />);
        expect(screen.getByText("1/3"), "枚数が出ていない").toBeTruthy();
    });

    it("🔴 壊れた要素は数えない（「1/3」と出して開くと2枚、を作らない）", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} locale="ja"
            photos={[withExtra(BUILT_ID, [null, {}, { src: 5 }, { src: "" }, { src: "https://cdn.example.com/b.jpg" }])]} />);
        expect(screen.getByText("1/2")).toBeTruthy();
    });

    it("お気に入りの印と重ならない（あちらは右上・こちらは左上）", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} locale="ja"
            photos={[withExtra(BUILT_ID, [{ src: "https://cdn.example.com/b.jpg" }])]} />);
        expect(screen.getByText("1/2").className).toContain("left-2");
    });

    it("extraImages が配列でなくても落ちない", () => {
        render(<GalleryGrid sizes={GRID_SIZES_5XL} locale="ja"
            photos={[{ ...photo(BUILT_ID), extraImages: "x" as unknown as Photo["extraImages"] }]} />);
        expect(screen.queryByText(/^1\//)).toBeNull();
    });
});
