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
        // **実際に届く種類だけを案内する。** 以前ここは「行きたいリスト追加」
        // 「旅立ちの報告」という**存在しない機能**を案内していた。
        // 種類を足したらこの文にも足す（ストーリーへの返信を追加）
        expect(screen.getByText(/いいね・コメント・ストーリーへの返信・フォローがここに届きます/)).toBeInTheDocument();
    });
});

// **空表示の文言が、存在しない機能を2つ案内していた。**
//
// 通知を作る側は `likes.ts` / `comments.ts` / `follow.ts` の3つだけで
// （`notify.ts` の型も `like | comment | follow`）、「行きたいリスト」も
// 「旅立ちの報告」も作る経路がコードに無い。型のコメントにはそう書いて
// あるのに、コンポーネント冒頭のコメントと空表示の本文だけが古いまま
// 残っていた。**登録直後の人が最初に読む文**なので実害が大きい。
// **時刻を読むテストが1本も無かった。** フィクスチャの時刻キーが
// `createdAt`（実装が読むのは `t`）でも、`{fmtTime(n.t)}` を丸ごと消しても、
// 24件が全緑だった。日付は「いつのいいねか」を伝える唯一の手がかり。
describe("通知の時刻", () => {
    // **`t` は1回だけ作る。** `li` の key が `n.t` を含むので、`json()` が
    // 呼ばれるたびに違う値を返すと行ごと作り直される
    const DAY = 24 * 60 * 60 * 1000;
    const AT = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY - 60_000).toISOString();
    const TODAY = AT(0), YESTERDAY = AT(1), THREE = AT(3);

    it("今日・昨日・N日前で出し分ける", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [
                { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "今日の人", t: TODAY },
                { type: "like", photoId: "p2", photoSrc: "https://c/p2.webp", byName: "昨日の人", t: YESTERDAY },
                { type: "like", photoId: "p3", photoSrc: "https://c/p3.webp", byName: "3日前の人", t: THREE },
            ],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        expect(await screen.findByText("今日")).toBeInTheDocument();
        expect(screen.getByText("昨日")).toBeInTheDocument();
        expect(screen.getByText("3日前")).toBeInTheDocument();
    });

    // 読めない時刻で「NaN日前」を出さない（空にする）
    it("読めない時刻は何も出さない", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "旅子", t: "こわれた日付" }],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        expect(await screen.findByText(/旅子/)).toBeInTheDocument();
        expect(screen.queryByText(/NaN|Invalid/)).toBeNull();
    });
});

