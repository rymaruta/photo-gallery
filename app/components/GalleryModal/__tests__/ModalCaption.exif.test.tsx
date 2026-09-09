import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// **訪問者が見る撮影情報に、二重のメーカー名が出ていた。**
//
// 本番の実データに "Hasselblad Hasselblad X2D II 100C" が実在する
// （`formatCameraName` を使う前に保存された行。公開30枚のうち1機種）。
// `formatCameraName` は正しく動くのに、**保存済みの値をそのまま出す所**が
// 3つあり、このモーダルはそのうち唯一「未ログインの訪問者が見る」経路だった。
//
// **配線を見るテスト**。このリポジトリは「関数は書いたが配線していない」を
// 5回踏んでいる（`freshDisplayNames` が本番のビルドで1行も効いていなかった等）。
// 関数の単体テスト（`lib/utils/__tests__/cameraName.test.ts`）とは別に、
// 画面に出る文字で見る。

vi.mock("../../../music/MusicContext", () => ({
    useMusic: () => ({ current: null, play: vi.fn(), pause: vi.fn(), isPlaying: false }),
}));
vi.mock("next/link", () => ({
    default: ({ children, ...p }: { children: React.ReactNode }) => <a {...p}>{children}</a>,
}));
vi.mock("../../ProfileLink", () => ({ default: () => null }));

import ModalCaption from "../ModalCaption";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photoWith = (camera: string): any => ({
    id: "p1", src: "https://cdn/x.jpg", exif: { camera, lens: "XCD 35-100E" },
});

const renderWith = (camera: string) =>
    render(
        <ModalCaption
            photo={photoWith(camera)}
            locale="ja"
            titleText="題"
            paragraphs={[]}
            locationText=""
            mapText=""
            categoryDisplayMap={{}}
            currentUrl="https://journey-photo.com/?photo=p1"
            shareText="共有"
            onShare={() => undefined}
            onCopyLink={() => undefined}
        />,
    );

describe("モーダルの撮影情報: 機材名", () => {
    it("保存済みの二重のメーカー名は畳んで出す", () => {
        renderWith("Hasselblad Hasselblad X2D II 100C");
        expect(screen.getByText(/Hasselblad X2D II 100C/)).toBeInTheDocument();
        expect(screen.queryByText(/Hasselblad Hasselblad/), "二重のまま出ている").toBeNull();
    });

    // **正当な値を壊さない**（こちらの方が大事）
    it("二重でない機材名はそのまま出す", () => {
        renderWith("SONY ILCE-7M3");
        expect(screen.getByText(/SONY ILCE-7M3/)).toBeInTheDocument();
    });
});
