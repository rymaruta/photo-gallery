import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * **もう一方の言語の本文を、画面に焼かない。**
 *
 * 以前は英語の題と説明を `sr-only`（視覚非表示）で静的HTMLに含めていた。
 * 実ビルドで **28/30ページ**に入っていた。やめた理由はコード側に書いたが、
 * いちばん重いのは **利用者が英語を消せない**こと——`app/user/edit` も
 * `/admin/edit` も日本語欄しか描かないので、日本語を消しても英訳が
 * 画面に残り続ける（あちらは「消した方を優先する」でその形を潰している）。
 *
 * ここで見るのは**描画された結果**。実装から `sr-only` の節を戻すと落ちる。
 */
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: false, userId: null as string | null, loading: false },
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));
vi.mock("../../../../lib/utils/music", () => ({ searchSongs: vi.fn(), parseMusicEmbed: () => null }));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/owner-1/a.jpg",
    userId: "owner-1",
    title: { ja: "北海道の桜", en: "Cherry Blossoms in Hokkaido" },
    description: { ja: ["北海道にも春が訪れた。"], en: ["Spring has come to Hokkaido."] },
} as unknown as Photo;

beforeEach(() => {
    authState.current = { isAuthenticated: false, userId: null, loading: false };
});

/**
 * **本文だけを見る。** `container.textContent` は JSON-LD の中身まで拾うが、
 * あちらの `alternateName`（英語の題）は**意図して残している**ので、
 * そのまま見ると「英語が出ている」と誤判定する（最初それで落とした）。
 */
const bodyText = (root: HTMLElement) => {
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script").forEach((n) => n.remove());
    return clone.textContent ?? "";
};

describe("もう一方の言語の本文", () => {
    it("英語の題を画面に焼かない", async () => {
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("北海道の桜");
        expect(bodyText(container), "英語の題が本文に出ている").not.toContain("Cherry Blossoms in Hokkaido");
    });

    it("英語の説明も画面に焼かない", async () => {
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("北海道の桜");
        expect(bodyText(container), "英語の説明が本文に出ている").not.toContain("Spring has come to Hokkaido");
    });

    // **視覚非表示で置くのも駄目**——見えないだけで静的HTMLには入る
    // （そこが検索エンジン向けの隠しテキストになっていた）
    it("視覚非表示の別言語ブロックを置かない", async () => {
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("北海道の桜");
        expect(container.querySelector('[lang="en"]'), "lang=en の節が残っている").toBeNull();
    });

    // **英語の題は捨てていない。** 構造化データの `alternateName` が持つ
    // （「別の呼び名」を置く正しい場所で、本文に混ぜない）
    it("英語の題は構造化データの alternateName に残る", async () => {
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("北海道の桜");
        const ld = [...container.querySelectorAll('script[type="application/ld+json"]')]
            .map((n) => JSON.parse(n.textContent ?? "{}"))
            .find((d) => d["@type"] === "ImageObject");
        expect(ld?.alternateName, "英語の題まで消している").toBe("Cherry Blossoms in Hokkaido");
        expect(ld?.description, "説明に英語が混ざっている").toBe("北海道にも春が訪れた。");
    });

    // 逆向き: 日本語の本文は当然出る（英語を消す修正が日本語まで消していない）
    it("日本語の題と説明はそのまま出る", async () => {
        const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("北海道の桜");
        expect(bodyText(container)).toContain("北海道にも春が訪れた。");
    });
});