describe("通知が0件のときの案内", () => {
    const open = async (body: unknown) => {
        mockUserFetch.mockResolvedValue(fetchOk(body));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    it("存在しない機能の名前を出さない", async () => {
        await open({ items: [], unread: 0 });
        const text = screen.getByText(/ここに届きます/).textContent ?? "";
        expect(text, "作る側の無い『行きたいリスト』を案内している").not.toMatch(/行きたい/);
        expect(text, "作る側の無い『旅立ち』を案内している").not.toMatch(/旅立/);
    });

    it("実際に届く3種類を案内する", async () => {
        await open({ items: [], unread: 0 });
        const text = screen.getByText(/ここに届きます/).textContent ?? "";
        for (const kind of ["いいね", "コメント", "フォロー"]) {
            expect(text, `${kind} の通知は実在するのに案内していない`).toMatch(kind);
        }
    });
});

// **取得に失敗しても「0件」と同じ画面だった。**
// 届いている通知が無いように見える（`if (!res.ok) return;` と
// 握りつぶしの catch）。`useComments`・下書き一覧・StoriesBar は
// どれもこの区別を持っていて、ベルだけ取り残されていた。
describe("通知の取得に失敗したとき", () => {
    it("「0件」の案内を出さない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        expect(screen.queryByText(/ここに届きます/), "失敗を「0件」と言っている").toBeNull();
        expect(screen.getByText(/読み込めませんでした/)).toBeInTheDocument();
    });

    // **200 だが本文の形がおかしい場合も同じ。** 行のふるいを足したとき
    // `?? []` にしたので「まだ通知はありません」の案内が出ていた
    // ——このファイルの `status` のコメントが禁じているとおりの状態
    it.each([
        ["items が配列でない", { items: { a: 1 } }],
        ["items が無い", { unread: 3 }],
    ])("%s でも「0件」の案内を出さない", async (_name, body) => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => body });
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        expect(screen.queryByText(/ここに届きます/), "失敗を「0件」と言っている").toBeNull();
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
    });

    // 読めない行が混じっても、残りは出す（失敗にはしない）
    it("読めない行は落として、残りは出す", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            // 時刻は `t`（`createdAt` ではない）。このファイルの他の
            // フィクスチャと同じ形にする——キーが `n.t` を含むので、
            // 呼ぶたびに変わる値（`Date.now()`）を入れると再取得のたびに
            // 行ごと作り直され、掴んだ要素が文書から外れる
            json: async () => ({ items: [{ type: "like", photoId: "p9", photoSrc: "https://c/p9_thumb.webp", byName: "たびこ", t: "2026-09-01T00:00:00Z" }, null] }),
        });
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(await screen.findByText(/たびこ/)).toBeInTheDocument();
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
    });

    it("通信が落ちたときも同じ", async () => {
        mockUserFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.queryByText(/ここに届きます/)).toBeNull();
    });

    // 開いた直後（まだ返ってきていない）も「0件」ではない
    it("まだ返ってきていないうちは「0件」と言わない", async () => {
        mockUserFetch.mockReturnValue(new Promise(() => { }));
        render(<NotificationsBell />);
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.queryByText(/ここに届きます/), "届く前に「0件」と言っている").toBeNull();
    });
});

// このベルはヘッダーに常駐する。取得が `[]` deps の1回きりだった頃は、
// **リロードするまで新着が出なかった**——いいねもコメントもフォローも
// ここに届くのに、開いても前に読み込んだ内容のままだった。
// **退会した人の名前と導線が残っていた。**
//
// 通知には作られた時点の表示名と ID が焼き込まれ、退会が消すのは
// 自分宛ての通知だけ。サーバー（notifications.ts）は退会した人の
// `byName` を伏せて `deleted: true` を立てるようになったが、画面は
// それを読まず、**墓石になったプロフィールへのリンクを出し続けていた**
// ——開いても何も無いページに誘うことになる。コメント欄
// （CommentSection）は先に同じ扱いにしてある。
// **空の `src` の `<img>` を出していた。**
// 右端のサムネには `n.photoSrc &&` のガードがあるのに、左のアイコンの
// 分岐（`byId` も `targetUserId` も無い古い通知）には無かった。
// Chromium ではページを取り直さないが（実測）、灰色の四角が黙って残る。
describe("写真も送り主も分からない通知", () => {
    it("空の src を持つ img を出さない", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p1", photoSrc: "", byName: "旅子", t: "2026-07-10T00:00:00Z" }],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        expect(await screen.findByText(/旅子/)).toBeInTheDocument();
        const empty = Array.from(document.body.querySelectorAll("img"))
            .filter((el) => !el.getAttribute("src"));
        expect(empty, "src の空な img を出している").toHaveLength(0);
        // **代わりに人型アイコンを出す。** ここを見ないと、左のアイコンごと
        // 消す実装（フォールバック `null`）でも緑のままだった（レビュー指摘）。
        // `svg` があることだけを見るのも駄目——本文にハートのアイコンが
        // 入っているので、アイコンごと消しても当たってしまう（実測）。
        // `UserAvatar` が出す丸い枠（`rounded-full`）で見分ける
        const row = screen.getByText(/旅子/).closest("li");
        expect(row?.querySelector("div.rounded-full svg"), "左のアイコンごと消えている").not.toBeNull();
    });

    // **右端のサムネ側のガードも無検証だった**（`n.photoSrc &&` を外しても
    // 全件緑）。今回それを「既にガードがある側」として手本にしたので、
    // 手本の方も固定しておく
    it("送り主が分かる通知でも、写真が無ければ img を出さない", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p1", photoSrc: "", byId: "u9", byName: "旅子", t: "2026-07-10T00:00:00Z" }],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        await screen.findByText(/旅子/);
        expect(Array.from(document.body.querySelectorAll("img")).filter((el) => !el.getAttribute("src")),
            "src の空な img を出している").toHaveLength(0);
    });

    // 正常系: 写真があるときは今までどおりその写真を出す
    it("写真があるときは出す", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1_thumb.webp", byName: "旅子", t: "2026-07-10T00:00:00Z" }],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        await screen.findByText(/旅子/);
        expect(Array.from(document.body.querySelectorAll("img"))
            .some((el) => el.getAttribute("src") === "https://c/p1_thumb.webp")).toBe(true);
    });
});

