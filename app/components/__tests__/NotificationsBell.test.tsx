import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

/**
 * **`lib/utils/api` は4つとも出すこと。**
 *
 * `vi.mock` はモジュールを**丸ごと**差し替えるので、足りない名前は
 * `undefined` になる。フォローバック（`FollowAction` → `useFollow`）が
 * `userPublicFetch` / `readApiError` / `AUTH_REQUIRED_MESSAGE` を読むので、
 * `userFetch` だけを出していた頃の形のままだと**読み込みの時点で落ちる**
 * （62件が全滅した）。
 */
vi.mock("../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    readApiError: async (_res: unknown, fallback: string) => fallback,
    AUTH_REQUIRED_MESSAGE: "認証が必要です",
}));

vi.mock("../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));

/**
 * 通知ベルはログイン中のヘッダーにしか出ない（`HeaderNav` が
 * `isAuthenticated && <NotificationsBell />`）ので、**ログイン済みを模す**。
 * `useAuth` は素で呼ぶと投げる（`AuthProvider` が要る）。
 */
vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, loading: false, userId: "me" }),
}));

/** `useToast` も素で呼ぶと投げる（`ToastProvider` が要る） */
vi.mock("../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

import NotificationsBell from "../NotificationsBell";
import { resetFollowingCache } from "../../../lib/hooks/useFollow";

const ITEMS = [
    { type: "like", photoId: "p1", photoSrc: "https://c/p1_thumb.webp", byName: "旅子", t: "2026-07-10T00:00:00Z" },
    { type: "comment", photoId: "p2", photoSrc: "https://c/p2_thumb.webp", byName: "山田", t: "2026-07-09T00:00:00Z" },
    // 実際には作られない種類。将来わけの分からない通知が
    // 「旅立たせました！」として出ないことを固定する。
    { type: "go", photoId: "p3", photoSrc: "https://c/p3.jpg", byName: "旅人", atLocation: "北海道", t: "2026-07-08T00:00:00Z" },
];

/**
 * 通知の時刻を作る。**その日の正午を基準にする。**
 *
 * 🔴 区分は**暦日**で数えるので（`NotificationsBell` の `calendarDaysAgo`）、
 * `Date.now() - 3 * HOUR` のような相対で作ると**走らせた時刻で区分が変わる**。
 * 実測（2026-09-21）:
 *
 *     TZ=UTC               現地 14:37 → 55件 全緑
 *     TZ=Australia/Brisbane 現地 00:37 → **3件 落ちる**
 *
 * 「3時間前」が前日になるためで、CI は UTC で走るから **JST の朝に流すと
 * この窓に入る**（`Deploy Site` は1回約18分。赤で捨てることになる）。
 *
 * 正午を基準にすれば前後12時間の余裕があり、何時に走らせても
 * 「今日」は今日・「3日前」は3日前のまま。
 */
const dayAt = (daysAgo: number, hour = 12, min = 0): string => {
    const d = new Date();
    d.setHours(hour, min, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
};

function fetchOk(body: unknown) {
    return { ok: true, json: async () => body };
}

/**
 * PC 幅（1024px 以上）を模す。
 *
 * **jsdom は `matchMedia` を持たない**ので、何もしなければ
 * `useWidePanel()` は false ＝**スマホの形（モックのとおりの1画面）**。
 * つまり既定で試されるのはモックに忠実な側で、PC の板を見る回だけ
 * ここを立てる。形は `MiniPlayer.test.tsx` と揃えてある。
 */
function setWide(matches: boolean) {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
    });
}

