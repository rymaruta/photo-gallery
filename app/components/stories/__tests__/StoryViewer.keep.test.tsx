import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoryGroup } from "@/lib/stories";

// **このサイトにしかない向き。** Instagram は「投稿 → ストーリーへシェア」
// しか持っていない。ここは逆で、24時間で消えるものを**検索に出る写真**にする。
// できるのは**下書き**なので、黙って検索に出ることはない。

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// 画像の道具は canvas を使うので jsdom では通らない。ここで見たいのは
// 「サムネを作って一緒に送るか」なので、作れた／作れないを差し替える
const mockThumb = vi.hoisted(() => vi.fn(async () => new File(["t"], "t.webp", { type: "image/webp" })));
const mockColor = vi.hoisted(() => vi.fn(async () => "#123456"));
const mockBlur = vi.hoisted(() => vi.fn(async () => "data:image/webp;base64,zz"));
vi.mock("@/lib/utils/image", () => ({
    createThumbnail: (...a: unknown[]) => mockThumb(...(a as [])),
    extractDominantColor: (...a: unknown[]) => mockColor(...(a as [])),
    createBlurPlaceholder: (...a: unknown[]) => mockBlur(...(a as [])),
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_res: unknown, fallback: string) => fallback,
    sessionErrorMessage: () => null,
}));

import StoryViewer from "../StoryViewer";

const own = (extra: Record<string, unknown> = {}): StoryGroup[] => [{
    userId: "me",
    displayName: "自分",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "me", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z", ...extra },
        { id: "s2", src: "https://cdn/x/b.jpg", userId: "me", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z" },
    ],
}];

// **キャプションを持たせる。** 下の段は `(isOwnStory || item.caption)` で
// 出るので、キャプションが無い他人のストーリーでは段ごと描かれない
// ——`isOwnStory` の判定を消しても「ボタンが無い」ことになり、
// **何も検証していないテスト**になる（変異で実際に素通りした）
const others = (): StoryGroup[] => [{
    userId: "friend", displayName: "友人",
    items: [{ id: "f1", src: "https://cdn/x/c.jpg", userId: "friend", caption: "友人のキャプション", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" }],
}];

const view = (groups: StoryGroup[], props: Partial<React.ComponentProps<typeof StoryViewer>> = {}) => render(
    <StoryViewer groups={groups} initialGroupIndex={0} locale="ja" isAuthenticated ownUserId="me"
        onSeen={() => { /* noop */ }} onClose={() => { /* noop */ }} {...props} />,
);

const keepPosts = () => mockUserFetch.mock.calls.filter(
    (c) => String(c[0]).includes("/keep") && (c[1] as { method?: string })?.method === "POST");

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
    // **画像の道具も戻す。** 「サムネを作れなくても残せる」のテストが
    // `mockThumb` を null に置き換えたまま次へ渡していて、あとから足した
    // テストが**サムネの経路を一度も通らないまま緑**になっていた
    // （単体では通り、フルで走らせると落ちる形で気づいた）
    mockThumb.mockReset().mockResolvedValue(new File(["t"], "t.webp", { type: "image/webp" }));
    mockColor.mockReset().mockResolvedValue("#123456");
    mockBlur.mockReset().mockResolvedValue("data:image/webp;base64,zz");
    // **`vi.stubGlobal` にも後始末を付ける。** 上の `mockThumb` と同じ形の
    // 漏れを、`fetch` の側で作っていた（いまは後続が自前で差し替えるので
    // 発火していないが、そういう「たまたま」で持たせない）
    vi.unstubAllGlobals();
});

/**
 * **テストは、自分が始めた要求を自分で着地させてから終わること。**
 *
 * `keepToGallery` は `await import(...)` と `buildKeepThumb` の後ろで
 * `/keep` を撃つので、**画面の変化を見た時点ではまだ飛んでいない**。
 * そこでテストを終えると、要求は `beforeEach` の `mockReset()` を
 * またいで**次のテストの呼び出し記録に着地する**。
 *
 * これが本番の `Deploy Site`（run 371・1回目）を落とした:
 * 「待っている間に手で次へ進めたら…」が
 * `expected [...] to have a length of 1 but got 2` で落ちた——2つ目は
 * **前のテストが飛ばしたまま終えた POST** だった。負荷で着地が早まると
 * 最初の `waitFor` の時点で 2 になるので、CI でだけ落ちる。
 *
 * 実測（probe で順番に記録した）:
 *
 *     [A] /stories/s1/viewers GET
 *     [A] test end                  ← A のクリックの POST はまだ出ていない
 *     [B] /stories/s1/keep POST     ← B 自身のぶん（件数 1）
 *     [B] /stories/s1/keep POST     ← **A のぶんが遅れて着地**（件数 2）
 *
 * 目視では気づけないので、**テストの本体が終わったあとに要求が増えないこと**
 * を機械で見る。増えたら、そのテストが着地を待っていない。
 */
