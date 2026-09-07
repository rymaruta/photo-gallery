import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **消された写真の共有リンクを踏んだとき、何も言わずにトップが出ていた。**
//
// `/photo/<id>` は静的ページが無ければ 404 →`/?photo=<id>` に振り替わる
// （まだビルドされていない新着写真のための救済）。写真が本当に無い場合も
// 同じ経路を通るが、`openById` が false を返したあと**何もしていなかった**
// ので、`?photo=` だけが静かに外れて普通のギャラリーが出る。踏んだ人には
// 「リンクが壊れている」ではなく「トップに飛ばされた」と見える。
//
// 一方で「一覧に無い＝存在しない」ではない。`openById` が探すのは
// **絞り込んだあと**の一覧なので、フィルターで外れているだけの写真まで
// 「見つかりません」と言ってはいけない。

const mockShowToast = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => ({ current: "" }));
const auth = vi.hoisted(() => ({ current: { isAuthenticated: false, userId: null as string | null, loading: false } }));

vi.mock("../auth/context", () => ({ useAuth: () => auth.current }));
vi.mock("../../lib/hooks/useFollow", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    fetchFollowingSet: async () => new Set<string>(),
}));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
// `?photo=` は本来 SearchParamWatcher が親へ渡す。ここではその値を直接注ぐ。
// **本物と同じく「値が変わったら知らせる」形にする**（`[value, onChange]`）。
// deps を `[onChange]` だけにしていたとき、`onChange` が安定な参照なので
// 再描画しても知らせが飛ばず、「戻る」を模せなかった。
// 名前を大文字で始めるのは、中でフックを使う（React のコンポーネント）ため
vi.mock("../components/SearchParamWatcher", () => ({
    default: function MockSearchParamWatcher({ onChange }: { onChange: (v: string | null) => void }) {
        const value = searchParams.current || null;
        React.useEffect(() => { onChange(value); }, [value, onChange]);
        return null;
    },
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "food", tags: [], date: "2026-01-02", createdAt: "2026-01-02" },
];
/** API の一覧が届く前かどうか。届く前は静的JSON（＝ここでは PHOTOS）だけ */
const photosState = vi.hoisted(() => ({ extra: [] as Array<Record<string, unknown>>, loaded: true }));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ photos: [...PHOTOS, ...photosState.extra], loaded: photosState.loaded }),
}));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    searchParams.current = "";
    auth.current = { isAuthenticated: false, userId: null, loading: false };
    photosState.extra = [];
    photosState.loaded = true;
    window.history.replaceState({}, "", "/");
});

describe("開けない ?photo= を踏んだとき", () => {
    it("元の一覧にも無ければ、見つからないと伝える", async () => {
        searchParams.current = "deleted-id";
        render(<GalleryPageClient />);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("見つかりませんでした"), "error"));
    });

    // **同じ URL のまま2回言わない。** 効果の deps には絞り込んだ一覧が
    // 入っているので、フィルターを触るたびに再実行される。覚えていないと
    // そのたびに赤いトーストが出る
    it("同じ URL のまま、フィルターを触っても2回は言わない", async () => {
        auth.current = { isAuthenticated: true, userId: "me", loading: false };
        searchParams.current = "deleted-id";
        render(<GalleryPageClient />);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));

        // 効果を再実行させる。**フィード切替そのものが効いているのではない**
        // （切り替えると一覧が空になり、手前の早期 return に当たる）。
        // 効いているのはフォロー集合が届いて絞り込みが作り直される方
        fireEvent.click(screen.getByRole("button", { name: "フォロー中" }));
        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast, "同じ写真について2回言っている").toHaveBeenCalledTimes(1);
    });

    // **絞り込みで外れているだけなら黙る。** ここで「見つかりません」と
    // 出すと、実際には在る写真について嘘をつくことになる
    // **守っている性質は「在る写真について嘘をつかない」。**
    // 以前はここで何も言わずに黙っていたが、黙る＝通知をタップしても
    // 何も起きない、だった（下の describe を見よ）。今は絞り込みを外して
    // 開く。**「見つかりません」と言わない**ことは変わらない。
    it("フィルターで外れているだけなら「見つかりません」と言わない", async () => {
        window.history.replaceState({}, "", "/?category=travel");
        searchParams.current = "p2";   // category=food なので絞り込みから外れる
        render(<GalleryPageClient />);

        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast.mock.calls.map((c) => String(c[0])),
            "在る写真について「見つかりません」と言っている")
            .not.toContain("その写真は見つかりませんでした。");
    });

    it("開ける写真では何も言わない（正常系）", async () => {
        searchParams.current = "p1";
        render(<GalleryPageClient />);

        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast).not.toHaveBeenCalled();
        // 見出しは2つある（狭い画面用の `sr-only` と広い画面用）。jsdom は
        // CSS を評価しないので両方 DOM に居る。
        // **`.length > 0` は死んだ判定**——`getAllByText` は0件で投げるので、
        // その比較が単独で赤くなることはない。件数を固定して、片方を消したら落とす
        expect(screen.getAllByText("Gallery")).toHaveLength(2);
    });
});