beforeEach(() => {
    mockUserFetch.mockReset();
    mockUserPublicFetch.mockReset();
    mockShowToast.mockReset();
    // **フォロー中の一覧はモジュール側に溜まる**（`followingCache`）。
    // 消さないと、前のテストで取った一覧が次のテストのフォローバックの
    // 表示（フォロー中／フォローバック）を決めてしまう。
    resetFollowingCache();
    // 毎回スマホの形に戻す（PC を見るテストが次へ漏れない）
    Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: undefined });
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
    //
    // 時刻の作り方は `dayAt`（モジュール先頭）に集約した
    const TODAY = dayAt(0), YESTERDAY = dayAt(1), THREE = dayAt(3);

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

        // **「今日」も「昨日」も見出し側**（行は時刻を出す。見出しと語を
        // 重ねない）。`selector` を書かないと、行の表示を1つも確かめずに緑になる
        expect(await screen.findByText("今日", { selector: "h3" })).toBeInTheDocument();
        expect(screen.getByText("昨日", { selector: "h3" }), "「昨日」の見出しが無い").toBeInTheDocument();
        // 今日と昨日はどちらも正午（`dayAt` の既定）なので 12:00 が2つ出る。
        // **`getByText` だと「複数見つかった」で落ちる**ので数で見る
        expect(screen.getAllByText("12:00"), "今日・昨日の行が時刻を出していない").toHaveLength(2);
        // 2〜7日前は行側（見出しは「今週」）
        expect(screen.getByText("今週", { selector: "h3" })).toBeInTheDocument();
        expect(screen.getByText("3日前")).toBeInTheDocument();
        // **「昨日」と書いた行は作らない**（見出しが言っているので繰り返さない）
        expect(screen.queryByText("昨日", { selector: "p" }), "行が見出しと同じ語を繰り返している").toBeNull();
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
    // **`t` は1回だけ作る**（`json()` のたびに変えると key が変わって行が作り直される）。
    // 相対ではなく `dayAt`（走らせた時刻で区分が変わらない）
    const JUST_NOW = dayAt(0, 13);
    const EARLIER_TODAY = dayAt(0, 12);
    const LAST_WEEK = dayAt(3);

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
    const JUST_NOW = dayAt(0, 13);
    const EARLIER_TODAY = dayAt(0, 12);
    const LAST_WEEK = dayAt(3);

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
    // **外側の覆いは PC の板だけが持つ**（スマホは1画面ぶんのシートなので
    // 「外側」が画面の外）。閉じる口は `closePanel` の1本に集めてあるので、
    // スマホ側は次の it が閉じるボタンで同じことを確かめる。
    it("外側を押して閉じても、次の取り直しで「新着」が消える（PC）", async () => {
        vi.useFakeTimers();
        try {
            setWide(true);
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
        await openWith({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "今日の人", t: dayAt(0, 12, 34) }],
            unread: 0,
        });

        expect(await screen.findByText("12:34")).toBeInTheDocument();
        // 「今日」は見出しに1つだけ（行にも出ていたら2つになる）
        expect(screen.getAllByText("今日")).toHaveLength(1);
    });
});


