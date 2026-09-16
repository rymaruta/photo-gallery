import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PHOTO_INDEX from "@/app/data/photo-index.json";

/**
 * **「個別ページを見る」が、押しても何も起きない形で出ていた。**
 *
 * `ROUTES.PHOTO` は個別ページを持たない写真（公開してから再ビルドが
 * 終わるまでの数分）を `/?photo=<id>` に落とす。どこから押しても
 * 行き止まりにはならない仕組みだが、**このモーダルは既にその URL が
 * 開いている画面**——押すと同じモーダルが開き直るだけで、文言は
 * 個別ページを約束している。
 *
 * **その窓は、投稿した本人が自分の写真を見に来る時間そのもの。**
 *
 * 実データ30枚は全部 `/photo/<id>` を持つので、**平常時はこの節が
 * ボタンを消さないこと**（下の1本目）の方が大事。
 */

vi.mock("../../../music/MusicContext", () => ({
    useMusic: () => ({ current: null, play: vi.fn(), pause: vi.fn(), isPlaying: false }),
}));
vi.mock("next/link", () => ({
    default: ({ children, ...p }: { children: React.ReactNode }) => <a {...p}>{children}</a>,
}));
vi.mock("../../ProfileLink", () => ({ default: () => null }));

import ModalCaption from "../ModalCaption";

const BUILT_ID = (PHOTO_INDEX as { photoIds: string[] }).photoIds[0];
const UNBUILT_ID = "not-in-build-00000000-0000-0000-0000-000000000000";

const renderWith = (id: string) =>
    render(
        <ModalCaption
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            photo={{ id, src: "https://cdn/x.jpg" } as any}
            locale="ja"
            titleText="題"
            paragraphs={[]}
            locationText=""
            mapText=""
            categoryDisplayMap={{}}
            currentUrl={`https://journey-photo.com/?photo=${id}`}
            shareText="共有"
            onShare={() => undefined}
            onCopyLink={() => undefined}
        />,
    );

const link = () => screen.queryByRole("link", { name: /個別ページを見る/ });

describe("モーダルの「個別ページを見る」", () => {
    // **平常時はこちら。** 実データ30枚は全部この側
    it("個別ページがある写真では出て、そのページを指す", () => {
        expect(PHOTO_INDEX.photoIds.length, "索引が空だとこの節は何も見ていない").toBeGreaterThan(0);
        renderWith(BUILT_ID);
        expect(link()).toHaveAttribute("href", `/photo/${BUILT_ID}`);
    });

    it("まだ個別ページが無い写真では出さない（押しても同じモーダルが開くだけ）", () => {
        expect(PHOTO_INDEX.photoIds).not.toContain(UNBUILT_ID);
        renderWith(UNBUILT_ID);
        expect(link(), "行き先が /?photo= のままボタンだけ出ている").toBeNull();
    });

    // **`/?photo=` を指すリンクを出さない**、が見たい性質
    // （文言を変えられてもこちらは残る）
    it("どちらの場合も /?photo= を指すリンクは出さない", () => {
        for (const id of [BUILT_ID, UNBUILT_ID]) {
            const { container, unmount } = renderWith(id);
            const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
            expect(hrefs.filter((h) => h.startsWith("/?photo=")), id).toEqual([]);
            unmount();
        }
    });

    // 共有の URL は落とし先のままでよい（別のタブ・別の人が開くので
    // モーダルが実際に開く）。消したのはボタンだけ、を固定する
    it("共有の欄は消していない", () => {
        renderWith(UNBUILT_ID);
        expect(screen.getByRole("button", { name: "共有" })).toBeInTheDocument();
    });
});