// **ここは自分が入れた回帰。**
//
// `usePhotos` の初期値は `app/data/photos.json`（ビルド時のスナップショット）
// なので、API が返る前から一覧は**非空**。「一覧の到着待ち」を
// `filteredPhotos.length === 0` で見ていたが、それでは**待てていない**。
//
// ビルド後にアップロードされた写真の共有リンクは、静的JSONに無いので
//   1. 赤いトースト「その写真は見つかりませんでした。」（**嘘**）
//   2. 「2回言わない」ために `dismissedRef` を書く
//   3. 数百ms後に API の一覧が届いても、その ref が
//      「一度閉じた写真は開き直さない」ゲートに引っかかり**永久に開かない**
// このモーダルは新着写真の**唯一の閲覧手段**なので、経路ごと塞いでいた。
describe("一覧が遅れて届くとき", () => {
    const LATE = { id: "late-1", src: "https://cdn/c.jpg", title: "新着", category: "travel", tags: [], date: "2026-02-01", createdAt: "2026-02-01" };

    it("届く前に「見つかりません」と言わない", async () => {
        photosState.loaded = false;          // API はまだ返っていない
        searchParams.current = "late-1";
        render(<GalleryPageClient />);

        await new Promise((r) => setTimeout(r, 30));
        expect(mockShowToast, "届く前に見つからないと言っている").not.toHaveBeenCalled();
    });

    it("あとから届いたら開ける（唯一の閲覧手段を塞がない）", async () => {
        photosState.loaded = false;
        searchParams.current = "late-1";
        const { rerender } = render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        // API の一覧が届く
        photosState.extra = [LATE];
        photosState.loaded = true;
        rerender(<GalleryPageClient />);

        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("photo"),
            "届いたのに開いていない",
        ).toBe("late-1"));
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    // **「見つかりません」と言ったことが、開くのを止める理由になってはいけない。**
    // 記録を `dismissedRef`（＝一度閉じた写真を開き直さないゲート）に書くと、
    // トーストを止めるつもりの1行が「開くのを止める」に化ける。別の ref に
    // 分けてあるので、あとからその写真が一覧に現れれば普通に開く
    it("一度「見つかりません」と言った写真でも、現れたら開く", async () => {
        photosState.loaded = true;
        searchParams.current = "late-1";
        const { rerender } = render(<GalleryPageClient />);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));

        photosState.extra = [LATE];
        rerender(<GalleryPageClient />);

        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("photo"),
            "言ったことが開くのを止めている",
        ).toBe("late-1"));
    });

    it("届いたうえで本当に無ければ、そのとき伝える", async () => {
        photosState.loaded = true;
        searchParams.current = "deleted-id";
        render(<GalleryPageClient />);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("見つかりませんでした"), "error"));
    });

    // **死んだ ?photo= を URL に残さない。** 残すと、再読込のたびに
    // 同じ「見つかりません」が出る
    it("無いと伝えたら、URL からも外す", async () => {
        window.history.replaceState({}, "", "/?photo=deleted-id");
        photosState.loaded = true;
        searchParams.current = "deleted-id";
        render(<GalleryPageClient />);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("photo"),
            "無いと分かったのに URL に残っている",
        ).toBeNull());
    });
});

// **戻るを押しても、モーダルが閉じていなかった。**
//
// 通知から `/?photo=<id>` を開いたときだけ本物の履歴が積まれる（同じ
// ルートなので `<Link>` が push する）。そこで戻ると URL は `/` に戻るのに、
// `photoParam` が消えたときに**何もしていなかった**のでモーダルは開いたまま
// ——画面とアドレスバーが食い違い、「戻るを押したのに何も起きなかった」
// と見える。もう一度押すと、モーダルを開いたままページを離れる。
describe("URL から ?photo= が消えたとき", () => {
    it("開いているモーダルを閉じる", async () => {
        searchParams.current = "p1";
        const { rerender } = render(<GalleryPageClient />);
        await waitFor(() => expect(new URLSearchParams(window.location.search).get("photo")).toBe("p1"));

        // ブラウザの戻る＝ ?photo= が外れる
        searchParams.current = "";
        rerender(<GalleryPageClient />);

        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("photo"),
            "戻ったのにモーダルが開いたまま",
        ).toBeNull());
    });

    it("開いていなければ何も起きない", async () => {
        searchParams.current = "";
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast).not.toHaveBeenCalled();
        expect(new URLSearchParams(window.location.search).get("photo")).toBeNull();
    });
});

