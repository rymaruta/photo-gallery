import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { Photo } from "@/lib/data/photos";

/**
 * ホームの1枚（最終版モックのカード・owner「全く同じにしたい」）。
 *
 * **投稿者の行が先、写真が後**——モックは投稿者（アバター・名前・撮影地・
 * 投稿時間）を一番上に置き、角丸の写真、題と本文、チップ、いいね・コメント・
 * シェア・保存の行、の順。以前の「写真が先で題を重ねる」形はやめた。
 *
 * 保存の押し心地（番人・巻き戻し）は `usePhotoSave` 側の担当なので、ここでは
 * 境界としてモックし、**カードが何を渡し、結果をどう見せるか**だけを見る。
 */
const mockShowToast = vi.fn();
vi.mock("@/lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const saveState = { current: { saved: false, pending: false, toggle: vi.fn() } };
const usePhotoSaveMock = vi.fn((..._a: unknown[]) => saveState.current);
vi.mock("@/lib/hooks/usePhotoSave", () => ({ usePhotoSave: (...a: unknown[]) => usePhotoSaveMock(...a) }));

const shareUrlMock = vi.fn();
vi.mock("@/lib/utils/share", () => ({ shareUrl: (...a: unknown[]) => shareUrlMock(...a) }));

vi.mock("../UserAvatar", () => ({ default: ({ userId }: { userId: string }) => <span data-avatar={userId} /> }));

import TimelineCard from "../TimelineCard";
import { ROUTES } from "@/lib/routes";

/** a が b より DOM 上で前に在るか（`innerHTML` の文字位置は aria-label の中の題に当たるので使わない） */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const base: Photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/u1/a.jpg",
    userId: "u1",
    displayName: "Yuta",
    title: "エーゲ海の夕景",
    location: "ギリシャ・サントリーニ島",
    description: "言葉を忘れるほど、美しい夕暮れだった。",
    tags: ["ギリシャ", "絶景"],
    likes: 1284,
    commentCount: 48,
};

const card = (p: Partial<Photo> = {}, props: Record<string, unknown> = {}) =>
    render(<TimelineCard photo={{ ...base, ...p }} locale="ja" {...props} />);

beforeEach(() => {
    mockShowToast.mockReset();
    shareUrlMock.mockReset();
    usePhotoSaveMock.mockClear();
    saveState.current = { saved: false, pending: false, toggle: vi.fn(async () => ({ ok: true })) };
});

