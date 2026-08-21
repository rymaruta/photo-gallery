import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUserFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
}));

vi.mock("../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));

import NotificationsBell from "../NotificationsBell";

const ITEMS = [
    { type: "like", photoId: "p1", photoSrc: "https://c/p1_thumb.webp", byName: "旅子", t: "2026-07-10T00:00:00Z" },
    { type: "comment", photoId: "p2", photoSrc: "https://c/p2_thumb.webp", byName: "山田", t: "2026-07-09T00:00:00Z" },
    // 実際には作られない種類。将来わけの分からない通知が
    // 「旅立たせました！」として出ないことを固定する。
    { type: "go", photoId: "p3", photoSrc: "https://c/p3.jpg", byName: "旅人", atLocation: "北海道", t: "2026-07-08T00:00:00Z" },
];

function fetchOk(body: unknown) {
    return { ok: true, json: async () => body };
}

beforeEach(() => {
    mockUserFetch.mockReset();
});

describe("NotificationsBell", () => {
    it("いいね・コメントの通知を表示できる", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: ITEMS, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.getByText(/さんがあなたの写真にいいねしました/)).toBeInTheDocument();
        expect(screen.getByText(/さんがあなたの写真にコメントしました/)).toBeInTheDocument();
    });

    it("知らない種類の通知に勝手な文言を付けない", async () => {
        // 以前は最後の else が「旅立たせました！」の分岐だったので、
        // 想定外の type が全部その文言で表示される作りだった
        // （その通知を作る側はどこにも無い＝出るとしたら全部が誤表示）。
        mockUserFetch.mockResolvedValue(fetchOk({ items: ITEMS, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.queryByText(/旅立たせました/)).toBeNull();
        expect(screen.queryByText(/行きたいリストに追加/)).toBeNull();
    });

    it("通知タップで写真ページへのリンクになっている", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: ITEMS, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        const links = screen.getAllByRole("link");
        // ROUTES.PHOTO はホームの写真モーダルを開く /?photo=<id> 形式
        expect(links.map((a) => a.getAttribute("href"))).toEqual(["/?photo=p1", "/?photo=p2", "/?photo=p3"]);
    });

    it("未読数バッジを表示し、開くと既読化リクエストを送る", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: ITEMS, unread: 2 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.queryByText("2")).toBeNull();
        await waitFor(() => {
            expect(mockUserFetch).toHaveBeenCalledWith("/user/notifications", { method: "PUT" });
        });
    });

    it("通知が空でも壊れない（空メッセージ表示）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: [], unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.getByText(/いいね・行きたいリスト追加・旅立ちの報告がここに届きます/)).toBeInTheDocument();
    });
});

// このベルはヘッダーに常駐する。取得が `[]` deps の1回きりだった頃は、
// **リロードするまで新着が出なかった**——いいねもコメントもフォローも
// ここに届くのに、開いても前に読み込んだ内容のままだった。
describe("新着の取り込み", () => {
    it("開いたときに取り直す（閉じている間に届いたぶんが見える）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: [], unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/notifications"));

        // 閉じている間に1件届いた
        mockUserFetch.mockResolvedValue(fetchOk({ items: [ITEMS[0]], unread: 1 }));
        fireEvent.click(screen.getByRole("button"));

        expect(await screen.findByText(/旅子/)).toBeInTheDocument();
    });

    it("一定間隔でも取り直す（開かなくてもバッジが更新される）", async () => {
        vi.useFakeTimers();
        try {
            mockUserFetch.mockResolvedValue(fetchOk({ items: [], unread: 0 }));
            render(<NotificationsBell />);
            const first = mockUserFetch.mock.calls.length;

            await vi.advanceTimersByTimeAsync(61_000);
            expect(mockUserFetch.mock.calls.length).toBeGreaterThan(first);
        } finally {
            vi.useRealTimers();
        }
    });

    it("見えていないタブでは取りにいかない", async () => {
        vi.useFakeTimers();
        const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        try {
            mockUserFetch.mockResolvedValue(fetchOk({ items: [], unread: 0 }));
            render(<NotificationsBell />);
            const first = mockUserFetch.mock.calls.length;

            await vi.advanceTimersByTimeAsync(61_000);
            expect(mockUserFetch.mock.calls.length).toBe(first);
        } finally {
            hidden.mockRestore();
            vi.useRealTimers();
        }
    });
});