// **`?photo=` は「マウント時に URL に載っている」とは限らない。**
//
// 主経路は通知の `<Link href="/?photo=<id>">` で、これは**同じルートへの
// 遷移**なのでこの画面は再マウントされない（すぐ上のコメントが同じ理由で
// 先に書いている）。マウント時にだけ待ち id の種を入れる作りだと、この
// 経路では種が入らず、そのあと絞り込みを触った瞬間に同期が `?photo=` を
// 落として id が失われる。
describe("遷移で ?photo= が届いたとき（再マウントされない）", () => {
    it("開けないまま絞り込みを触っても、id を落とさない", async () => {
        auth.current = { isAuthenticated: true, userId: "me", loading: false };
        // マウント時の URL に photo は無い（通知からの遷移で**あとから**届く）。
        // **まだ一覧に届いていない写真**にする——絞り込みで外れているだけの
        // 写真は、いまは絞り込みを外して開くので「開けないまま」にならない
        // （この試験が守りたいのは「開けない間、預けた id を落とさない」）。
        window.history.replaceState({}, "", "/?category=food");
        photosState.loaded = false;
        const { rerender } = render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        searchParams.current = "not-yet-arrived";
        rerender(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        // 別の絞り込みを触る＝同期が走る。この写真は**まだ開けない**ので、
        // ここで URL に残っているのは「預けた」からに他ならない
        fireEvent.click(screen.getByRole("button", { name: "フォロー中" }));

        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("photo"),
            "開けないまま絞り込みを触った拍子に id を落としている",
        ).toBe("not-yet-arrived"));
        // 開いてはいない（開けたから残った、ではないことを押さえる）
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    // 一覧そのものが空のときも同じ（フォロー中でフォロー0人、など）
    it("一覧が空でも id を落とさない", async () => {
        auth.current = { isAuthenticated: true, userId: "me", loading: false };
        window.history.replaceState({}, "", "/?feed=following");   // フォロー0人＝空
        photosState.loaded = true;
        const { rerender } = render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        searchParams.current = "p1";
        rerender(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        // **空のまま**同期を走らせる（同じタブを押しても `filters` は
        // 作り直されるので効果は再実行される）。「すべて」に戻すと開けて
        // しまい、預けを通らずに URL へ載るので、そこは押さない
        fireEvent.click(screen.getByRole("button", { name: "フォロー中" }));

        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("photo"),
            "一覧が空のうちに id を落としている",
        ).toBe("p1"));
        expect(screen.queryByRole("button", { name: "すべて" })).toBeTruthy();   // まだ空のまま
    });

    // API の一覧がまだ届いていないときも同じ
    it("一覧が届く前でも id を落とさない", async () => {
        auth.current = { isAuthenticated: true, userId: "me", loading: false };
        window.history.replaceState({}, "", "/?category=food");
        photosState.loaded = false;        // API はまだ返っていない
        const { rerender } = render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        searchParams.current = "unknown-yet";
        rerender(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        fireEvent.click(screen.getByRole("button", { name: "フォロー中" }));

        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("photo"),
            "届く前に id を落としている",
        ).toBe("unknown-yet"));
        expect(mockShowToast).not.toHaveBeenCalled();
    });
});

// **絞り込み中に通知をタップしても、本当に何も起きなかった。**
//
// `?photo=<id>` で写真を名指ししているのに、絞り込みから外れていると
// モーダルも出ず、理由も出ず、押し直しても同じ（`?photo=` だけが URL に
// 残る）。ビルド後の新着写真はこのモーダルが唯一の閲覧手段で、
// 「フォロー中」を見ている人には**自分宛ての通知がほぼ全部この経路**
// （自分の写真はフォロー中フィードに出ない）。
// 名指しされた1枚を開く方に倒し、外したことはトーストで伝える。
describe("絞り込みで外れている写真を名指しされたとき", () => {
    it("絞り込みを外して開き、外したことを伝える", async () => {
        window.history.replaceState({}, "", "/?category=travel");
        searchParams.current = "p2";   // p2 は category=food
        render(<GalleryPageClient />);

        await waitFor(() => expect(
            new URLSearchParams(window.location.search).get("category"),
            "絞り込みが残ったまま（＝写真は開けない）",
        ).toBeNull());
        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("絞り込みを解除"), "info");
        // 名指しされた写真は URL に残る（開いた状態）
        expect(new URLSearchParams(window.location.search).get("photo")).toBe("p2");
    });

    it("同じ写真で何度も言わない", async () => {
        window.history.replaceState({}, "", "/?category=travel");
        searchParams.current = "p2";
        const { rerender } = render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));
        rerender(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));

        const cleared = mockShowToast.mock.calls.filter((c) => String(c[0]).includes("絞り込みを解除"));
        expect(cleared, "同じ写真でトーストを繰り返している").toHaveLength(1);
    });

    // 絞り込みが無いときは触らない（余計なトーストを出さない）
    it("絞り込みが無ければ何も言わない", async () => {
        searchParams.current = "p1";
        render(<GalleryPageClient />);

        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast).not.toHaveBeenCalled();
    });
});