describe("ホームのカード（モックの並び）", () => {
    it("投稿者の行が写真より先。名前・撮影地・アバターはプロフィールへ", () => {
        const { container } = card();
        const photo = container.querySelector("[data-photo-id]")!;
        expect(before(screen.getByText("Yuta"), photo), "名前が写真より後ろにある").toBe(true);
        expect(screen.getByText("ギリシャ・サントリーニ島")).toBeTruthy();
        const name = screen.getByRole("link", { name: "Yuta" });
        expect(name.getAttribute("href")).toContain("u1");
        expect(container.querySelector("[data-avatar='u1']")).toBeTruthy();
    });

    it("題と本文は写真の下（重ねない）。題は検索に効く文字なので消さない", () => {
        const { container } = card();
        const photo = container.querySelector("[data-photo-id]")!;
        expect(before(photo, screen.getByText("エーゲ海の夕景")), "題が写真より前にある（重ねている）").toBe(true);
        expect(screen.getByText("言葉を忘れるほど、美しい夕暮れだった。")).toBeTruthy();
    });

    it("🔴 フォローのボタンはカードに置かない（モックに無い。持ち場はプロフィールと写真ページ）", () => {
        card({}, { isAuthenticated: true });
        expect(screen.queryByRole("button", { name: /フォロー/ })).toBeNull();
    });

    it("タグはチップで、集約ページへのリンク", () => {
        card();
        const tag = screen.getByRole("link", { name: "#ギリシャ" });
        expect(tag.getAttribute("href")).toContain("/tag/");
        expect(tag.className).toContain("bg-chip");
    });

    it("🔴 同じタグを2回出さない（`#旅` と `旅` は同じ）", () => {
        card({ tags: ["旅", "#旅", "Tabi", "tabi"] });
        expect(screen.getAllByRole("link", { name: /^#/ }).map((a) => a.textContent)).toEqual(["#旅", "#Tabi"]);
    });

    it("タグが多すぎても出しすぎない（写真より文字が多くならない）", () => {
        card({ tags: ["a", "b", "c", "d", "e", "f"] });
        expect(screen.getAllByRole("link", { name: /^#/ })).toHaveLength(4);
    });

    it("🔴 いいね・コメントは押せる見た目のボタンにせず、写真ページへのリンクにする", () => {
        card();
        expect(screen.getByText("1,284")).toBeTruthy();
        expect(screen.getByText("48")).toBeTruthy();
        const like = screen.getByRole("link", { name: /いいね 1284件/ });
        expect(like.getAttribute("href")).toContain("p1");
        expect(screen.getByRole("link", { name: /コメント 48件/ }).getAttribute("href")).toContain("p1");
    });

    it("複数枚なら「1/N」", () => {
        card({ extraImages: [{ src: "https://cdn.example.com/uploads/u1/b.jpg" }] });
        expect(screen.getByText("1/2")).toBeTruthy();
    });

    it("🔴 壊れた要素は数えない（「1/3」と出して開くと2枚、を作らない）", () => {
        card({ extraImages: [{ src: "https://cdn.example.com/uploads/u1/b.jpg" }, { src: "" } as never, null as never] });
        expect(screen.getByText("1/2"), "壊れた要素まで数えている").toBeTruthy();
    });

    it("extraImages が配列でなくても落ちない", () => {
        card({ extraImages: "x" as never });
        expect(screen.queryByText(/^1\//)).toBeNull();
    });

    it("写真を押すと写真ページへ（先読みしない）", () => {
        const { container } = card();
        const link = container.querySelector("[data-photo-id]") as HTMLAnchorElement;
        expect(link.getAttribute("href")).toContain("p1");
    });
});

describe("保存（右端のしおり）", () => {
    it("🔴 一覧から分かっている保存の有無を `usePhotoSave` に渡す（写真ごとに聞きに行かせない）", () => {
        card({}, { isAuthenticated: true, savedIds: new Set(["p1", "p9"]) });
        expect(usePhotoSaveMock).toHaveBeenCalledWith("p1", true, false, true);
        usePhotoSaveMock.mockClear();
        card({ id: "p2" }, { isAuthenticated: true, savedIds: new Set(["p1"]) });
        expect(usePhotoSaveMock).toHaveBeenCalledWith("p2", true, false, false);
    });

    it("一覧がまだ無ければ（null）分からないまま渡す＝フックが自分で聞きに行く", () => {
        card({}, { isAuthenticated: true, savedIds: null });
        expect(usePhotoSaveMock).toHaveBeenCalledWith("p1", true, false, undefined);
    });

    it("保存済みは青いしおりで aria-pressed", () => {
        saveState.current = { ...saveState.current, saved: true };
        card();
        const btn = screen.getByRole("button", { name: "保存を取り消す" });
        expect(btn.getAttribute("aria-pressed")).toBe("true");
        expect(btn.className).toContain("text-accent");
    });

    it("押すと toggle。未ログインなら「失敗」ではなく案内", async () => {
        saveState.current.toggle = vi.fn(async () => ({ ok: false, requiresAuth: true }));
        card();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("写真を保存するにはログインしてください", "error"));
    });

    it("失敗の理由があればそれを出す", async () => {
        saveState.current.toggle = vi.fn(async () => ({ ok: false, message: "通信できません" }));
        card();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("通信できません", "error"));
    });

    it("成功なら何も言わない", async () => {
        card();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(saveState.current.toggle).toHaveBeenCalled());
        expect(mockShowToast).not.toHaveBeenCalled();
    });
});

describe("シェア", () => {
    it("🔴 配るのは写真ページの URL（`?photo=` ではなく `/photo/<id>`）。コピーに落ちたら知らせる", async () => {
        shareUrlMock.mockResolvedValue("copied");
        card();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(shareUrlMock).toHaveBeenCalled());
        const [url, title] = shareUrlMock.mock.calls[0] as [string, string];
        // `ROUTES.PHOTO` は索引に無い写真だけ `/?photo=<id>` に落とす（ビルド後に上がった写真の救済）。
        // 配る URL はその規則と同じ＝写真ページ側で決まる
        expect(url).toBe(new URL(ROUTES.PHOTO("p1"), "http://localhost:3000").href);
        expect(ROUTES.PHOTO("p1")).toMatch(/photo/);
        expect(title).toBe("エーゲ海の夕景");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("リンクをクリップボードにコピーしました", "success"));
    });

    it("共有シートで済んだ／閉じた回は何も出さない", async () => {
        shareUrlMock.mockResolvedValue("cancelled");
        card();
        fireEvent.click(screen.getByRole("button", { name: "シェア" }));
        await waitFor(() => expect(shareUrlMock).toHaveBeenCalled());
        expect(mockShowToast).not.toHaveBeenCalled();
    });
});

/**
 * 🔴 **「3日前」を静的HTMLに焼かない。**
 *
 * 静的書き出しはビルド時に文字列を焼くので、相対時刻をそのまま出すと
 * **ビルドの翌日以降は毎回 水和が食い違う**（実測: `out/index.html` に
 * 「244日前」が19件焼かれていて、実ブラウザのスモークが React の
 * 水和エラー #418 を出した）。
 */
describe("相対時刻と水和", () => {
    const withTime = { ...base, createdAt: "2020-01-01T00:00:00Z" };

    it("🔴 サーバーの描画には相対時刻を含めない", () => {
        const html = renderToString(<TimelineCard photo={withTime} locale="ja" />);
        expect(html, "静的HTMLに相対時刻が焼かれている（翌日には食い違う）")
            .not.toMatch(/日前|時間前|たった今/);
    });

    it("React が付いたあとは出す", () => {
        render(<TimelineCard photo={withTime} locale="ja" />);
        expect(screen.getByText(/日前/)).toBeTruthy();
    });

    it("題・撮影地・説明は静的HTMLに焼いたまま（検索に効く文字）", () => {
        const html = renderToString(<TimelineCard photo={withTime} locale="ja" />);
        expect(html).toContain("エーゲ海の夕景");
        expect(html).toContain("ギリシャ・サントリーニ島");
        expect(html).toContain("言葉を忘れるほど");
    });
});
