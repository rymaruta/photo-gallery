// @vitest-environment jsdom
// ↑ 画像の属性（loading・srcset・sizes・alt）を happy-dom が jsdom と同じに扱わない。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * **最初の画面に出る写真が、後回し指定になっていないこと。**
 *
 * `UserProfileClient` は `Thumb` に `priority` を渡していなかったので、
 * グリッドは**1枚目から全部 `loading="lazy"`＋`fetchPriority="auto"`** だった
 * （`GalleryGrid` は `index < 8` で渡している）。`/users/<id>` はサイトマップに
 * 載る公開ページで、画面のいちばん上に出る写真が後回しになっていた。
 *
 *     実測（Chromium・代替画像）  画面内の img   うち loading="lazy"
 *       スマホ 390x844                11              9
 *       デスクトップ 1280x800           5              3
 *
 * **LCP の要素そのものは測れていない。** 代替画像は単色で情報量が低く、
 * Chrome はそういう画像を LCP の候補から除外する（写真ページで LCP が
 * `<p>` になったのがその証拠）。ここで確かなのは「画面内の写真が lazy」まで。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
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
vi.mock("../../data/photos.json", () => ({ default: [] }));

const OWNER = "33333333-3333-4333-8333-333333333333";

import UserProfileClient from "../UserProfileClient";

const photo = (id: string) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id,
    category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01", published: true,
});

const SIX = ["a", "b", "c", "d", "e", "f"].map(photo);

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => SIX });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => SIX });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

/** グリッドの写真だけを取る（カバーとアバターは alt が空なので外れる） */
async function gridThumbs() {
    await waitFor(() => expect(screen.getByAltText("a")).toBeInTheDocument());
    return SIX.map((p) => screen.getByAltText(p.id));
}

describe("プロフィールの写真の読み込み優先度", () => {
    it("先頭の3枚は「すぐ読む」", async () => {
        render(<UserProfileClient userId={OWNER} />);
        const imgs = await gridThumbs();
        for (const img of imgs.slice(0, 3)) {
            expect(img.getAttribute("loading"), `${img.getAttribute("alt")} が後回し指定`).toBe("eager");
            expect(img.getAttribute("fetchpriority")?.toLowerCase()).toBe("high");
        }
    });

    it("4枚目からは後回し（画面外まで高い優先度にしない）", async () => {
        render(<UserProfileClient userId={OWNER} />);
        const imgs = await gridThumbs();
        for (const img of imgs.slice(3)) {
            expect(img.getAttribute("loading"), `${img.getAttribute("alt")} を無駄に先読みしている`).toBe("lazy");
            expect(img.getAttribute("fetchpriority")?.toLowerCase()).toBe("auto");
        }
    });

    // **枚数そのものを見る。** 「先頭のどれかが eager」だけだと、0枚にしても
    // 6枚にしても通ってしまう判定になりうる
    it("「すぐ読む」はちょうど3枚", async () => {
        render(<UserProfileClient userId={OWNER} />);
        const imgs = await gridThumbs();
        expect(imgs.filter((i) => i.getAttribute("loading") === "eager")).toHaveLength(3);
    });
});