// レビューで出た回帰3件と、キーボード操作。どれも既存の47件の**すぐ外**で、
// 緑のまま壊れていた形。
describe("「新着」の境界（レビューで出た穴）", () => {
    const heading = (name: string) => screen.queryByRole("heading", { name });
    const bell = () => screen.getByRole("button", { name: "通知" });

    // 🔴 「開いている間は下げない」だけだと、境界を下げられるのは
    // **閉じている間に走った常駐ポーリング**（60秒に1回・裏タブでは走らない）
    // だけになる。開いてすぐ閉じて開き直すと据え置かれたままで、
    // 読み終わった通知が「新着」に出続けていた
    it("閉じてすぐ開き直しても「新着」が消える（ポーリングを挟まない）", async () => {
        vi.useFakeTimers();
        try {
            const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
            const ROW = {
                type: "like", photoId: "p1", photoSrc: "https://c/p1.webp",
                byName: "新着の人", t: new Date(Date.now() - 60_000).toISOString(),
            };
            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 1 }));
            render(<NotificationsBell />);
            await tick();

            fireEvent.click(bell());          // 開く（既読化）
            await tick();
            expect(heading("新着")).toBeInTheDocument();

            // サーバーは既読化を受けたので、以後 unread は 0
            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 0 }));
            fireEvent.click(bell());          // 閉じる（**60秒待たない**）
            fireEvent.click(bell());          // すぐ開き直す
            await tick();

            expect(heading("新着"), "読み終わったのに「新着」が残っている").toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    // 🔴 `unread` は**サーバーが返した並び**での先頭 N 件。`usableRows` は
    // その並びから読めない行を1件ずつ抜くので、抜いたあとの配列で
    // 数えると境界が既読側まで下がる（`64a45d74` の穴の作り直し）
    it("読めない行が落ちても、境界が既読側まで下がらない", async () => {
        vi.useFakeTimers();
        try {
            const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
            const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
            mockUserFetch.mockResolvedValue(fetchOk({
                items: [
                    { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "未読の人", t: at(1) },
                    null,                                   // 読めない行（`usableRows` が落とす）
                    { type: "like", photoId: "p3", photoSrc: "https://c/p3.webp", byName: "既読の人", t: at(30) },
                ],
                // 未読は先頭2件＝「未読の人」と、落ちる `null`
                unread: 2,
            }));
            render(<NotificationsBell />);
            await tick();
            fireEvent.click(bell());
            await tick();

            const New = screen.getByRole("heading", { name: "新着" });
            expect(New.parentElement).toHaveTextContent("未読の人");
            expect(New.parentElement, "既読の行が「新着」に化けている").not.toHaveTextContent("既読の人");
        } finally {
            vi.useRealTimers();
        }
    });

    // 🔴 転がる24時間で数えると、午前1時に見た「昨日の23時」が
    // **「今日」の見出しの下に 23:00 と出る**＝まだ来ていない時刻に見える
    it("日付をまたいだら「今日」に入れない（暦日で数える）", async () => {
        vi.useFakeTimers();
        try {
            const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
            vi.setSystemTime(new Date(2026, 8, 21, 1, 0, 0));        // 9/21 01:00
            const lastNight = new Date(2026, 8, 20, 23, 0, 0);       // 9/20 23:00（2時間前）

            mockUserFetch.mockResolvedValue(fetchOk({
                items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "昨夜の人", t: lastNight.toISOString() }],
                unread: 0,
            }));
            render(<NotificationsBell />);
            await tick();
            fireEvent.click(bell());
            await tick();

            // **これが守っていること**: 午前1時に見たとき、前夜 23:00 の
            // 通知が「今日」の束に入ってはいけない（「今日 23:00」＝まだ
            // 来ていない時刻に見える）。区分を暦日で数えていれば防げる。
            expect(heading("今日"), "昨日の通知が「今日」に入っている").toBeNull();
            expect(heading("昨日"), "「昨日」の区分に入っていない").toBeInTheDocument();
            // 行は時刻を出す。**「昨日」の見出しの下なので 23:00 は正しく読める**
            // ——見出しが暦日を言うので、行がその中の位置を出す形
            // （区分を足す前は、行に「昨日」と書いてこれを避けていた）
            expect(screen.getByText("23:00"), "行が時刻を出していない").toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    // 8日以上前は「45日前」ではなく日付。分岐が1つもテストされていなかった
    it("1週間より前は日付で出す", async () => {
        vi.useFakeTimers();
        try {
            const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
            vi.setSystemTime(new Date(2026, 8, 21, 12, 0, 0));       // 9/21
            const old = new Date(2026, 7, 22, 9, 30, 0);             // 8/22

            mockUserFetch.mockResolvedValue(fetchOk({
                items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "昔の人", t: old.toISOString() }],
                unread: 0,
            }));
            render(<NotificationsBell />);
            await tick();
            fireEvent.click(bell());
            await tick();

            expect(screen.getByRole("heading", { name: "それ以前" })).toBeInTheDocument();
            expect(screen.getByText("8/22")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});

// `role="tab"` を名乗った以上、矢印で動かないと壊れて見える
// （支援技術は「1/4」と読み上げる）
describe("通知のタブ（キーボード）", () => {
    const openMixed = async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [
                { type: "follow", photoId: "", photoSrc: "", byId: "u1", targetUserId: "u1", byName: "フォロ子", t: "2026-09-20T10:00:00Z" },
                { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byId: "u2", byName: "いいね太郎", t: "2026-09-19T10:00:00Z" },
            ],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };
    const tab = (name: string) => screen.getByRole("tab", { name });

    /**
     * **関係ないキーは飲まない。** roving tabindex なので Tab の停止点は
     * 選ばれているタブ1つだけ——ここで `Tab` を飲むと、キーボードだけで
     * 操作する人が通知の一覧へ進めない。
     *
     * `e.preventDefault()` を「移る先が決まったときだけ」撃つ、という条件を
     * 見張るテストが**どこにも無かった**（`preventDefault()` を判定の前に
     * 移す書き換えで全部緑になる）。`fireEvent.keyDown` は
     * `preventDefault()` が呼ばれると `false` を返す。
     */
    it("関係ないキーは飲まない（矢印・Home/End だけ飲む）", async () => {
        await openMixed();
        for (const key of ["Tab", "Enter", " ", "a", "ArrowUp", "ArrowDown"]) {
            expect(fireEvent.keyDown(tab("すべて"), { key }), `${key} を飲んでいる`).toBe(true);
        }
        for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
            expect(fireEvent.keyDown(screen.getAllByRole("tab")[0], { key }),
                `${key} を飲んでいない`).toBe(false);
        }
    });

    it("矢印で隣のタブへ移る（端で回り込む）", async () => {
        await openMixed();
        fireEvent.keyDown(tab("すべて"), { key: "ArrowRight" });
        expect(tab("いいね")).toHaveAttribute("aria-selected", "true");
        // **フォーカスも連れていく。** roving tabindex は「選択中だけが
        // 停止点」なので、選択だけ動かすと**フォーカスが `tabIndex={-1}` に
        // なった要素に残り**、次の Tab が一覧を飛び越す
        expect(tab("いいね"), "選択だけ動いてフォーカスが取り残されている").toHaveFocus();

        fireEvent.keyDown(tab("いいね"), { key: "ArrowLeft" });
        expect(tab("すべて")).toHaveAttribute("aria-selected", "true");
        expect(tab("すべて")).toHaveFocus();

        // 先頭で左 → 末尾へ回り込む
        fireEvent.keyDown(tab("すべて"), { key: "ArrowLeft" });
        expect(tab("フォロー")).toHaveAttribute("aria-selected", "true");
    });

    it("Home / End で端へ飛ぶ", async () => {
        await openMixed();
        fireEvent.keyDown(tab("すべて"), { key: "End" });
        expect(tab("フォロー")).toHaveAttribute("aria-selected", "true");
        expect(tab("フォロー")).toHaveFocus();

        fireEvent.keyDown(tab("フォロー"), { key: "Home" });
        expect(tab("すべて")).toHaveAttribute("aria-selected", "true");
        expect(tab("すべて")).toHaveFocus();
    });

    // roving tabindex: Tab の停止点は選択中の1つだけ
    it("停止点は選択中のタブ1つだけ", async () => {
        await openMixed();
        expect(screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex")))
            .toEqual(["0", "-1", "-1", "-1"]);

        fireEvent.click(tab("コメント"));
        expect(screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex")))
            .toEqual(["-1", "-1", "0", "-1"]);
    });

    // 中にリンクが1つも無いタブでも、キーボードで一覧を送れること
    it("スクロールする枠にキーボードで入れる", async () => {
        await openMixed();
        expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "0");
    });
});