afterEach(async () => {
    const before = mockUserFetch.mock.calls.length;
    // マイクロタスクとタイマーを1周させる（飛んでいる要求があれば、ここで着地する）
    await new Promise((r) => setTimeout(r, 20));
    const late = mockUserFetch.mock.calls.slice(before).map((c) => String(c[0]));
    expect(late, "テストが終わったあとに要求が着地している（次のテストの件数に入る）").toEqual([]);
});

describe("ストーリーをギャラリーに残す", () => {
    it("押すと、そのストーリーを残しにいく", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: true, json: async () => ({ photoId: "p-1" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        expect(keepPosts()[0][0]).toBe("/stories/s1/keep");
    });

    // **仕上げへ誘う。** 残しただけでは下書きで、撮影地も題も無い
    // ——そのままでは検索の価値が無い
    it("残したら、編集画面への導線に変わる", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: true, json: async () => ({ photoId: "p-1" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        const link = await screen.findByText("仕上げる");
        expect(link.closest("a")?.getAttribute("href")).toBe("/user/edit?id=p-1");
    });

    // 既に残してあるストーリーを開き直したとき（サーバーが `keptAs` を返す）
    it("既に残してあれば、最初から導線を出す", async () => {
        view(own({ keptAs: "p-9" }));
        const link = await screen.findByText("仕上げる");
        expect(link.closest("a")?.getAttribute("href")).toBe("/user/edit?id=p-9");
        expect(screen.queryByLabelText("ギャラリーに残す"), "残してあるのに押させている").toBeNull();
    });

    // 写真の行は画像が前提（サムネも AVIF も sharp が作る）
    it("動画には出さない", async () => {
        view(own({ mediaType: "video" }));
        await screen.findByLabelText("閉じる");
        expect(screen.queryByLabelText("ギャラリーに残す")).toBeNull();
    });

    it("他人のストーリーには出さない", async () => {
        view(others());
        // 段そのものは出ている（キャプションがある）ことを先に確かめる
        expect(await screen.findByText("友人のキャプション")).toBeInTheDocument();
        expect(screen.queryByLabelText("ギャラリーに残す"), "他人の写真を自分のギャラリーに入れられる").toBeNull();
    });

    it("失敗したら理由を出す（残したことにしない）", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(screen.queryByText("仕上げる"), "失敗したのに残したと出ている").toBeNull();
    });

    // **応答を待っている間は進めない。** 進むと、残した手応えが別の1枚に出る
    it("残している間は自動で進まない", async () => {
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                await held;
                return { ok: true, json: async () => ({ photoId: "p-1" }) };
            }
            return { ok: true, json: async () => ({}) };
        });
        view(own());
        fireEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(
            (document.querySelector(".story-progress-fill") as HTMLElement | null)?.style.animationPlayState,
            "応答を待っている間も進んでいる",
        ).toBe("paused"));
        // **自分が始めた要求を、自分で着地させてから終わる。**
        // 止まったことを見た時点では `/keep` の POST はまだ出ていない
        // （`setKeeping(true)` は同期だが、POST は `await import` と
        //  `buildKeepThumb` の後ろにある）。ここで終わると、その POST は
        // **次のテストの `mockUserFetch` に着地して、あちらの件数を1つ増やす**
        // ——本番の Deploy Site を1回落とした当のもの（下の afterEach を見よ）
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        release();
        await screen.findByText("仕上げる");
    });

    // **実時間で待たない。** 以前はここで `setTimeout(30)` を挟んでいたが、
    // 30ms は「応答の後始末が終わる時間」ではなく**ただの当て推量**で、
    // 込み合った回には足りない。フルスイート（337ファイル）で実際に落ちた
    // ——4回中2回。テストファイルが増えて機械が混んだだけで結果が変わる、
    // つまり**何も保証していない待ち方**だった。
    //
    // 残す処理の続きはマイクロタスクだけ（タイマーを挟まない）ので、
    // 応答が読まれたことを合図にしてキューを空にすれば、必ず最後まで進む。
    it("待っている間に手で次へ進めたら、その1枚に手応えを出さない", async () => {
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        // 応答の本文が読まれた＝この直後に「まだ同じ1枚か」の判定が走る
        let bodyRead!: () => void;
        const readBody = new Promise<void>((r) => { bodyRead = r; });
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (String(url).includes("/keep") && init?.method === "POST") {
                await held;
                return { ok: true, json: async () => { bodyRead(); return { photoId: "p-1" }; } };
            }
            return { ok: true, json: async () => ({}) };
        });
        view(own());
        fireEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));

        fireEvent.keyDown(document, { key: "ArrowRight" });
        // **進んだことを先に確かめる。** ここを見ないと、「進んでいない」
        // という別の壊れ方が「手応えが出ている」として報告される
        await waitFor(() => expect(
            document.querySelector('img[src="https://cdn/x/b.jpg"]'),
            "手で次へ進めていない（この後の判定が別の理由で落ちる）",
        ).toBeTruthy());

        release();
        await act(async () => {
            await readBody;
            // 判定とその後始末（`setKeeping(false)`）まで進める
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        expect(screen.queryByText("仕上げる"), "別の1枚に手応えが出ている").toBeNull();
    });
});


