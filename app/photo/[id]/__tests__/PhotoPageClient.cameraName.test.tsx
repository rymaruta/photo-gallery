import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// **画面で EXIF を抽出する経路だけ、Make と Model を素のまま連結していた。**
// Model がメーカー名を含む機種（Hasselblad "X2D 100C" は Model が
// "Hasselblad X2D 100C"）で「Hasselblad Hasselblad X2D 100C」になる。
// アップロード側は前から `formatCameraName` で畳んでいた（対の乖離）

const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockParse = vi.hoisted(() => vi.fn());

vi.mock("exifr", () => ({ default: { parse: (...a: unknown[]) => mockParse(...a) } }));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: (...args: unknown[]) => mockPublicFetch(...args),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn(async () => ({ ok: true })) }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;
/** 撮影情報は初期は畳まれている（中身は DOM に残るが、`getByRole` は hidden を拾わない）。開いてから見る */
const expandExif = () => { const b = screen.queryByRole("button", { name: "詳しく見る" }); if (b) fireEvent.click(b); };

// exif を持たない写真（＝画面で抽出する経路に入る）
const base = { id: "p1", src: "https://cdn.example.com/uploads/u1/a.jpg", userId: "u1", title: "写真" };

beforeEach(() => {
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockParse.mockReset();
});

describe("写真ページ: 画面で抽出したカメラ名", () => {
    it("Model がメーカー名を含んでいても二重にしない", async () => {
        mockParse.mockResolvedValue({ Make: "Hasselblad", Model: "Hasselblad X2D 100C" });
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        // 抽出は本体の画像が読み込まれてから
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("Hasselblad X2D 100C");
        expect(screen.queryByText(/Hasselblad Hasselblad/)).toBeNull();
    });

    it("Make と Model が別物なら並べる（正常系）", async () => {
        mockParse.mockResolvedValue({ Make: "Canon", Model: "EOS R5" });
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("Canon EOS R5");
    });
});

// **控えの経路。** 端末側の抽出が失敗したとき（原本の EXIF が落ちている・
// exifr が読めない）は、保存済みの値をそのまま出していた。ところが
// **保存済みの値には二重のメーカー名が残っている**（`formatCameraName` を
// 使う前に保存された行。実データに "Hasselblad Hasselblad X2D II 100C" が実在）。
//
// この経路のテストが無かったので、`dedupeCameraName` を外す変異が
// 642件すべて緑のまま通った（レビューが実証）。
describe("写真ページ: 端末で抽出できなかったときの控え", () => {
    const stored = {
        ...base,
        exif: { camera: "Hasselblad Hasselblad X2D II 100C", lens: "XCD 35-100E" },
    };

    it("保存済みの二重のメーカー名は畳んで出す", async () => {
        mockParse.mockResolvedValue(null);   // 抽出できない
        render(<PhotoPageClient photoId="p1" initialPhoto={stored} />);
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("Hasselblad X2D II 100C");
        expect(screen.queryByText(/Hasselblad Hasselblad/), "二重のまま出ている").toBeNull();
    });

    // **正常系**: 二重でない保存値はそのまま
    it("二重でない保存値はそのまま出す", async () => {
        mockParse.mockResolvedValue(null);
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...stored, exif: { camera: "SONY ILCE-7M3" } }} />);
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("SONY ILCE-7M3");
    });
});

// **機種名から、その機材の一覧へ行けること。**
// 撮影地・カテゴリ・タグは前から集約ページへ繋いであるのに、カメラだけ
// 行き止まりだった。sitemap に載せても内部リンクが1本も無いページは
// 辿ってもらえない（このリポジトリは「関数は書いたが配線していない」を
// 5回踏んでいる）。
describe("写真ページ: カメラ名から機材ページへ", () => {
    it("保存済みの機種名がリンクになっている", async () => {
        mockParse.mockResolvedValue(null);
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...base, exif: { camera: "SONY ILCE-7M3" } }} />);
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText(/撮影情報/); expandExif();
        const link = await screen.findByRole("link", { name: "SONY ILCE-7M3" });
        expect(link).toHaveAttribute("href", "/camera/sony-ilce-7m3");
    });

    // **端末で抽出しただけの機種名はリンクにしない。**
    // 抽出が走るのは保存済み exif が無いときだけで、集約
    // （`valuesFor`）は保存済みの値しか見ない。つまりリンクを抽出値から
    // 作ると、**飛んだ先に自分が居ない**（他の写真が同じ機種を持つ場合）か、
    // **静的生成の対象外でハード404**（誰も持たない機種）になる。
    // 最初これを「リンクになっている」として固定してしまっていた。
    it("端末で抽出しただけの機種名はリンクにしない", async () => {
        mockParse.mockResolvedValue({ Make: "SONY", Model: "ILCE-7M3" });
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);   // 保存済み exif なし
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("SONY ILCE-7M3");
        expandExif();   // 畳んだままだと hidden で null になり、何も確かめない
        expect(screen.queryByRole("link", { name: "SONY ILCE-7M3" }),
            "集約に載っていない写真からリンクしている").toBeNull();
    });

    // **畳んだ名前で繋ぐ。** 二重のままだと、その1枚だけが別の機種の
    // ページへ行き、そこは永久に1枚（noindex）になる
    it("二重のメーカー名でも、畳んだ名前のページへ繋ぐ", async () => {
        mockParse.mockResolvedValue(null);
        render(<PhotoPageClient photoId="p1" initialPhoto={{
            ...base, exif: { camera: "Hasselblad Hasselblad X2D II 100C" },
        }} />);
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText(/撮影情報/); expandExif();
        const link = await screen.findByRole("link", { name: "Hasselblad X2D II 100C" });
        expect(link).toHaveAttribute("href", "/camera/hasselblad-x2d-ii-100c");
    });

    // 行き先の無い項目はリンクにしない（絞り・ISO 等）
    it("カメラ以外の撮影情報はリンクにしない", async () => {
        mockParse.mockResolvedValue(null);
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...base, exif: { camera: "SONY ILCE-7M3", aperture: "f/4" } }} />);
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("f/4");
        expect(screen.queryByRole("link", { name: "f/4" })).toBeNull();
    });
});