describe("退会した人からの通知", () => {
    const GONE = [
        {
            type: "like", photoId: "p1", photoSrc: "https://c/p1.webp",
            byId: "gone-sub", byName: "退会したユーザー", deleted: true, t: "2026-07-10T00:00:00Z",
        },
        {
            type: "follow", photoId: "", photoSrc: "",
            byId: "gone-sub", targetUserId: "gone-sub",
            byName: "退会したユーザー", deleted: true, t: "2026-07-09T00:00:00Z",
        },
    ];

    const hrefs = () => screen.queryAllByRole("link").map((a) => a.getAttribute("href"));

    // 真偽値そのものでない値（サーバーは今 boolean しか書かないが、
    // 経路が増えたときに片側だけ効く形にしない）でも伏せる側に倒す
    it.each([
        ["true", true],
        ["真値の文字列", "1"],
    ])("プロフィールへのリンクを出さない（deleted が %s）", async (_label, flag) => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: GONE.map((n) => ({ ...n, deleted: flag })), unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(hrefs().filter((h) => h?.includes("gone-sub")),
            "墓石になったプロフィールへ誘っている").toEqual([]);
    });

    it("名前は出すが、導線だけ出さない", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: GONE, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        // 名前（サーバーが伏せた文言）は出る。導線だけ出さない
        expect(screen.getAllByText("退会したユーザー").length).toBeGreaterThan(0);
        expect(hrefs().filter((h) => h?.includes("gone-sub")),
            "墓石になったプロフィールへ誘っている").toEqual([]);
    });

    it("写真への導線は残す（写真は消えていない）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: GONE, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        // いいねの通知はその写真へ飛べる。フォローの通知は飛び先が無い
        expect(hrefs()).toEqual(["/?photo=p1"]);
    });

    // 生きている人の導線まで消さない（逆向きの失敗）。
    // `deleted: false` と**キーそのものが無い**古い応答の両方を見る
    // ——サーバーは伏せる項目にしか立てないので、通常の通知にはキーが無い。
    it.each([
        ["deleted: false", { deleted: false }],
        ["キーが無い（通常の通知）", {}],
    ])("退会していない人のリンクはそのまま（%s）", async (_label, extra) => {
        const base = { ...GONE[0] } as Record<string, unknown>;
        delete base.deleted;   // 古い応答＝キーそのものが無い
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ ...base, ...extra, byId: "live-sub", byName: "旅子" }],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(hrefs()).toEqual(["/users?id=live-sub", "/?photo=p1"]);
    });
});

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


// **種類を足したら、ここにも足さないと「届いているのに何も出ない」通知になる。**
// このコンポーネントは知らない種類を（既定の文言に落とさず）**何も出さない**
// ので、サーバー側だけ足しても画面には空の行が並ぶ。
describe("ストーリーへの返信の通知", () => {
    const reply = {
        type: "storyreply", photoId: "story-1", photoSrc: "https://c/s1.jpg",
        byName: "友人", byId: "u2", t: "2026-07-10T00:00:00Z",
    };

    it("文面を出す", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: [reply], unread: 1 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.getByText(/さんがあなたのストーリーに返信しました/)).toBeInTheDocument();
    });

    // **ストーリーに個別ページは無い。** `/photo/story-…` は静的書き出しに
    // 存在しないので、リンクにすると 404 へ送ることになる
    it("写真ページへのリンクにしない（404 へ送らない）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: [reply], unread: 1 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
        expect(hrefs.some((h) => String(h).includes("story-1")), "存在しない写真ページへ送っている").toBe(false);
    });

    // 空のときの案内に入れる（登録直後の人が最初に読む文）
    it("0件の案内に返信も書いてある", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: [], unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.getByText(/ストーリーへの返信/)).toBeInTheDocument();
    });
});


