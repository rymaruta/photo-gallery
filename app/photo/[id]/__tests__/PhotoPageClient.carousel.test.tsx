// @vitest-environment jsdom
// ↑ 画像の属性（loading・srcset・sizes・alt）を happy-dom が jsdom と同じに扱わない。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// **全写真が `1200x800`（3:2）を名乗っていた。**
// 実寸を持たない写真でも `width={1200} height={800}` が固定で付いていたので、
// 縦位置の写真は読み込み後に高さが伸び、下の情報がガタつく
// （Chromium 実測・390x844・画像を500ms遅延: CLS 0.167 →
// 属性なし 0.030 → 実寸 0.000）。
// 同じ「1200x800 の嘘」は OGP 側では既に直してある
// （`app/__tests__/usersMetadata.test.ts`）のに `<img>` に残っていた。

const mockPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));
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

/**
 * **1投稿に複数枚**（owner のモックの「1/10」）。表紙は `src`、2枚目以降が
 * `extraImages`。
 *
 * この画面は**検索の着地点**なので、送る仕組みを足しても
 * **1枚目が静的HTMLにそのまま出る**ことが一番大事（JS を待って出すと
 * LCP がそのぶん遅れる）。
 */
const base = {
    id: "p1",
    src: "https://cdn.example.com/uploads/u1/a.jpg",
    userId: "u1",
    title: "白波の夏",
};
const withExtra = {
    ...base,
    extraImages: [
        { src: "https://cdn.example.com/uploads/u1/b.jpg" },
        { src: "https://cdn.example.com/uploads/u1/c.jpg" },
    ],
};

/** いま出ている本体の写真 */
const shownSrc = () =>
    (screen.getAllByRole("img").find((i) => (i as HTMLImageElement).src.includes("/uploads/u1/")) as HTMLImageElement)?.src;

beforeEach(() => mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] }));

describe("写真ページ: 1投稿に複数枚", () => {
    it("1枚だけなら、送る仕組みを出さない（今までと同じ画面）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        expect(screen.queryByRole("button", { name: "次の写真" })).toBeNull();
        expect(screen.queryByText("1/1")).toBeNull();
    });

    it("🔴 最初に出るのは必ず1枚目（検索の着地点の LCP）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={withExtra} />);
        expect(shownSrc(), "1枚目が出ていない").toContain("a.jpg");
    });

    it("複数枚なら「N/M」と、前へ・次への操作を出す", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={withExtra} />);
        expect(screen.getByText("1/3")).toBeTruthy();
        expect(screen.getByRole("button", { name: "次の写真" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "前の写真" })).toBeTruthy();
    });

    it("次へで2枚目、前へで戻る", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={withExtra} />);
        fireEvent.click(screen.getByRole("button", { name: "次の写真" }));
        expect(shownSrc()).toContain("b.jpg");
        expect(screen.getByText("2/3")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "前の写真" }));
        expect(shownSrc()).toContain("a.jpg");
    });

    it("端で折り返す（最後の次は1枚目、最初の前は最後）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={withExtra} />);
        fireEvent.click(screen.getByRole("button", { name: "前の写真" }));
        expect(shownSrc(), "最初の前が最後にならない").toContain("c.jpg");
        fireEvent.click(screen.getByRole("button", { name: "次の写真" }));
        expect(shownSrc()).toContain("a.jpg");
    });

    it("何枚目かを読み上げにも伝える（バッジは aria-hidden）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={withExtra} />);
        expect(screen.getByText("1/3").getAttribute("aria-hidden")).toBe("true");
        expect(screen.getByText("3枚中 1枚目")).toBeTruthy();
    });

    it("🔴 壊れた要素は落とす（写真ページごとエラーカードにしない）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{
            ...base,
            // @ts-expect-error 壊れた値を通す（本番のデータは何でもありうる）
            extraImages: [null, {}, { src: 5 }, { src: "" }, { src: "https://cdn.example.com/uploads/u1/b.jpg" }],
        }} />);
        expect(screen.getByText("1/2"), "壊れた要素まで数えている").toBeTruthy();
        expect(shownSrc()).toContain("a.jpg");
    });

    it("2枚目以降から EXIF を抜かない（撮影情報は投稿に1組しか無い）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={withExtra} />);
        fireEvent.click(screen.getByRole("button", { name: "次の写真" }));
        // 2枚目の alt は何枚目かを含む（表紙の alt と区別が付く）
        expect(screen.getByAltText(/2\/3/)).toBeTruthy();
    });
});