describe("通知パネルを閉じる", () => {
    const bell = () => screen.getByRole("button", { name: "通知" });

    const openPanel = async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: ITEMS, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(bell());
    };

    // タブが4つ増えたぶん、閉じる手段が「ベル／外側」のマウス2つだけなのは辛い
    it("Escape で閉じる", async () => {
        await openPanel();
        expect(screen.getByRole("tabpanel")).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("tabpanel"), "Escape で閉じない").toBeNull();
    });

    // **変換中の Escape は「変換の取り消し」**（`useEscapeKey` が
    // `isImeKey` で見ている）。ここで閉じると打ちかけを巻き込む
    it("変換中の Escape では閉じない", async () => {
        await openPanel();
        fireEvent.keyDown(document, { key: "Escape", keyCode: 229 });
        expect(screen.getByRole("tabpanel"), "変換の取り消しで閉じている").toBeInTheDocument();
    });

    // 閉じているときに拾っていたら、他の画面の Escape を奪う
    it("閉じている間は Escape を拾わない", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: ITEMS, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        const onKey = vi.fn();
        document.addEventListener("keydown", onKey);
        fireEvent.keyDown(document, { key: "Escape" });
        document.removeEventListener("keydown", onKey);
        expect(onKey).toHaveBeenCalled();                 // 届いてはいる
        expect(screen.queryByRole("tabpanel")).toBeNull();
    });

    // 🔴 **閉じた直後に着地した古い GET が「新着」を据え直す。**
    //
    // `closePanel` は境界を捨てるが、**開いていた頃に投げた応答**は
    // まだ飛んでいる。それが `openRef.current === false` の枝に入って
    // `bound` を書き戻すと、次に開いたとき `prev` が非 null なので
    // 「開いている間は下げない」に守られ、**読み終わった通知が永久に
    // 「新着」に出続ける**。開いてすぐ閉じるだけで踏む（回線が細いと普通）。
    it("閉じた後に着地した古い取得が「新着」を据え直さない", async () => {
        const ROW = { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "新着の人", t: dayAt(0, 13) };

        // 最初の取得（閉じている状態）: 未読1件
        mockUserFetch.mockResolvedValueOnce(fetchOk({ items: [ROW], unread: 1 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

        // 開いたときの GET を手元で止めておく（PUT はすぐ返す）
        let release: (v: unknown) => void = () => {};
        mockUserFetch.mockImplementation((_p: string, init?: { method?: string }) =>
            init?.method === "PUT"
                ? Promise.resolve(fetchOk({}))
                : new Promise((res) => { release = res; }));

        fireEvent.click(bell());                          // 開く（GET は宙に浮く）
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/notifications", { method: "PUT" }));
        fireEvent.click(bell());                          // **応答より先に閉じる**

        // ここで、開いていた頃の GET が着地する（サーバーはまだ unread: 1）
        await act(async () => { release(fetchOk({ items: [ROW], unread: 1 })); });

        // 開き直す。以後の取得は既読化後なので unread: 0
        mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 0 }));
        fireEvent.click(bell());
        await waitFor(() => expect(screen.getByRole("tabpanel")).toBeInTheDocument());

        expect(screen.queryByRole("heading", { name: "新着" }),
            "閉じた後に着地した応答が境界を据え直している").toBeNull();
        expect(screen.getByRole("heading", { name: "今日" })).toBeInTheDocument();
    });
});