// ⑩ 通知にタブ（owner の新デザイン・2026-09-21）。
//
// **別画面（`/notifications`）にしない判断**もここで固定する——一覧は
// `NOTIFS_MAX = 50` で頭打ちなのでページ送りが要らず、画面を足すと
// 通知を読む導線が2つになる。だから「タブが在ること」はこのベルのテスト。
describe("通知のタブ", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    // **`t` は1回だけ作る**（`json()` のたびに変えると key が変わって行が作り直される）
    const JUST_NOW = new Date(Date.now() - 60_000).toISOString();
    const EARLIER_TODAY = new Date(Date.now() - 3 * HOUR).toISOString();
    const LAST_WEEK = new Date(Date.now() - 3 * DAY).toISOString();

    const MIXED = [
        { type: "follow", photoId: "", photoSrc: "", byId: "u1", targetUserId: "u1", byName: "フォロ子", t: JUST_NOW },
        { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byId: "u2", byName: "いいね太郎", t: EARLIER_TODAY },
        { type: "comment", photoId: "p2", photoSrc: "https://c/p2.webp", byId: "u3", byName: "コメ美", t: LAST_WEEK },
        { type: "storyreply", photoId: "s1", photoSrc: "https://c/s1.webp", byId: "u4", byName: "返信丸", t: LAST_WEEK },
    ];

    const openWith = async (body: unknown) => {
        mockUserFetch.mockResolvedValue(fetchOk(body));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    const tab = (name: string) => screen.getByRole("tab", { name });

    it("すべて・いいね・コメント・フォローの4つを出す", async () => {
        await openWith({ items: MIXED, unread: 0 });
        expect(screen.getAllByRole("tab").map((t) => t.textContent))
            .toEqual(["すべて", "いいね", "コメント", "フォロー"]);
    });

    it("絞ると、その種別だけになる", async () => {
        await openWith({ items: MIXED, unread: 0 });
        fireEvent.click(tab("いいね"));

        expect(screen.getByText(/いいね太郎/)).toBeInTheDocument();
        expect(screen.queryByText(/コメ美/), "コメントが残っている").toBeNull();
        expect(screen.queryByText(/フォロ子/), "フォローが残っている").toBeNull();
    });

    // 🔴 **種別は4つ、タブは3つ。** `type === tab` で素直に絞ると、
    // ストーリーへの返信が「すべて」以外のどこにも出なくなる
    it("ストーリーへの返信は「コメント」のタブに出る（どこからも消えない）", async () => {
        await openWith({ items: MIXED, unread: 0 });
        fireEvent.click(tab("コメント"));

        expect(screen.getByText(/返信丸/), "返信がどのタブからも消えている").toBeInTheDocument();
        expect(screen.getByText(/コメ美/)).toBeInTheDocument();
        expect(screen.queryByText(/いいね太郎/)).toBeNull();
    });

    it("選んでいるタブだけ aria-selected が立つ", async () => {
        await openWith({ items: MIXED, unread: 0 });
        expect(tab("すべて")).toHaveAttribute("aria-selected", "true");

        fireEvent.click(tab("フォロー"));
        expect(tab("フォロー")).toHaveAttribute("aria-selected", "true");
        expect(tab("すべて")).toHaveAttribute("aria-selected", "false");
    });

    // 押しても何も変わらない操作を4つ並べない（下の案内もタブの奥に隠れる）
    it("1件も無いときはタブを出さない", async () => {
        await openWith({ items: [], unread: 0 });
        expect(screen.queryAllByRole("tab")).toEqual([]);
    });

    it("そのタブだけ空のときは、0件の案内と別の文を出す", async () => {
        await openWith({ items: [MIXED[1]], unread: 0 });   // いいね1件だけ
        fireEvent.click(tab("フォロー"));

        expect(screen.getByText(/このタブに届いた通知はまだありません/)).toBeInTheDocument();
        expect(screen.queryByText(/ここに届きます/), "0件の案内に化けている").toBeNull();
    });

    // 絞ったまま閉じると、次に届いた別の種別が**バッジには出るのに
    // 開いても見えない**
    it("開き直すと「すべて」に戻る", async () => {
        await openWith({ items: MIXED, unread: 0 });
        fireEvent.click(tab("フォロー"));
        expect(screen.queryByText(/いいね太郎/)).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 閉じる
        fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 開き直す
        expect(await screen.findByText(/いいね太郎/)).toBeInTheDocument();
    });
});

