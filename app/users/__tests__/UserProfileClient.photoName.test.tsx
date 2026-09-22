import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * 🔴 **マイページの写真タイルに、読み上げ用の名前が付いていること。**
 *
 * 中身は `Thumb` だけなので、名前の出どころは `alt`（＝題）しか無かった。
 * `Thumb` は読み込みに失敗すると **`<img>` ごと絵の受け皿に差し替える**
 * ので、そこで名前が消える。実測（Chromium・画像を落とせない状態で
 * `out/` を配信）:
 *
 *     ホーム / さがす / スポット詳細 / 写真ページ …  名前の無い操作 0
 *     マイページ                                  …  **30本**（写真タイル全部）
 *
 * 他の画面が無事なのは `GalleryGrid` が `aria-label` を持っているから。
 * 題を持たない写真でも同じことが起きる（`alt=""` は「装飾画像」の意味）。
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const localeRef = vi.hoisted(() => ({ locale: "ja" }));

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: localeRef.locale }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// 静的な写真データは混ぜない（この画面が出すのは API の分だけにする）
vi.mock("../../data/photos.json", () => ({ default: [] }));

import UserProfileClient from "../UserProfileClient";

const OWNER = "11111111-1111-4111-8111-111111111111";
/**
 * **個別ページを持つ写真の ID を使う**（`app/data/photo-index.json` の実物）。
 * 索引に無い ID を使うと `ROUTES.PHOTO` が `/?photo=<id>` に落ちるので、
 * `a[href^="/photo/"]` で数えるこのテストが1件も拾えなくなる
 * （`lib/routes.ts` の「静的ページがまだ無い写真」の受け皿）。
 */
const P1 = "a129394d-f386-4795-9623-2d6e915d20c7";
const P2 = "88c66c1d-c2fc-4875-9b52-55756db18dbc";
const photo = (id: string, title: string) => ({
    id, src: `https://cdn/x/${id}.jpg`, userId: OWNER, published: true,
    title, createdAt: "2026-08-01T00:00:00Z",
});

/** 訪問者（本人ではない）として開く */
async function openAsVisitor(photos: unknown[]) {
    mockGetCurrentSession.mockResolvedValue(null);
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }) });
    mockPublicFetch.mockResolvedValue({ ok: true, json: async () => photos });
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => photos });
    render(<UserProfileClient userId={OWNER} />);
    await waitFor(() => expect(tiles().length).toBe(photos.length));
}

/** 写真タイルのリンク */
const tiles = () => [...document.querySelectorAll('a[href^="/photo/"]')];

beforeEach(() => {
    localeRef.locale = "ja";
    mockUserFetch.mockReset();
    mockPublicFetch.mockReset();
    mockUserPublicFetch.mockReset();
    mockGetCurrentSession.mockReset();
});

describe("マイページの写真タイルの名前", () => {
    it("🔴 サムネが落ちても名前が残る（`alt` 任せにしない）", async () => {
        await openAsVisitor([photo(P1, "オペラ座の朝"), photo(P2, "夜の橋")]);
        for (const a of tiles()) {
            expect(a.getAttribute("aria-label"), `${a.getAttribute("href")} に名前が無い`).toBeTruthy();
        }
        expect(tiles().map((a) => a.getAttribute("aria-label")))
            .toEqual(["オペラ座の朝 を開く", "夜の橋 を開く"]);
    });

    // 題は必須ではない。空のまま `alt=""` にすると「装飾画像」の意味になり、
    // リンクに名前が1つも無くなる
    it("題が無い写真でも名前が付く", async () => {
        await openAsVisitor([photo(P1, "")]);
        expect(tiles()[0].getAttribute("aria-label")).toBe("写真を開く");
    });

    it("英語では英語で名乗る", async () => {
        localeRef.locale = "en";
        await openAsVisitor([photo(P1, "Opera at dawn"), photo(P2, "")]);
        expect(tiles().map((a) => a.getAttribute("aria-label")))
            .toEqual(["Open Opera at dawn", "Open photo"]);
    });
});