describe("行の key と見出しの階層", () => {
    const bell = () => screen.getByRole("button", { name: "通知" });

    // 🔴 key に並びの番号（`-${i}`）を混ぜていたので、**先頭に1件挿入されると
    // 以降の行の key が全部ずれ、全部作り直される**。リンクに当たっていた
    // キーボードのフォーカスが `<body>` へ落ち、アバターとサムネの `<img>` が
    // 再マウントして描き直しになる。中身から作れば増えた1件だけが新しい行。
    it("先頭に1件届いても、既にある行は作り直されない", async () => {
        vi.useFakeTimers();
        try {
            const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
            const OLD = { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byId: "u1", byName: "前からの人", t: dayAt(0, 12) };
            const NEW = { type: "like", photoId: "p2", photoSrc: "https://c/p2.webp", byId: "u2", byName: "新しい人", t: dayAt(0, 13) };

            mockUserFetch.mockResolvedValue(fetchOk({ items: [OLD], unread: 0 }));
            render(<NotificationsBell />);
            await tick(0);
            fireEvent.click(bell());
            await tick(0);

            // 開いたまま、この行の DOM ノードを掴んでおく
            const before = screen.getByText(/前からの人/).closest("li");
            expect(before).not.toBeNull();

            // ポーリングで**先頭に**1件届く
            mockUserFetch.mockResolvedValue(fetchOk({ items: [NEW, OLD], unread: 1 }));
            await tick(61_000);

            expect(screen.getByText(/新しい人/), "新着が出ていない").toBeInTheDocument();
            const after = screen.getByText(/前からの人/).closest("li");
            expect(after, "既にある行が作り直されている（key に並びの番号が混ざっている）").toBe(before);
        } finally {
            vi.useRealTimers();
        }
    });

    // 区分の見出しを `h3` にしたので、パネルの題が `span` のままだと階層が飛ぶ
    it("パネルの題は h2、区分は h3（階層が飛ばない）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "今日の人", t: dayAt(0, 12) }],
            unread: 0,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(bell());

        expect(screen.getByRole("heading", { level: 2, name: "通知" }),
            "パネルの題が見出しになっていない").toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 3, name: "今日" })).toBeInTheDocument();
        // h2 を飛ばして h3 から始まっていない
        const levels = screen.getAllByRole("heading").map((h) => Number(h.tagName[1]));
        expect(Math.min(...levels), "見出しが h3 から始まっている（階層が飛ぶ）").toBe(2);
    });
});

// ────────────────────────────────────────────────────────────
// モック 05（通知画面・最終版）に合わせた作り直し（2026-09-22）
// ────────────────────────────────────────────────────────────

describe("1画面ぶんの通知一覧（スマホ）と PC の板", () => {
    const ONE = [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "旅子", t: dayAt(0, 12) }];

    const open = async (body: unknown = { items: ONE, unread: 0 }) => {
        mockUserFetch.mockResolvedValue(fetchOk(body));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    it("スマホでは1画面ぶんのシートになる（モックのとおり）", async () => {
        await open();
        const sheet = screen.getByRole("dialog", { name: "通知" });
        expect(sheet, "全画面のシートになっていない").toBeInTheDocument();
        // **ヘッダーの下から始める**（モックもロゴとベルを残している）。
        // 画面の一番上から覆うと、閉じる手段がシートの中だけになる。
        // 高さは安全領域込みの変数で見る（ホーム画面から起動したときは
        // ヘッダーが時計・電池の帯のぶん高くなる）
        expect(sheet.className).toContain("top-[var(--header-h)]");
        expect(sheet.className).toContain("fixed");
    });

    it("スマホのシートは body へ出す（ヘッダーの backdrop-blur に閉じ込められない）", async () => {
        await open();
        const sheet = screen.getByRole("dialog", { name: "通知" });
        // ベルの隣に置いたままだと、ヘッダーが `position: fixed` の
        // 包含ブロックになるので画面いっぱいにならない
        expect(sheet.parentElement, "シートが body の直下に無い").toBe(document.body);
    });

    it("スマホには閉じるボタンがある（外側が画面の外なので押せない）", async () => {
        await open();
        expect(screen.getByRole("dialog", { name: "通知" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "通知を閉じる" }));
        expect(screen.queryByRole("dialog", { name: "通知" }), "閉じるボタンで閉じない").toBeNull();
    });

    it("PC ではベルから吊る板のまま（全画面にしない・モックを横に伸ばさない）", async () => {
        setWide(true);
        await open();
        // PC は覆いを押して閉じる形なので、モーダルとして名乗らない
        expect(screen.queryByRole("dialog"), "PC まで全画面のシートになっている").toBeNull();
        expect(document.querySelector("div.fixed.inset-0"), "PC の外側の覆いが無い").not.toBeNull();
        // 閉じるボタンは PC には出さない（外側を押せば閉じる）
        expect(screen.queryByRole("button", { name: "通知を閉じる" })).toBeNull();
    });
});

