import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MapPhoto } from "../../components/PhotoMap";
import MapPhotoSheet from "../MapPhotoSheet";

// 撮影地マップの、画面下のシート。**地図の中のポップアップから出した**
// ——あそこは地図の高さに縛られ、低い画面では中身が枠の外へ出ていた。

const photo = (id: string, extra: Partial<MapPhoto> = {}): MapPhoto => ({
    id,
    src: `https://cdn.example.com/uploads/${id}.jpg`,
    title: { ja: `題${id}` },
    coords: { lat: 35, lng: 139 },
    ...extra,
} as MapPhoto);

function setup(photos: MapPhoto[], index = 0) {
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    const utils = render(
        <MapPhotoSheet photos={photos} index={index} onIndexChange={onIndexChange} onClose={onClose} locale="ja" />,
    );
    return { ...utils, onIndexChange, onClose };
}

describe("撮影地マップのボトムシート", () => {
    it("サムネ・題・撮影地・説明・日付を出す", () => {
        setup([photo("a", {
            thumbSrc: "https://cdn.example.com/uploads/a_thumb.webp",
            location: "高屋神社",
            description: { ja: ["雲海の朝。", "2段落目は出さない。"] },
            date: "2024-10-12",
        } as Partial<MapPhoto>)]);

        expect(screen.getByText("題a")).toBeTruthy();
        expect(screen.getByText("高屋神社")).toBeTruthy();
        expect(screen.getByText("雲海の朝。")).toBeTruthy();
        // 説明は1段落だけ（シートは入口で、全文は個別ページ）
        expect(screen.queryByText("2段落目は出さない。")).toBeNull();
        expect(screen.getByText("2024年10月12日")).toBeTruthy();
        // 題がリンクの読み上げ名になるので、画像の alt は空（＝role は無い）
        const img = screen.getByTestId("map-photo-sheet").querySelector("img");
        expect(img?.getAttribute("src")).toContain("a_thumb.webp");
        expect(img?.getAttribute("alt")).toBe("");
    });

    // **`toLocaleString` を使わない。** 静的書き出しは UTC で走るので、
    // 日付だけの値は UTC より西の閲覧者に前日と表示される
    it("日付は保存されている通りに出す（ゾーン変換しない）", () => {
        const tz = process.env.TZ;
        process.env.TZ = "America/New_York";
        setup([photo("a", { date: "2024-01-01" } as Partial<MapPhoto>)]);
        expect(screen.getByText("2024年1月1日")).toBeTruthy();
        process.env.TZ = tz;
    });

    it("撮影日が無ければ EXIF の撮影日時に落とす", () => {
        setup([photo("a", { exif: { dateTimeOriginal: "2023-05-04T07:30" } } as Partial<MapPhoto>)]);
        expect(screen.getByText("2023年5月4日 07:30")).toBeTruthy();
    });

    it("サムネも題も個別ページへ行く（一番大きい当たりが何もしないのは穴）", () => {
        setup([photo("a")]);
        const links = screen.getAllByRole("link");
        expect(links.length).toBeGreaterThanOrEqual(2);
        for (const a of links) expect(a.getAttribute("href")).toContain("a");
        // 公開ページの `<Link>` は先読みしない（`linkPrefetch.test.ts`）
    });

    // **1枚のときは出さない。** 「1/1」と送れない矢印は、押せるものが
    // 無いことしか伝えない
    it("1枚なら「1/1」も送りの矢印も出さない", () => {
        setup([photo("a")]);
        expect(screen.queryByText("1/1")).toBeNull();
        expect(screen.queryByRole("button", { name: "次の写真" })).toBeNull();
    });

    it("束なら「1/5」を出し、前後に送れる", () => {
        const photos = ["a", "b", "c", "d", "e"].map((id) => photo(id));
        const { onIndexChange } = setup(photos, 0);
        expect(screen.getByText("1/5")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "次の写真" }));
        expect(onIndexChange).toHaveBeenLastCalledWith(1);
    });

    it("端では折り返す（モーダルの前後送りと同じ）", () => {
        const photos = ["a", "b", "c"].map((id) => photo(id));
        const { onIndexChange } = setup(photos, 0);
        fireEvent.click(screen.getByRole("button", { name: "前の写真" }));
        expect(onIndexChange).toHaveBeenLastCalledWith(2);
    });

    it("何枚目かを出す（index に従う）", () => {
        setup(["a", "b", "c"].map((id) => photo(id)), 2);
        expect(screen.getByText("3/3")).toBeTruthy();
        expect(screen.getByText("題c")).toBeTruthy();
    });

    // 束が描き直されて枚数が減ったときに、`photos[index]` が undefined に
    // なって画面ごと落ちるのを防ぐ
    it("範囲の外の index でも落ちない（丸める）", () => {
        setup([photo("a"), photo("b")], 9);
        expect(screen.getByText("2/2")).toBeTruthy();
        expect(screen.getByText("題b")).toBeTruthy();
    });

    it("写真が無ければ何も描かない", () => {
        const { container } = setup([]);
        expect(container.querySelector("[data-testid='map-photo-sheet']")).toBeNull();
    });

    it("閉じるボタンと Escape で閉じる", () => {
        const { onClose } = setup([photo("a")]);
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    // 地図を触ったあとでも効かせたいので `window` に張る
    it("左右キーで送る", () => {
        const { onIndexChange } = setup(["a", "b", "c"].map((id) => photo(id)), 1);
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(onIndexChange).toHaveBeenLastCalledWith(2);
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        expect(onIndexChange).toHaveBeenLastCalledWith(0);
    });

    // **画面下に固定したバーがあるページでは、そのぶん上へ。**
    // 決め打ちの高さで避けると、ラベルが折り返した幅で数px重なる
    it("`--bottom-bar-h` のぶん持ち上げる", () => {
        setup([photo("a")]);
        const sheet = screen.getByTestId("map-photo-sheet") as HTMLElement;
        expect(sheet.style.bottom).toContain("--bottom-bar-h");
        expect(sheet.style.bottom).toContain("safe-area-inset-bottom");
    });
});
