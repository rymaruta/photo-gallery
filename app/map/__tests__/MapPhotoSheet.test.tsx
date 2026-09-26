import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MapPhoto } from "../../components/PhotoMap";
import { ROUTES } from "../../../lib/routes";
import { expectNoWhiteOnFill } from "../../components/__tests__/whiteOnFill";

// **配信のホストを先に決める。** `lib/utils/seo.ts` の `CDN_HOST` は
// モジュール読み込み時に `NEXT_PUBLIC_CLOUDFRONT_URL` から決まるので、
// import より前（= `vi.hoisted`）で入れないと「揃える」経路に入らない。
// 他のフィクスチャは `https://cdn.example.com/...` で、ここで決めるホストとは
// 別物——揃える対象にならないので、他のテストの見え方は変わらない
const ORIGINS = vi.hoisted(() => {
    const cdn = "https://cdn-default.invalid";
    const site = "https://site.invalid";
    process.env.NEXT_PUBLIC_CLOUDFRONT_URL = cdn;
    process.env.NEXT_PUBLIC_SITE_URL = site;
    return { cdn, site };
});

const MapPhotoSheet = (await import("../MapPhotoSheet")).default;

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
    it("主ボタン（白の塗り）の上に白い文字・白いフォーカス枠が無い", () => {
        render(
            <MapPhotoSheet photos={[photo("a")]} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} locale="ja"
                relatedHref="/location/takaya" />,
        );
        expect(screen.getByTestId("map-sheet-location-link")).toBeTruthy();
        expectNoWhiteOnFill(screen.getByTestId("map-photo-sheet"));
    });

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
    //
    // ⚠️ **戻しは `finally` で。** 素直に最後の行に置いていたので、
    // この assertion が落ちた回に `TZ` が `America/New_York` のまま
    // **後続のテストへ漏れて**いた（同じワーカーで走るファイルにも）。
    // 台帳には「テストが走らせた時刻で落ちる」事故が既に1件あり、
    // そのときの調査を遠回りにするのがまさにこの形。
    it("日付は保存されている通りに出す（ゾーン変換しない）", () => {
        const tz = process.env.TZ;
        process.env.TZ = "America/New_York";
        try {
            setup([photo("a", { date: "2024-01-01" } as Partial<MapPhoto>)]);
            expect(screen.getByText("2024年1月1日")).toBeTruthy();
        } finally {
            // **`undefined` なら消す。** `= undefined` を代入すると
            // `process.env` は文字列 `"undefined"` にする（＝無効なゾーン名）
            if (tz === undefined) delete process.env.TZ;
            else process.env.TZ = tz;
        }
    });

    it("撮影日が無ければ EXIF の撮影日時に落とす", () => {
        setup([photo("a", { exif: { dateTimeOriginal: "2023-05-04T07:30" } } as Partial<MapPhoto>)]);
        expect(screen.getByText("2023年5月4日 07:30")).toBeTruthy();
    });

    it("サムネも題も個別ページへ行く（一番大きい当たりが何もしないのは穴）", () => {
        setup([photo("a")]);
        const links = screen.getAllByRole("link");
        expect(links.length).toBeGreaterThanOrEqual(2);
        // リンク先そのもの（`ROUTES.PHOTO` と一致）を見る。`toContain("a")` は
        // ほぼ何でも通るので、何も固定していなかった
        for (const a of links) expect(a.getAttribute("href")).toBe(ROUTES.PHOTO("a"));
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

        // `useEscapeKey` は document で聞く（他のモーダルと同じ口）
        fireEvent.keyDown(document, { key: "Escape" });
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
    });

    // `BottomNav` が出す `--bottom-bar-h` は **safe-area 込みの実寸**。
    // こちらで足すと notch 端末で 34px 浮く（最初そう書いていた）。
    // 変数が無いときの落とし先としてだけ使う
    it("safe-area を二重に足さない（変数が無いときの落とし先にだけ使う）", () => {
        setup([photo("a")]);
        const bottom = (screen.getByTestId("map-photo-sheet") as HTMLElement).style.bottom;
        expect(bottom).toMatch(/var\(--bottom-bar-h,\s*env\(safe-area-inset-bottom/);
        // safe-area は**落とし先の1回だけ**。否定の正規表現は逆順の二重足し
        // （`var(...) + env(...)`）を通していたので、出現回数で見る
        expect(bottom.match(/env\(safe-area-inset-bottom/g)).toHaveLength(1);
    });

    // `MiniPlayer` は同じ位置・同じ z-40 で、`layout.tsx` が children の後に
    // 描く。同じ z だと曲を流しながら来た人のシートの下半分をプレイヤーが覆う。
    // ヘッダー（z-50）よりは後ろ
    it("MiniPlayer（z-40）より前・ヘッダー（z-50）より後ろに出す", () => {
        setup([photo("a")]);
        const cls = (screen.getByTestId("map-photo-sheet") as HTMLElement).className;
        const z = Number(/z-\[(\d+)\]/.exec(cls)?.[1]);
        expect(z).toBeGreaterThan(40);
        expect(z).toBeLessThan(50);
    });

    // 移さないと、読み上げは開いたことを知らせず、Tab で来た人はピンに
    // 残ったまま。閉じると要素が消えてフォーカスが body に落ちる
    it("開いたら閉じるボタンへフォーカスし、閉じたら元へ戻す", () => {
        const pin = document.createElement("button");
        pin.textContent = "ピン";
        document.body.appendChild(pin);
        pin.focus();
        expect(document.activeElement).toBe(pin);

        const { unmount } = setup([photo("a")]);
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "閉じる" }));

        unmount();
        expect(document.activeElement).toBe(pin);
        pin.remove();
    });

    // 地図を押した直後は Leaflet が地図の容器にフォーカスを移していて、
    // その間の矢印は Leaflet の `Keyboard` が document の keydown で受けて
    // `stop(e)` する。bubble で張るとここへ届かない
    it("document で止められる矢印でも送れる（capture で拾う）", () => {
        const leafletLike = (e: KeyboardEvent) => { e.stopPropagation(); };
        document.addEventListener("keydown", leafletLike);
        try {
            const { onIndexChange } = setup(["a", "b"].map((id) => photo(id)), 0);
            fireEvent.keyDown(document.body, { key: "ArrowRight" });
            expect(onIndexChange).toHaveBeenLastCalledWith(1);
        } finally {
            document.removeEventListener("keydown", leafletLike);
        }
    });

    // 同じ画面に投稿シートの入力欄が開きうる。カーソル移動を横取りしない
    it("入力欄の中の矢印は触らない", () => {
        const { onIndexChange } = setup(["a", "b"].map((id) => photo(id)), 0);
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        fireEvent.keyDown(input, { key: "ArrowRight" });
        expect(onIndexChange).not.toHaveBeenCalled();
        input.remove();
    });

    // 変換中の Escape は「変換の取り消し」。閉じてはいけない（`useEscapeKey` と同じ）
    it("IME の変換中の Escape では閉じない", () => {
        const { onClose } = setup([photo("a")]);
        fireEvent.keyDown(document, { key: "Escape", isComposing: true });
        expect(onClose).not.toHaveBeenCalled();
    });

    // 出すURLはサイトのドメインに揃える（`Thumb` と同じ理由。`PhotoMap` の
    // ポップアップが持っていた検証を、サムネごとこちらへ移した）
    it("配信の既定ドメインで保存された写真も、サイトのドメインで出す", () => {
        setup([photo("a", { thumbSrc: `${ORIGINS.cdn}/uploads/u1/a_thumb.webp` } as Partial<MapPhoto>)]);
        const img = screen.getByTestId("map-photo-sheet").querySelector("img");
        expect(img?.getAttribute("src")).toBe(`${ORIGINS.site}/uploads/u1/a_thumb.webp`);
    });

    it("知らないホストの写真は触らない", () => {
        setup([photo("a", { thumbSrc: "https://example.org/x.webp" } as Partial<MapPhoto>)]);
        const img = screen.getByTestId("map-photo-sheet").querySelector("img");
        expect(img?.getAttribute("src")).toBe("https://example.org/x.webp");
    });
});