describe("すべて既読にする（モックの注釈⑦）", () => {
    const ROW = { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "旅子", t: dayAt(0, 12) };
    const label = "すべて既読にする";

    it("未読が無いときは出さない（押しても何も起きないボタンを置かない）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
        expect(screen.queryByRole("button", { name: label }),
            "未読が無いのに「すべて既読にする」が出ている").toBeNull();
    });

    it("開けたまま新しい通知が届いたら出る → 押すと既読化を送る", async () => {
        vi.useFakeTimers();
        try {
            const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 0 }));
            render(<NotificationsBell />);
            await tick(0);
            fireEvent.click(screen.getByRole("button", { name: "通知" }));
            await tick(0);
            expect(screen.queryByRole("button", { name: label })).toBeNull();

            // 開けたまま1件届く（60秒ごとのポーリングが持ち帰る）
            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 1 }));
            await tick(61_000);
            const btn = screen.getByRole("button", { name: label });
            expect(btn, "開けたまま届いても「すべて既読にする」が出ない").toBeInTheDocument();

            mockUserFetch.mockClear();
            fireEvent.click(btn);
            await tick(0);
            expect(mockUserFetch, "既読化を送っていない").toHaveBeenCalledWith(
                "/user/notifications", { method: "PUT" },
            );
            expect(screen.queryByRole("button", { name: label }), "押しても消えない").toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("押しても「新着」の見出しは消えない（バッジと見出しは別の値）", async () => {
        vi.useFakeTimers();
        try {
            const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 1 }));
            render(<NotificationsBell />);
            await tick(0);
            fireEvent.click(screen.getByRole("button", { name: "通知" }));   // ここで既読化される
            await tick(0);
            expect(screen.queryByRole("heading", { name: "新着" })).toBeInTheDocument();

            // 開けたままもう1件届いて、「すべて既読にする」を押す
            mockUserFetch.mockResolvedValue(fetchOk({ items: [ROW], unread: 1 }));
            await tick(61_000);
            fireEvent.click(screen.getByRole("button", { name: label }));
            await tick(0);

            // **見出しは `newSince` が決める**ので、既読化では消えない。
            // 消えると「何が新しかったか」が画面から復元できなくなる
            expect(screen.queryByRole("heading", { name: "新着" }),
                "既読化で「新着」の見出しまで消えている").toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("フォローバック（モックの注釈③）", () => {
    const FOLLOW = { type: "follow", photoId: "", photoSrc: "", byName: "Ken", byId: "u-ken", targetUserId: "u-ken", t: dayAt(0, 12) };
    const LIKE = { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "旅子", byId: "u-tabiko", t: dayAt(0, 12) };

    const open = async (items: unknown[]) => {
        mockUserFetch.mockImplementation((url: string) => Promise.resolve(
            url === "/user/following"
                ? fetchOk({ userIds: [] })
                : fetchOk({ items, unread: 0 }),
        ));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    it("フォローの通知にだけ出る", async () => {
        await open([FOLLOW, LIKE]);
        expect(await screen.findByRole("button", { name: /フォローバック/ })).toBeInTheDocument();
        // いいねの通知には出ない（1件だけ）
        expect(screen.getAllByRole("button", { name: /フォローバック/ })).toHaveLength(1);
    });

    it("退会した人には出さない（フォローしに行く先が墓石）", async () => {
        await open([{ ...FOLLOW, deleted: true, byName: "退会したユーザー" }]);
        await waitFor(() => expect(screen.getByText(/さんがあなたをフォローしました/)).toBeInTheDocument());
        expect(screen.queryByRole("button", { name: /フォローバック/ }),
            "退会した人にフォローバックを出している").toBeNull();
    });

    it("行のリンクの外に置く（`<a>` の中に `<button>` を入れない）", async () => {
        await open([FOLLOW]);
        const btn = await screen.findByRole("button", { name: /フォローバック/ });
        expect(btn.closest("a"), "フォローバックが行のリンクの中にある（押すとプロフィールへ飛ぶ）").toBeNull();
    });

    it("何件並んでもフォロー中の一覧は1回しか引かない", async () => {
        const many = Array.from({ length: 5 }, (_, i) => ({ ...FOLLOW, byId: `u-${i}`, targetUserId: `u-${i}`, t: dayAt(0, 12 - i) }));
        await open(many);
        await screen.findAllByRole("button", { name: /フォローバック/ });
        const calls = mockUserFetch.mock.calls.filter(([url]) => url === "/user/following");
        // `fetchFollowingSet` がモジュール側で束ねている（相乗り）
        expect(calls.length, `/user/following が ${calls.length} 回飛んでいる`).toBe(1);
    });

    it("押すとフォローの POST を送る", async () => {
        await open([FOLLOW]);
        const btn = await screen.findByRole("button", { name: /フォローバック/ });
        await waitFor(() => expect(btn).not.toBeDisabled());
        fireEvent.click(btn);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/users/u-ken/follow", { method: "POST" }));
    });
});

describe("1件も無いとき（モックの「空の状態」）", () => {
    const openEmpty = async (body: unknown) => {
        mockUserFetch.mockResolvedValue(body);
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    it("見出しと「写真を投稿する」を出す", async () => {
        await openEmpty(fetchOk({ items: [], unread: 0 }));
        expect(await screen.findByText("まだ通知はありません")).toBeInTheDocument();
        const cta = screen.getByRole("link", { name: "写真を投稿する" });
        // **実在する画面へ送る**（絵だけのボタンは置かない）
        expect(cta.getAttribute("href")).toBe("/user/upload");
    });

    it("読み込めなかったときは「通知が無い」と言い切らない", async () => {
        await openEmpty({ ok: false, json: async () => ({}) });
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
        expect(screen.queryByText("まだ通知はありません"), "失敗を0件として描いている").toBeNull();
        expect(screen.queryByRole("link", { name: "写真を投稿する" }),
            "取れなかったのに投稿を勧めている").toBeNull();
    });
});

describe("モックに在るが、作る側がコードに無いもの（出さない）", () => {
    // owner の指示書 2026-09-22「架空のデータを出さない」。
    // サーバーが作る通知は `api-user/src/notify.ts` の4種類
    //（like / comment / follow / storyreply）だけ。
    //
    // **1つの it にまとめてある。** ここは「存在したことのない文字列が
    // 出ていない」ことの確認なので、**どの版の実装でも通る**
    // ——回帰試験ではなく、足し戻したときに落ちる番人。
    // 描画は1回で足りるのに it を5本に割ると、フォロー一覧の取得待ちが
    // 5回ぶん CI に乗る（`CLAUDE.md`「テストが約10分を占める」）。
    const ROWS = [
        { type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "旅子", byId: "u1", t: dayAt(0, 12) },
        { type: "follow", photoId: "", photoSrc: "", byName: "Ken", byId: "u2", targetUserId: "u2", t: dayAt(0, 11) },
    ];

    it("お知らせ／アクティビティのタブ・保存／メンション・運営通知・フォローリクエスト・個別削除を出さない", async () => {
        mockUserFetch.mockImplementation((url: string) => Promise.resolve(
            url === "/user/following" ? fetchOk({ userIds: [] }) : fetchOk({ items: ROWS, unread: 0 }),
        ));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        // 運営からのお知らせを**書き込む経路がどこにも無い**ので、タブを置くと
        // 必ず空になる。お知らせが無い以上「アクティビティ」は「すべて」と
        // 同じ中身になるので、これも置かない
        expect(screen.getAllByRole("tab").map((t) => t.textContent))
            .toEqual(["すべて", "いいね", "コメント", "フォロー"]);
        // その種別が無い（like / comment / follow / storyreply の4つだけ）
        expect(screen.queryByText(/保存しました/)).toBeNull();
        expect(screen.queryByText(/メンションしました/)).toBeNull();
        expect(screen.queryByText(/運営からのお知らせ/)).toBeNull();
        // フォローは即時（承認を待つ仕組みが `follow.ts` に無い）
        expect(screen.queryByText(/フォローリクエスト/)).toBeNull();
        expect(screen.queryByRole("button", { name: "承認" })).toBeNull();
        // 通知の口は `GET` と `PUT`（全部既読）の2つだけ。1件消す・隠す API は無い
        expect(screen.queryByRole("button", { name: /削除/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /非表示/ })).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────
// レビューで出た回帰と抜け（2026-09-22）
// ────────────────────────────────────────────────────────────

describe("「新着」の下では、行が暦日の語を落とさない（レビューで出た回帰）", () => {
    it("未読の昨日の行は「昨日」と出す（見出しが暦日を言わないため）", async () => {
        // 🔴 `days <= 1` で時刻に倒していたときの実測:
        //       見出し ['新着'] / 行 '9:00' '23:00'
        //    新しい順なのに時刻が上がるので、**2行目が「今日の23時」＝
        //    まだ来ていない時刻**に読めた（`calendarDaysAgo` の doc が
        //    禁じている形を、区分を足した側が別経路で作っていた）
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [
                { type: "like", photoId: "p1", photoSrc: "https://c/a.webp", byName: "今朝の人", t: dayAt(0, 9) },
                { type: "like", photoId: "p2", photoSrc: "https://c/b.webp", byName: "昨夜の人", t: dayAt(1, 23) },
            ],
            unread: 2,
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        // 2件とも未読＝「新着」に吸い上げられる（暦日の見出しが出ない）
        expect(await screen.findByRole("heading", { name: "新着" })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "昨日" }),
            "この筋では「昨日」の見出しは出ない（未読が先に「新着」へ入る）").toBeNull();
        // だから**行が**暦日を言う
        expect(screen.getByText("昨日"), "「新着」の下なのに行が時刻だけになっている").toBeInTheDocument();
        expect(screen.queryByText("23:00"), "日付の手がかりが無い時刻を出している").toBeNull();
        // 今日ぶんは時刻のまま（「新着」でも今日なら未来には読めない）
        expect(screen.getByText("9:00")).toBeInTheDocument();
    });

    it("「昨日」の見出しの下では、行は時刻（見出しと同じ語を繰り返さない）", async () => {
        mockUserFetch.mockResolvedValue(fetchOk({
            items: [{ type: "like", photoId: "p2", photoSrc: "https://c/b.webp", byName: "昨夜の人", t: dayAt(1, 23) }],
            unread: 0,   // 既読なので「新着」に入らず、暦日の区分に落ちる
        }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));

        expect(await screen.findByRole("heading", { name: "昨日" })).toBeInTheDocument();
        expect(screen.getByText("23:00")).toBeInTheDocument();
        expect(screen.queryByText("昨日", { selector: "p" }), "行が見出しと同じ語を繰り返している").toBeNull();
    });
});

describe("全画面のシートは裏のページを止める", () => {
    const ONE = [{ type: "like", photoId: "p1", photoSrc: "https://c/p1.webp", byName: "旅子", t: dayAt(0, 12) }];

    const open = async () => {
        mockUserFetch.mockResolvedValue(fetchOk({ items: ONE, unread: 0 }));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    it("スマホ: 開いている間は body を固定し、閉じたら戻す", async () => {
        // 画面を覆う `aria-modal` は既存5か所とも掛けている
        //（`HeaderNav`・`FollowingSheet`・`DeleteConfirmModal`・
        //  `DeleteAccountModal`・`PostSheet`）。掛けないと一覧の端で
        // 裏のページが動く（スクロール連鎖）
        await open();
        expect(document.body.style.overflow, "裏のページが止まっていない").toBe("hidden");
        fireEvent.click(screen.getByRole("button", { name: "通知を閉じる" }));
        expect(document.body.style.overflow, "閉じたのに固定が残っている").not.toBe("hidden");
    });

    it("PC: 板は画面を覆わないので固定しない", async () => {
        setWide(true);
        await open();
        expect(document.body.style.overflow, "板なのにページを固定している").not.toBe("hidden");
    });
});

describe("フォローバックの安全と読み上げ", () => {
    const FOLLOW = { type: "follow", photoId: "", photoSrc: "", byName: "Ken", byId: "u-ken", targetUserId: "u-ken", t: dayAt(0, 12) };

    const open = async (followingIds: string[]) => {
        mockUserFetch.mockImplementation((url: string) => Promise.resolve(
            url === "/user/following" ? fetchOk({ userIds: followingIds }) : fetchOk({ items: [FOLLOW], unread: 0 }),
        ));
        render(<NotificationsBell />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "通知" }));
    };

    it("誰をフォローバックするのかを読み上げに出す", async () => {
        await open([]);
        expect(await screen.findByRole("button", { name: "Ken さんをフォローバック" })).toBeInTheDocument();
    });

    it("既に返している相手には出さない（誤タップで無確認に解除させない）", async () => {
        await open(["u-ken"]);
        // 行そのものは出る
        await waitFor(() => expect(screen.getByText(/さんがあなたをフォローしました/)).toBeInTheDocument());
        // 「フォロー中」＝押すと解除、が密に並ぶ行の中に残らないこと
        expect(screen.queryByRole("button", { name: /フォローバック/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /フォロー中/ }),
            "返し終わった行に解除ボタンが残っている").toBeNull();
    });
});
