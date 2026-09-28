import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

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
 * **写真の ID は好きに決めてよい。** 一度 `photo-index.json` の実物の UUID を
 * 直書きしたが、あの索引は DynamoDB から作り直される（staging は空）ので、
 * その写真が消えた日に `ROUTES.PHOTO` が `/?photo=<id>` へ落ち、
 * `a[href^="/photo/"]` で数えていたこのテストが**「waitFor の時間切れ」だけで
 * 落ちる**（名前の話は一言も出ない）。**ID で引く**ようにして索引から切り離す。
 */
const P1 = "photo-1";
const P2 = "photo-2";
const photo = (id: string, title: string) => ({
    id, src: `https://cdn/x/${id}.jpg`, userId: OWNER, published: true,
    title, createdAt: "2026-08-01T00:00:00Z",
});

/** 訪問者（本人ではない）として開く */
async function openAsVisitor(photos: Array<Record<string, unknown> & { id: string }>) {
    SHOWN = photos;
    mockGetCurrentSession.mockResolvedValue(null);
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }) });
    mockPublicFetch.mockResolvedValue({ ok: true, json: async () => photos });
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => photos });
    render(<UserProfileClient userId={OWNER} />);
    await waitFor(() => expect(tiles().length).toBe(photos.length));
}

/**
 * 写真タイルのリンク。**行き先の形（`/photo/<id>` か `/?photo=<id>`）に
 * 依存しない**ように、ID を含む `href` で引く（上の注記の理由）。
 */
const tileFor = (id: string) => document.querySelector(`a[href*="${id}"]`);
const tiles = () => SHOWN.map((p) => tileFor(p.id)).filter((a): a is Element => !!a);
let SHOWN: Array<{ id: string }> = [];

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

    /**
     * **いいねの数を読み上げから落とさない。** ホバーの帯は `aria-hidden` に
     * したので、名前に入れないと消える（`aria-label` は中身を上書きする）。
     * 入れ忘れると、直す前より情報が減る。
     */
    it("いいねが付いていれば名前に入る（帯は読み上げから外す）", async () => {
        await openAsVisitor([{ ...photo(P1, "オペラ座の朝"), likes: 3 }]);
        expect(tiles()[0].getAttribute("aria-label")).toBe("オペラ座の朝 を開く（いいね 3）");
        // 帯そのものは読み上げない（名前と二重にしない）
        const band = tiles()[0].querySelector('[aria-hidden="true"].absolute.inset-0');
        expect(band, "いいねの帯が読み上げから外れていない").not.toBeNull();
    });

    it("いいねが 0 なら名前に足さない", async () => {
        await openAsVisitor([{ ...photo(P1, "オペラ座の朝"), likes: 0 }]);
        expect(tiles()[0].getAttribute("aria-label")).toBe("オペラ座の朝 を開く");
    });

    it("英語では英語で名乗る", async () => {
        localeRef.locale = "en";
        await openAsVisitor([photo(P1, "Opera at dawn"), photo(P2, "")]);
        expect(tiles().map((a) => a.getAttribute("aria-label")))
            .toEqual(["Open Opera at dawn", "Open photo"]);
    });

    it("英語でもいいねの数が名前に入る", async () => {
        localeRef.locale = "en";
        await openAsVisitor([{ ...photo(P1, "Opera at dawn"), likes: 2 }]);
        expect(tiles()[0].getAttribute("aria-label")).toBe("Open Opera at dawn (2 likes)");
    });

    /**
     * **公開範囲を絞った写真の印。** 絞った写真はウェブサイトに載らないので、
     * 持ち主の一覧で印が無いと「なぜトップに無いのか」が分からない。名前にも入れる
     */
    it("公開範囲を絞った写真は、印と名前で分かる", async () => {
        await openAsVisitor([
            { ...photo(P1, "山の朝"), audience: "followers" },
            { ...photo(P2, "海の夜"), audience: "closeFriends" },
        ]);
        expect(tiles().map((a) => a.getAttribute("aria-label")))
            .toEqual(["山の朝 を開く（フォロワーのみ）", "海の夜 を開く（親しい友達）"]);
        // 印は絵だけの丸（四隅のボタンの下に隠れないよう、削除ボタンの上に積む）
        expect(tiles()[0].querySelector('[title="フォロワーのみ"]'), "フォロワーのみの印が無い").not.toBeNull();
        expect(tiles()[1].querySelector('[title="親しい友達"]'), "親しい友達の印が無い").not.toBeNull();
    });

    it("英語では半角の括弧で足す", async () => {
        localeRef.locale = "en";
        await openAsVisitor([{ ...photo(P1, "Morning"), audience: "followers" }]);
        expect(tiles()[0].getAttribute("aria-label")).toMatch(/ \(Followers\)$/);
    });

    it("全体に公開の写真には印を付けない", async () => {
        await openAsVisitor([photo(P1, "山の朝")]);
        expect(tiles()[0].getAttribute("aria-label")).toBe("山の朝 を開く");
        expect(tiles()[0].querySelector('[title="フォロワーのみ"], [title="親しい友達"]')).toBeNull();
    });
});