// **キャプションが潰れないこと。** ピルは全部 `flex-shrink-0` なので、
// 「残す」を足したぶん縮むのはキャプションだけ——実測（390px）で幅 35px、
// 320px では**ピルが画面の外**へ出ていた（押せない部分ができる）。
// jsdom は CSS を評価しないので、**綴りで縛るしかない**（実際の寸法は
// Playwright で測って確かめた: 3つ並ぶと折り返って 358px、
// ピル1つなら今までどおり横に 251px）。
// 見る側に「どこで」が伝わる（Instagram のロケーションと同じ）。
// 名前の段の下に置くのは、下端の段が既に3つのピルで埋まっているため
describe("ストーリーの撮影地", () => {
    it("付いていれば出す", async () => {
        view(own({ location: "横浜 みなとみらい" }));
        expect(await screen.findByText("横浜 みなとみらい")).toBeInTheDocument();
    });

    it("無ければ何も出さない", async () => {
        view(own());
        await screen.findByLabelText("閉じる");
        expect(document.body.textContent).not.toContain("みなとみらい");
    });
});

describe("下の段のレイアウト", () => {
    it("段は折り返し、キャプションは最小幅を持つ", async () => {
        view(own({ caption: "夕暮れの港" }));
        const cap = await screen.findByText("夕暮れの港");
        const row = cap.parentElement!;
        expect(row.className, "折り返さないとピルが画面の外へ出る").toContain("flex-wrap");
        expect(cap.className, "最小幅が無いとキャプションが潰れる").toContain("min-w-32");
        expect(cap.className, "収まらないときに次の段へ落ちる基準が無い").toContain("basis-32");
    });
});


// **残した写真だけサムネが無かった。** 公開するとホームの一覧が
// 1440px の原寸を読む（普通のアップロードは端末側で 512px を作って送る）。
// 補う `generate-thumbnails.js` はビルド時にしか走らないので、
// `REBUILD_DISPATCH_TOKEN` が未設定の本番では**最大7日**そのまま。
describe("残すときに、一覧用のサムネも作って送る", () => {
    const withUpload = () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/presigned-url")) {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/t.webp", contentType: "image/webp" }) });
            }
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: true, json: async () => ({ photoId: "p-1" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/jpeg" }) })));
    };

    it("サムネ・代表色・ぼかしを一緒に送る", async () => {
        withUpload();
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        const body = JSON.parse((keepPosts()[0][1] as { body: string }).body);
        expect(body.thumbUrl, "一覧が原寸を読む").toBe("https://cdn/uploads/me/t.webp");
        expect(body.dominantColor).toBe("#123456");
        expect(body.blurDataURL).toBe("data:image/webp;base64,zz");
    });

    // **上げ切れなかったら URL を送らない**（送ると一覧が存在しない
    // ファイルを指して割れた画像が並ぶ＝サムネ無しより悪い）
    it("サムネを上げ切れなかったら、URL は送らない", async () => {
        withUpload();
        vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("s3")
            ? { ok: false, status: 403 }
            : { ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/jpeg" }) })));
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        const body = JSON.parse((keepPosts()[0][1] as { body: string }).body);
        expect("thumbUrl" in body, "存在しないファイルを指している").toBe(false);
    });

    // **作れなくても残す方は進める**（次のビルドが補う）
    it("サムネを作れなくても、残すのは成功する", async () => {
        withUpload();
        mockThumb.mockResolvedValue(null as unknown as File);
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        expect(await screen.findByText("仕上げる")).toBeInTheDocument();
    });
});


