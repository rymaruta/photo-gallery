import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ja } from "../i18n/labels";

/**
 * **絞り込みチップの字を、飛び先と揃える。**
 *
 * カテゴリの表示名は `labels.category.names`＝**スラッグで引く表**。
 * 生の値で引いていた頃は、別名で保存された写真（`建物`）だけ表に当たらず、
 * 写真ページのチップと集約ページの見出しが食い違っていた（`a0f59239`）。
 * トップの地図も同じ規則（`categoryChipMap`）で作る。
 *
 * **ここは配線を見る**——地図を作るのをやめる変異が、
 * `lib/utils/__tests__/categoryMap.test.ts` だけでは素通りしていた。
 */
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
// **表は本物を使う。** `names: {}` にすると別名が寄る様子を観測できない
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { ...ja, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
// **サムネの下に出す名前は、この地図がそのまま決める**
// （`GalleryGrid` は落とし先を持たないので、渡し忘れると文字が消える）。
// チップ側は `FilterBar` が `labels.category.names` に落ちる保険を
// 持っているので、**渡し忘れを観測できるのはこちらだけ**
const gridProps = vi.hoisted(() => ({ map: undefined as Record<string, string> | undefined }));
vi.mock("../components/GalleryGrid", () => ({
    default: (p: { categoryDisplayMap?: Record<string, string> }) => { gridProps.map = p.categoryDisplayMap; return null; },
}));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// 別名（建物 → architecture）・スラッグ・表に無い値 の3種
const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "建物", tags: [], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "landscape", tags: [], date: "2026-01-02", createdAt: "2026-01-02" },
    { id: "p3", src: "https://cdn/c.jpg", title: "う", category: "travel", tags: [], date: "2026-01-03", createdAt: "2026-01-03" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => { mockShowToast.mockReset(); window.history.replaceState({}, "", "/"); });

describe("カテゴリのチップの字", () => {
    it("別名で保存されていても、飛び先と同じ名前で出る", () => {
        render(<GalleryPageClient />);
        expect(screen.getByText("建築"), "別名の写真のチップが生の値のまま").toBeInTheDocument();
        expect(screen.queryByText("建物"), "飛び先と違う言葉を出している").toBeNull();
        expect(screen.getByText("風景")).toBeInTheDocument();
        // 表に無いカテゴリは本人が書いた言葉のまま（一覧・写真ページと同じ）
        expect(screen.getByText("travel"), "見出し語に書き換えている").toBeInTheDocument();
    });

    // **サムネの下の名前は、この地図を渡さないと消える。**
    // チップ側は `FilterBar` の落とし先があるので、渡し忘れても字が出る
    // ——渡し忘れを観測できるのはこちら
    it("サムネの下に出す地図を、ちゃんと渡している", () => {
        render(<GalleryPageClient />);
        expect(gridProps.map, "地図を渡していない").toBeTruthy();
        expect(gridProps.map?.architecture, "別名の写真のカテゴリが空欄になる").toBe("建築");
        expect(gridProps.map?.landscape).toBe("風景");
        expect(gridProps.map?.travel).toBe("travel");
    });
});
