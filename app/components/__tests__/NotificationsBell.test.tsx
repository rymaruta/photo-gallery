import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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

    // 開くと GET と PUT がほぼ同時に出るが、サーバーは GET を先に受けるので
    // まだ `unread: 2` を返す。返りをそのまま採っていたので、消えたバッジが
    // 数百ms後に「2」で復活していた（次のポーリング＝60秒まで直らず、
    // 裏に回したタブはポーリングを飛ばすので更に長い）。
    it("開いたあとに届いた古い未読数で、バッジが復活しない", async () => {
        // 開いたときの GET だけ、応答を手元で止めておく
        let release: (v: unknown) => void = () => {};
        mockUserFetch.mockResolvedValueOnce(fetchOk({ items: ITEMS, unread: 2 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());

        mockUserFetch.mockImplementation((path: string, init?: { method?: string }) =>
            init?.method === "PUT"
                ? Promise.resolve(fetchOk({}))
                : new Promise((res) => { release = res; }));

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.queryByText("2")).toBeNull();

        // ここで「既読化より前に投げた GET」が返ってくる
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/notifications", { method: "PUT" }));
        await act(async () => { release(fetchOk({ items: ITEMS, unread: 2 })); });

        expect(screen.queryByText("2")).toBeNull();
    });

    // 未読数だけ捨てて一覧は採っていた頃、遅い GET が返ってくると
    // 「新しい方で出ている未読を 0 にし、一覧まで古い方で上書きする」
    // ——**新着が最大60秒（裏タブはもっと長く）出ない**方に倒れていた。
    // 古い数字が出るより、新着が出ない方が悪い。
    it("追い越された取得は、一覧も未読数も採らない", async () => {
        let releaseSlow: (v: unknown) => void = () => {};
        mockUserFetch.mockResolvedValueOnce(fetchOk({ items: ITEMS, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        // 1本目（遅い）: 古い一覧と unread: 5
        mockUserFetch.mockImplementationOnce(() => new Promise((res) => { releaseSlow = res; }));
        fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 開く（unread 0 なので既読化は走らない）
        fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 閉じる

        // 2本目（速い）: 新着1件
        const fresh = [{ ...ITEMS[0], photoId: "p9" }];
        mockUserFetch.mockResolvedValueOnce(fetchOk({ items: fresh, unread: 1 }));
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

        // ここで1本目が返る
        await act(async () => { releaseSlow(fetchOk({ items: ITEMS, unread: 5 })); });

        expect(screen.getByText("1")).toBeInTheDocument();                 // 新着が消えない
        expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/?photo=p9"]);
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