// **別オリジンから素で取ると、必ず失敗する。**
// `item.src` は CloudFront の既定ドメインで、`/uploads/*` は CORS を
// 返していない（キャッシュポリシーが `Origin` を転送しないので S3 の
// バケット CORS まで届かない。`public/sw.js` の `isStorablePhoto` が
// 同じことを書いている）。`fetch` の既定は `mode: "cors"` なので
// TypeError になり、呼び出し側の `.catch` が飲んで
// **「サムネ無しで成功」**——直したつもりで何も変わらない形。
// `/uploads/*` はサイトと同じディストリビューションのビヘイビアなので、
// パスだけにすれば同一オリジンとして取れる。
describe("画像のバイト列は、まず同一オリジンから取り直す", () => {
    const cdnStory = (): StoryGroup[] => [{
        userId: "me", displayName: "自分",
        items: [{ id: "s1", src: "https://cdn.example.com/uploads/me/a.jpg", userId: "me", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" }],
    }];
    const imageFetches = (f: ReturnType<typeof vi.fn>) => f.mock.calls
        .map((c) => String(c[0])).filter((u) => !u.includes("s3"));

    it("別オリジンの URL では投げず、パスだけで取りに行く", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/presigned-url")) {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/t.webp", key: "uploads/me/t.webp", contentType: "image/webp" }) });
            }
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: true, json: async () => ({ photoId: "p-1" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        const f = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/jpeg" }) }));
        vi.stubGlobal("fetch", f);
        view(cdnStory());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        expect(imageFetches(f)[0], "別オリジンのまま取りに行っている（CORS で必ず落ちる）")
            .toBe("/uploads/me/a.jpg");
    });

    // サイト側に `/uploads/*` が無い置き方・CORS が入った環境でも動くように
    it("同一オリジンで取れなければ、元の URL でもう一度試す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/presigned-url")) {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/t.webp", key: "uploads/me/t.webp", contentType: "image/webp" }) });
            }
            if (String(url).includes("/keep") && init?.method === "POST") {
                return Promise.resolve({ ok: true, json: async () => ({ photoId: "p-1" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        const f = vi.fn(async (url: string) => (String(url).startsWith("/uploads/")
            ? { ok: false, status: 404 }
            : { ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/jpeg" }) }));
        vi.stubGlobal("fetch", f);
        view(cdnStory());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        expect(imageFetches(f)).toEqual(["/uploads/me/a.jpg", "https://cdn.example.com/uploads/me/a.jpg"]);
        const body = JSON.parse((keepPosts()[0][1] as { body: string }).body);
        expect(body.thumbUrl, "取り直せたのにサムネを作っていない").toBe("https://cdn/uploads/me/t.webp");
    });
});

// **上げたサムネを、誰も参照しないまま S3 に置き去りにしていた。**
// 枚数上限・期限切れ・通信断はどれも押し直せる失敗なので、押すたびに
// 1個ずつ増える。指す行がどこにも無いので、どの削除経路からも辿れない。
// 同じことをする `app/user/upload`（`reservedThumbKey`）と `StoriesBar`
// （`uploadedKey`）は両方とも後始末を持っている。
describe("残せなかったら、上げたサムネを捨てる", () => {
    const discards = () => mockUserFetch.mock.calls.filter(
        (c) => String(c[0]).includes("/upload/discard") && (c[1] as { method?: string })?.method === "DELETE");

    const withKeepResult = (keep: () => Promise<unknown>) => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/presigned-url")) {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/t.webp", key: "uploads/me/t.webp", contentType: "image/webp" }) });
            }
            if (String(url).includes("/keep") && init?.method === "POST") return keep();
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/jpeg" }) })));
    };

    it("`/keep` が失敗したら捨てる", async () => {
        withKeepResult(async () => ({ ok: false, status: 403, json: async () => ({}) }));
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(discards()).toHaveLength(1));
        expect(JSON.parse((discards()[0][1] as { body: string }).body).key).toBe("uploads/me/t.webp");
    });

    // **応答を読む前に投げる経路（通信断・セッション切れ）もある。**
    // `!res.ok` の枝だけに置くと、いちばん起きやすい形が抜ける
    it("通信が落ちても捨てる", async () => {
        withKeepResult(async () => { throw new Error("offline"); });
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(discards()).toHaveLength(1));
    });

    // 二度押し。サーバーは既に残っていれば `thumbUrl` を見ないので、
    // 上げたぶんは誰にも参照されない
    it("既に残してあった（already）ときも捨てる", async () => {
        withKeepResult(async () => ({ ok: true, json: async () => ({ photoId: "p-1", already: true }) }));
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(discards()).toHaveLength(1));
    });

    it("残せたときは捨てない（使われている実体を消さない）", async () => {
        withKeepResult(async () => ({ ok: true, json: async () => ({ photoId: "p-1" }) }));
        view(own());
        await userEvent.click(await screen.findByLabelText("ギャラリーに残す"));
        await waitFor(() => expect(keepPosts()).toHaveLength(1));
        await screen.findByText("仕上げる");
        expect(discards(), "使われているサムネを消している").toHaveLength(0);
    });
});