describe("通知の見出し（新着・今日・今週）", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    const JUST_NOW = new Date(Date.now() - 60_000).toISOString();
    const EARLIER_TODAY = new Date(Date.now() - 3 * HOUR).toISOString();
    const LAST_WEEK = new Date(Date.now() - 3 * DAY).toISOString();

    const heading = (name: string) => screen.queryByRole("heading", { name });

    const openWith = async (body: unknown) => {
        mockUserFetch.mockResolvedValue(fetchOk(body));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    it("未読のぶんが「新着」、残りが時間の区分に入る", async () => {
        await openWith({
            items: [
                { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "新着の人", t: JUST_NOW },
                { type: "like", photoId: "p2", photoSrc: "https://c/p2.webp", byName: "今日の人", t: EARLIER_TODAY },
                { type: "like", photoId: "p3", photoSrc: "https://c/p3.webp", byName: "今週の人", t: LAST_WEEK },
            ],
            unread: 1,
        });

        expect(await screen.findByRole("heading", { name: "新着" })).toBeInTheDocument();
        expect(heading("今日")).toBeInTheDocument();
        expect(heading("今週")).toBeInTheDocument();
    });

    // 🔴 **未読は「先頭 N 件」＝位置の意味を持つ数**（`64a45d74`）。
    // 絞ったあとの並びに番号で当てると、いいねのタブでは
    // **既に読んだいいねが「新着」に化ける**。境界は絞る前の全件から
    // 取った時刻なので、タブを変えても中身が動かない
    it("タブで絞っても「新着」が増えない（位置ではなく時刻で決める）", async () => {
        await openWith({
            items: [
                { type: "follow", photoId: "", photoSrc: "", byId: "u1", targetUserId: "u1", byName: "フォロ子", t: JUST_NOW },
                { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byId: "u2", byName: "いいね太郎", t: EARLIER_TODAY },
            ],
            unread: 1,   // 新しいのはフォローの1件だけ
        });
        expect(await screen.findByRole("heading", { name: "新着" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("tab", { name: "いいね" }));
        expect(screen.getByText(/いいね太郎/)).toBeInTheDocument();
        expect(heading("新着"), "既に読んだいいねが「新着」に化けている").toBeNull();
        expect(heading("今日")).toBeInTheDocument();
    });

    // 開くと既読化するのでバッジは消えるが、**見出しまで消すと
    // 何が新しかったのか分からなくなる**
    it("開いてもその場では「新着」が消えない（バッジだけ消える）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "新着の人", t: JUST_NOW }],
            unread: 1,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

        // 既読化の後にサーバーが返す形（unread が 0 に落ちている）
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "新着の人", t: JUST_NOW }],
            unread: 0,
        }));
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        expect(await screen.findByRole("heading", { name: "新着" })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText("1"), "バッジが残っている").toBeNull());
    });

    it("閉じてから取り直すと「新着」が消える（次に開いたときは新着なし）", async () => {
        vi.useFakeTimers();
        try {
            const ROW = { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "新着の人", t: JUST_NOW };
            // 取得は非同期なので、時計を進めるたびに act で括る
            // （括らないと state の反映前に読みに行って、前の描画を見る）
            const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 1 }));
            render(<NotificationsBell />);
            await tick(0);

            fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 開く（既読化）
            await tick(0);
            expect(heading("新着")).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 閉じる
            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 0 }));
            await tick(61_000);                                              // 常駐ぶんの取り直し

            fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 開き直す
            await tick(0);
            expect(heading("新着"), "読み終わったのに「新着」が残っている").toBeNull();
            expect(heading("今日")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    // 🔴 閉じる口は**3つ**ある（ベル・外側の覆い・通知のリンク）。
    // 「開いている間は境界を下げない」を片方の口でしか下ろしていないと、
    // **外側を押して閉じた人は境界が二度と下がらず**、読み終わった通知が
    // 延々「新着」に出続ける
    it("外側を押して閉じても、次の取り直しで「新着」が消える", async () => {
        vi.useFakeTimers();
        try {
            const ROW = { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "新着の人", t: JUST_NOW };
            const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 1 }));
            render(<NotificationsBell />);
            await tick(0);

            fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 開く
            await tick(0);
            expect(heading("新着")).toBeInTheDocument();

            // ベルではなく**外側の覆い**を押して閉じる
            const veil = document.querySelector("div.fixed.inset-0");
            expect(veil, "外側の覆いが無い").not.toBeNull();
            fireEvent.click(veil as Element);

            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 0 }));
            await tick(61_000);

            fireEvent.click(screen.getByRole("button", { name: "通知" }));   // 開き直す
            await tick(0);
            expect(heading("新着"), "外側で閉じたぶんだけ境界が下がっていない").toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    // 壊れた行が毎回「新着」として一番上に居座らない
    it("読めない時刻は「それ以前」に落とす", async () => {
        await openWith({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "壊れた人", t: "こわれた日付" }],
            unread: 1,
        });

        expect(await screen.findByRole("heading", { name: "それ以前" })).toBeInTheDocument();
        expect(heading("新着"), "読めない時刻が「新着」に居座っている").toBeNull();
    });

    // 🔴 未読の中に1件でも読めない時刻が混ざると、境界を1件だけ見る作りでは
    // **「新着」の見出しが丸ごと消えていた**（未読の残りまで巻き添え）。
    // 先頭 N 件のうち**読める時刻の最小**を探せば、壊れた行だけが落ちる
    it("未読に壊れた時刻が混ざっても、残りの未読は「新着」に残る", async () => {
        await openWith({
            // **並びが効く。** サーバーは新しい順に返すので、壊れた行は
            // **いちばん古い未読＝境界に使われる1件**の位置に置く。
            // 逆の並びだと `rows[head-1]` が読める行になってしまい、
            // 「1件だけ見る」実装と「最小を探す」実装が同じ答えを出す
            // ＝この穴を塞いだことを何も確かめていないテストになる（実測）
            items: [
                { type: "like", photoId: "p2", photoSrc: "https://c/p2.webp", byName: "新着の人", t: JUST_NOW },
                { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "壊れた人", t: "こわれた日付" },
            ],
            unread: 2,   // どちらも未読
        });

        const New = await screen.findByRole("heading", { name: "新着" });
        // 壊れた行だけが末尾へ落ち、読める未読は「新着」の下に残る
        expect(New.parentElement).toHaveTextContent("新着の人");
        expect(New.parentElement, "壊れた行が「新着」に混ざっている").not.toHaveTextContent("壊れた人");
        expect(heading("それ以前")?.parentElement).toHaveTextContent("壊れた人");
    });

    // 見出しが日付の粗い位置を持つので、行が「今日」と繰り返さない
    it("今日の行は時刻を出す（見出しと同じ語を繰り返さない）", async () => {
        const at = new Date(Date.now() - 3 * HOUR);
        await openWith({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "今日の人", t: at.toISOString() }],
            unread: 0,
        });

        const clock = `${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`;
        expect(await screen.findByText(clock)).toBeInTheDocument();
        // 「今日」は見出しに1つだけ（行にも出ていたら2つになる）
        expect(screen.getAllByText("今日")).toHaveLength(1);
    });
});
