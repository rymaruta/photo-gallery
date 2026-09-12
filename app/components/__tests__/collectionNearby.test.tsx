import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "../../../lib/data/photos";

/**
 * **「ほかにこんな写真も」の配線。**
 *
 * 薄い集約ページ（実データの `/location/*` は14ページ中10ページが2枚以下）を
 * 読む価値のあるページにするために足した。中身の選び方は
 * `lib/utils/__tests__/relatedCollectionPhotos.test.ts` で見ている。
 *
 * **ここで見るのは「渡しているか・出しているか」**——`nearby={nearby}` を
 * 外しても 4,431件が1つも落ちなかった（この台帳が何度も記録している
 * 「関数は書いたが配線していない」）。
 */
const P = (o: Partial<Photo>): Photo => ({ src: "https://cdn/x.jpg", ...o } as Photo);

const photos: Photo[] = [
    // 撮影地ページは1枚＝薄い
    P({ id: "solo", tags: ["雲海"], category: "風景", location: "高屋神社", createdAt: "2026-03-03T00:00:00Z" }),
    // カテゴリ「風景」を6枚にする（＝厚いページ。線の効きを見るため）
    P({ id: "w1", tags: ["雲海"], category: "風景", location: "別の場所", createdAt: "2026-02-02T00:00:00Z" }),
    P({ id: "w2", tags: ["海"], category: "風景", location: "また別", createdAt: "2026-01-01T00:00:00Z" }),
    P({ id: "w3", category: "風景", location: "地名3", createdAt: "2025-12-01T00:00:00Z" }),
    P({ id: "w4", category: "風景", location: "地名4", createdAt: "2025-11-01T00:00:00Z" }),
    P({ id: "w5", category: "風景", location: "地名5", createdAt: "2025-10-01T00:00:00Z" }),
    // **カテゴリページの外にいて、タグを共有する。** 線が効いていなければ
    // 厚いページにもこれが「近い写真」として出てしまう
    P({ id: "outsider", tags: ["雲海"], category: "ご飯", location: "地名6", createdAt: "2026-05-05T00:00:00Z" }),
    // タグもカテゴリも無い＝近さを測る手がかりが無い
    P({ id: "bare", location: "手がかり無し", createdAt: "2026-04-04T00:00:00Z" }),
];

vi.mock("../../../lib/server/photos", () => ({ loadAllPhotos: async () => photos }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const CollectionPage = (await import("../CollectionPage")).default;

/** サーバー側が組み立てた木から、クライアントへ渡した props を取り出す */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clientProps = (el: any): Record<string, unknown> => {
    const kids = Array.isArray(el?.props?.children) ? el.props.children : [el?.props?.children];
    for (const k of kids) {
        if (k && typeof k === "object" && k.props && "photos" in k.props) return k.props as Record<string, unknown>;
    }
    throw new Error("CollectionPageClient が見つからない");
};

describe("薄い集約ページに「ほかにこんな写真も」を出す", () => {
    it("写真が少ないページには、近い写真を渡す", async () => {
        const props = clientProps(await CollectionPage({ type: "location", slug: "高屋神社" }));
        expect((props.photos as Photo[]).map((p) => p.id), "そのページの写真").toEqual(["solo"]);
        const ids = (props.nearby as Photo[]).map((p) => p.id);
        expect(ids, "近い写真を渡していない").toContain("w1");
        expect(ids, "そのページの写真を混ぜている").not.toContain("solo");
        expect(ids, "手がかりの無い写真まで出している").not.toContain("bare");
    });

    // **主役を薄めない。** たくさん並ぶページには足さない。
    // `outsider` はタグを共有するので、**線が効いていなければ必ず出る**
    it("写真が多いページには渡さない", async () => {
        const props = clientProps(await CollectionPage({ type: "category", slug: "landscape" }));
        expect((props.photos as Photo[]).length, "厚いページになっていない（線を検証できない）")
            .toBeGreaterThanOrEqual(6);
        expect(props.nearby, "たくさんあるページにまで足している").toEqual([]);
    });

    it("画面に節として出る", async () => {
        const el = await CollectionPage({ type: "location", slug: "高屋神社" });
        // サーバーコンポーネントが返す木には <script> も混ざるので、そのまま描く
        render(el as React.ReactElement);
        expect(screen.getByText("ほかにこんな写真も"), "節が出ていない").toBeInTheDocument();
    });

    // **無理に埋めない。** 手がかり（タグ・カテゴリ）が無ければ節ごと出さない
    it("近い写真が無ければ節ごと出さない", async () => {
        const el = await CollectionPage({ type: "location", slug: "手がかり無し" });
        render(el as React.ReactElement);
        expect(screen.queryByText("ほかにこんな写真も"), "空の節を置いている").toBeNull();
    });
});
