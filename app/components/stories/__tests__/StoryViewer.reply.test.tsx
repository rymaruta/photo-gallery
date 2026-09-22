import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoryGroup } from "@/lib/stories";
import { STORY_REACTIONS } from "@/lib/stories";

// **見た人が反応する手段が1つも無かった。** 見て、消える。
// 返信はストーリーの中心にある往復で、ここが無いと置いておくだけになる。

const mockUserFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    // **列挙のモックに漏れがあると、そこで throw する。**
    // ブロックが `noteFollowSevered` → `loadCounts` → `userPublicFetch` を
    // 撃つようになったのに、これが無かった。vitest が
    // 「No "userPublicFetch" export is defined」を投げ、`loadCounts` の
    // 内側 catch が飲んで**400ms のタイマーを置き去りにしていた**
    // （テストは緑のまま、数の取り直しは一度も通っていなかった）
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
    readApiError: async (_res: unknown, fallback: string) => fallback,
    sessionErrorMessage: () => null,
}));

import StoryViewer from "../StoryViewer";

/** 他人のストーリー2枚（返信できる側） */
const othersGroups = (): StoryGroup[] => [{
    userId: "friend",
    displayName: "友人",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "friend", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z" },
        { id: "s2", src: "https://cdn/x/b.jpg", userId: "friend", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z" },
    ],
}];

/** 自分のストーリー（返信を受け取る側） */
const ownGroups = (replyCount?: number): StoryGroup[] => [{
    userId: "me",
    displayName: "自分",
    items: [
        { id: "s1", src: "https://cdn/x/a.jpg", userId: "me", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z", ...(replyCount ? { replyCount } : {}) },
    ],
}];


/**
 * **絵が出たことにする。**
 *
 * ストーリーは「読み込みが済むまで時間を進めない」ようになった
 * （owner の「3秒目くらいまで真っ黒」への対応）。jsdom は画像を読まないので、
 * 読み終わりを模さないと**開いた直後のまま凍る**。
 * ここが守っているのは進む/止まるの規則で、その前提が1つ増えただけ。
 */
function markMediaLoaded() {
    const el = document.querySelector("img.story-media-in, video.story-media-in");
    if (el) fireEvent.load(el);
}

const renderThenLoad = (ui: React.ReactElement) => {
    const r = render(ui);
    markMediaLoaded();
    return r;
};

const view = (groups: StoryGroup[], props: Partial<React.ComponentProps<typeof StoryViewer>> = {}) => renderThenLoad(
    <StoryViewer
        groups={groups}
        initialGroupIndex={0}
        locale="ja"
        isAuthenticated
        ownUserId="me"
        onSeen={() => { /* noop */ }}
        onClose={() => { /* noop */ }}
        {...props}
    />,
);

const replyPosts = () => mockUserFetch.mock.calls.filter(
    (c) => String(c[0]).includes("/replies") && (c[1] as { method?: string })?.method === "POST");

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

// **テストは、自分が始めた要求を自分で着地させてから終わること。**
// `StoryViewer.keep.test.tsx` と同じ見張り（あちらは、着地しなかった POST が
// 次のテストの件数に入って**本番の Deploy Site を1回落とした**）。
// 返信の側も「保留した応答を release して、待たずに終える」形を2つ持つ。
afterEach(async () => {
    const before = mockUserFetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    const late = mockUserFetch.mock.calls.slice(before).map((c) => String(c[0]));
    expect(late, "テストが終わったあとに要求が着地している（次のテストの件数に入る）").toEqual([]);
});

describe("ストーリーへの返信（見る側）", () => {
    it("♡ を押すと、そのストーリーへ送る（モック⑥）", async () => {
        view(othersGroups());
        await userEvent.click(await screen.findByLabelText("いいねを送る"));

        await waitFor(() => expect(replyPosts()).toHaveLength(1));
        const [url, init] = replyPosts()[0] as [string, { body: string }];
        expect(url).toBe("/stories/s1/replies");
        expect(JSON.parse(init.body)).toEqual({ emoji: STORY_REACTIONS[0] });
        expect(await screen.findByText("送信しました")).toBeInTheDocument();
    });

    // モック⑥ の帯は「メッセージを送る…」と ♡ と ➤ の1段。絵文字の列は
    // 入力に触れてから出す（触れた瞬間に消えると、その絵文字を押せない）
    it("絵文字の列は、入力に触れてから出る", async () => {
        view(othersGroups());
        const input = await screen.findByLabelText("このストーリーに返信");
        expect(screen.queryByLabelText(`${STORY_REACTIONS[1]} で反応する`), "最初から出ている").toBeNull();
        await userEvent.click(input);
        expect(screen.getByLabelText(`${STORY_REACTIONS[1]} で反応する`)).toBeTruthy();
        // 押すために、フォーカスが外れても畳まない
        await userEvent.click(screen.getByLabelText(`${STORY_REACTIONS[1]} で反応する`));
        await waitFor(() => expect(replyPosts()).toHaveLength(1));
        expect(JSON.parse((replyPosts()[0][1] as { body: string }).body)).toEqual({ emoji: STORY_REACTIONS[1] });
    });

    // モック⑥ の帯には空でも ➤ が置かれている。**押しても何も起きない
    // ボタンにしない**——打つまでは押せない
    it("➤ は打つまで押せない", async () => {
        view(othersGroups());
        const send = await screen.findByLabelText("送信");
        expect(send, "空なのに送信を押せる").toBeDisabled();
        await userEvent.type(screen.getByLabelText("このストーリーに返信"), "きれい！");
        expect(send).toBeEnabled();
    });

    it("一言を打って送れる", async () => {
        view(othersGroups());
        await userEvent.type(await screen.findByLabelText("このストーリーに返信"), "きれい！");
        await userEvent.click(screen.getByLabelText("送信"));

        await waitFor(() => expect(replyPosts()).toHaveLength(1));
        expect(JSON.parse((replyPosts()[0][1] as { body: string }).body)).toEqual({ text: "きれい！" });
    });

    // **変換確定の Enter で送らない。**「きょう」を「今日」に変換した瞬間に
    // 飛ぶ（`lib/utils/ime.ts`。日本語で打つ人は必ず踏む）
    it("変換確定の Enter では送らない", async () => {
        view(othersGroups());
        const input = await screen.findByLabelText("このストーリーに返信");
        await userEvent.type(input, "きょう");
        fireEvent.keyDown(input, { key: "Enter", keyCode: 13, isComposing: true });
        // **待ってから数える。** `sendReply` は `await import(...)` から始まるので、
        // 直後に数えると**送っていても 0 件に見える**（変異で確かめたら、
        // IME の判定を外しても緑のままだった＝何も検証していなかった）
        await new Promise((r) => setTimeout(r, 30));
        expect(replyPosts(), "変換確定で送っている").toHaveLength(0);

        fireEvent.keyDown(input, { key: "Enter", keyCode: 13, isComposing: false });
        await waitFor(() => expect(replyPosts()).toHaveLength(1));
    });

    // **打ちかけを持ち越さない。** 送り先は表示中のストーリーなので、
    // 持ち越すと**書いた相手と違う人に届く**
    it("次のストーリーへ進むと、打ちかけを捨てる", async () => {
        view(othersGroups());
        const input = await screen.findByLabelText("このストーリーに返信");
        await userEvent.type(input, "1枚目に書いた");
        fireEvent.blur(input);   // 入力中は進まないので、まず外す
        fireEvent.keyDown(document, { key: "ArrowRight" });

        await waitFor(() => expect(
            (screen.getByLabelText("このストーリーに返信") as HTMLInputElement).value,
            "前のストーリーに書いた文が残っている",
        ).toBe(""));
    });

    it("送ったあとの「送信しました」も持ち越さない", async () => {
        view(othersGroups());
        await userEvent.click(await screen.findByLabelText("いいねを送る"));
        expect(await screen.findByText("送信しました")).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "ArrowRight" });
        await waitFor(() => expect(
            screen.queryByText("送信しました"), "次のストーリーに前の手応えが出ている").toBeNull());
    });

    // **入力中は進めない。** 打っている途中で次へ送られると、
    // 書いた相手と違う人に届く
    it("入力中は次へ進まない", async () => {
        view(othersGroups());
        const input = await screen.findByLabelText("このストーリーに返信");
        await userEvent.type(input, "打っている途中");
        // **入力の中で押した矢印**（実ブラウザでは target が入力になる）。
        // 横取りされると、カーソルを動かしたつもりで次のストーリーへ飛び、
        // 打ちかけが捨てられる
        fireEvent.keyDown(input, { key: "ArrowRight", keyCode: 39, isComposing: false });

        await new Promise((r) => setTimeout(r, 20));
        expect((screen.getByLabelText("このストーリーに返信") as HTMLInputElement).value,
            "入力中に次のストーリーへ送られた").toBe("打っている途中");
    });

    // 空白・矢印・Escape はビューアの操作に割り当ててある。
    // そのままだと**空白が打てず、Escape で画面ごと消える**
    it("入力中のスペースはビューアに横取りされない", async () => {
        view(othersGroups());
        const input = await screen.findByLabelText("このストーリーに返信") as HTMLInputElement;
        await userEvent.type(input, "あ い");
        expect(input.value, "スペースを横取りされている").toBe("あ い");
    });

    it("入力中の Escape はビューアを閉じない（入力から抜ける）", async () => {
        const onClose = vi.fn();
        view(othersGroups(), { onClose });
        const input = await screen.findByLabelText("このストーリーに返信");
        fireEvent.keyDown(input, { key: "Escape", keyCode: 27, isComposing: false });
        expect(onClose, "入力中の Escape で画面ごと閉じている").not.toHaveBeenCalled();
    });

    it("失敗したら理由を出す（送信しましたにしない）", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(othersGroups());
        await userEvent.click(await screen.findByLabelText("いいねを送る"));

        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(screen.queryByText("送信しました"), "失敗したのに成功と出ている").toBeNull();
    });

    // 自分のストーリーには送れない（サーバーも 400 で断る）
    it("自分のストーリーには返信欄を出さない", async () => {
        view(ownGroups());
        await screen.findByLabelText("閉じる");
        expect(screen.queryByLabelText("このストーリーに返信"), "自分のストーリーに返信欄が出ている").toBeNull();
    });

    // 押してから断るのがいちばん不親切。会員限定の操作は最初から出さない
    it("未ログインには返信欄を出さない", async () => {
        view(othersGroups(), { isAuthenticated: false, ownUserId: null });
        await screen.findByLabelText("閉じる");
        expect(screen.queryByLabelText("このストーリーに返信")).toBeNull();
    });
});

// **「入力中は進めない」を、進行そのもので確かめる。**
// 既存の「入力中は次へ進まない」は矢印キーのガード（タグ名で見る側）を
// 検証しているだけで、**自動送りは1本も見ていなかった**——`frozen` から
// `replyFocused` や `repliesOpen` を外しても全部緑だった。
describe("入力中・送信中は自動で進まない", () => {
    /** 画像の進捗は CSS アニメーションが駆動する。止まっていれば paused */
    const playState = () => (document.querySelector(".story-progress-fill") as HTMLElement | null)
        ?.style.animationPlayState;

    it("何もしていなければ進む", async () => {
        view(othersGroups());
        await screen.findByLabelText("このストーリーに返信");
        expect(playState()).toBe("running");
    });

    it("入力欄にフォーカスしている間は止まる", async () => {
        view(othersGroups());
        const input = await screen.findByLabelText("このストーリーに返信");
        fireEvent.focus(input);
        await waitFor(() => expect(playState(), "打っている間も進んでいる").toBe("paused"));
    });

    // **絵文字を押した時点で入力欄にフォーカスは無い。**
    // 送信中に表示が次へ移ると、「送信しました」が**次の人の画面**に出る
    it("送信中は止まる", async () => {
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && init?.method === "POST") {
                await held;
                return { ok: true, json: async () => ({}) };
            }
            return { ok: true, json: async () => ({}) };
        });
        view(othersGroups());
        fireEvent.click(await screen.findByLabelText("いいねを送る"));
        await waitFor(() => expect(playState(), "応答を待っている間も進んでいる").toBe("paused"));
        release();
    });

    // 手で矢印を押されれば表示は変わる。そのときに「送信しました」を出すと、
    // **送っていない人の画面に手応えが出る**
    it("送信中に手で次へ進めたら、次の人の画面に手応えを出さない", async () => {
        let release!: () => void;
        const held = new Promise<void>((r) => { release = r; });
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && init?.method === "POST") {
                await held;
                return { ok: true, json: async () => ({}) };
            }
            return { ok: true, json: async () => ({}) };
        });
        view(othersGroups());
        fireEvent.click(await screen.findByLabelText("いいねを送る"));
        await waitFor(() => expect(mockUserFetch.mock.calls.some(
            (c) => String(c[0]).includes("/replies")))
            .toBe(true));

        fireEvent.keyDown(document, { key: "ArrowRight" });   // 手で次へ
        release();
        await new Promise((r) => setTimeout(r, 30));

        expect(screen.queryByText("送信しました"), "送っていない人の画面に手応えが出ている").toBeNull();
        expect(screen.getByLabelText("このストーリーに返信"), "返信欄が消えている").toBeInTheDocument();
    });
});

describe("届いた返信（投稿者側）", () => {
    // シートを開いている間も止める（閲覧者リストと同じ）。
    // 止めないと、読んでいる途中で次のストーリーへ移って**別の人の返信**が
    // 出る（`viewersOpen` は最初から入っていたのに、こちらは無検証だった）
    it("返信のシートを開いている間は止まる", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        const fill = document.querySelector(".story-progress-fill") as HTMLElement | null;
        expect(fill?.style.animationPlayState, "シートを開いている間も進んでいる").toBe("paused");
    });

    it("0件のときはボタンを出さない", async () => {
        view(ownGroups());
        await screen.findByLabelText("閉じる");
        expect(screen.queryByLabelText("届いた返信を見る"), "押しても何も無いボタンを出している").toBeNull();
    });

    it("届いていれば数を出し、開くと中身を読みに行く", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "u2", name: "友人", text: "いいね！", t: "2026-07-04T12:00:00Z" }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(2));
        const btn = await screen.findByLabelText("届いた返信を見る");
        expect(btn.textContent).toContain("2");

        // **開くまでシートの中身は出ない。**
        // 「まだ `/replies` を呼んでいない」を数で言う形にしていたが、
        // それは**何も検証していなかった**（変異を入れても緑。原因は
        // このエフェクトの `await import` が実物のモジュールを掴み、
        // 実物の `userFetch` が投げて `catch` に吸われるため、
        // モックの呼び出し回数がそもそも増えない）。肯定側で見る
        expect(screen.queryByText("いいね！"), "開く前から中身が出ている").toBeNull();
        await userEvent.click(btn);
        expect(await screen.findByText("いいね！")).toBeInTheDocument();
    });

    it("読み込めなければ「0件」と言わない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        expect(await screen.findByText("返信を読み込めませんでした")).toBeInTheDocument();
        expect(screen.queryByText("まだ返信はありません"), "失敗を0件と言っている").toBeNull();
    });

    // 配列でない応答を「まだ返信はありません」にしない（SW-b8）
    it("配列でない応答も「0件」と言わない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({ ok: true, json: async () => ({ items: { nope: true } }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        expect(await screen.findByText("返信を読み込めませんでした")).toBeInTheDocument();
    });
});


// **押せる場所が無かった。** サーバー側は入っていたのに呼ぶ画面がどこにも
// 無く、迷惑な返信を受けた人にできることが**退会しかなかった**
// （`block.ts` が「やり取りの口を持つ以上の最低限」と書いている当のもの）。
// 困っているのは返信を読んでいる人なので、その場に置く。
describe("届いた返信から、その人をブロックする", () => {
    const withReply = () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "u2", name: "しつこい人", text: "…", t: "2026-07-04T12:00:00Z" }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
    };
    const blockCalls = () => mockUserFetch.mock.calls.filter(
        (c) => String(c[0]).includes("/block") && (c[1] as { method?: string })?.method === "POST");

    it("押すとその人をブロックする", async () => {
        withReply();
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));

        await waitFor(() => expect(blockCalls()).toHaveLength(1));
        expect(blockCalls()[0][0]).toBe("/users/u2/block");
        expect(await screen.findByText("ブロック済み")).toBeInTheDocument();
    });

    // **共有しているフォロー中の一覧にも反映する。**
    //
    // サーバーは両向きのフォローを切る（`block.ts`）。ここを呼ばないと、
    // **ギャラリーのフォロー中フィードにブロックした相手の写真が出続ける**
    // ——この画面はギャラリーの上に重なって開くので、閉じても再マウント
    // されず、取り直す契機が無い。プロフィール経由のブロックだけ直して
    // こちらを忘れていた（＝唯一マウントしたまま踏める経路が残っていた）
    it("共有しているフォロー中の一覧にも反映する", async () => {
        withReply();
        const mod = await import("../../../../lib/hooks/useFollow");
        const seen: string[] = [];
        const off = mod.subscribeFollowingSet(() => seen.push("changed"));
        try {
            view(ownGroups(1));
            await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
            await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
            await waitFor(() => expect(blockCalls()).toHaveLength(1));
            await waitFor(() => expect(seen, "一覧が古いまま（写真が出続ける）").toHaveLength(1));
        } finally { off(); }
    });

    // **ストーリーのバーも取り直させる。**
    // サーバーは `GET /stories` でブロック両向きを除外するが、
    // `StoriesBar` が取り直すのはマウント時と認証の変化時だけ。
    // 伝えないと**ブロックした相手のリングが残って開ける**。
    // プロフィール経由だとギャラリーへ戻る時点で再マウントされるので
    // 症状が出ない——**症状が出る唯一の経路がこちら**
    it("ブロックしたことを親へ伝える（バーを取り直させる）", async () => {
        withReply();
        const onBlocked = vi.fn();
        view(ownGroups(1), { onBlocked });
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
        await waitFor(() => expect(blockCalls()).toHaveLength(1));
        await waitFor(() => expect(onBlocked, "リングが残ったままになる").toHaveBeenCalledWith("u2"));
    });

    // **失敗を無言にしない。** プロフィール側は理由を出すのに、
    // ここだけ押しても何も起きないように見えていた
    it("失敗したら理由を出す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/block") && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            }
            if (String(url).includes("/replies")) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "u2", name: "しつこい人", text: "…", t: "2026-07-04T12:00:00Z" }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        const onBlocked = vi.fn();
        view(ownGroups(1), { onBlocked });
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
        await waitFor(() => expect(blockCalls()).toHaveLength(1));
        // **その場に出す**（`replyError` と同じ形。トーストにすると
        // `useToast` の Provider がこの部品に必要になり、単体で描けなくなる）
        expect(await screen.findByRole("alert"), "押しても何も起きないように見える").toBeInTheDocument();
        expect(onBlocked, "効いていないのに親へ伝えている").not.toHaveBeenCalled();
    });

    it("失敗した回は反映しない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/block") && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            }
            if (String(url).includes("/replies")) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "u2", name: "しつこい人", text: "…", t: "2026-07-04T12:00:00Z" }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        const mod = await import("../../../../lib/hooks/useFollow");
        const seen: string[] = [];
        const off = mod.subscribeFollowingSet(() => seen.push("changed"));
        try {
            view(ownGroups(1));
            await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
            await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
            await waitFor(() => expect(blockCalls()).toHaveLength(1));
            expect(seen, "効いていないのに一覧を捨てている").toHaveLength(0);
        } finally { off(); }
    });

    // **`catch` 側も見る。** 新しいテストは `!res.ok` しか撃っていなかった
    // ので、通信ごと落ちた回（オフライン・DNS 失敗）に無言へ戻す変異が
    // 160件すべて緑だった（レビューが実証）
    it("通信ごと落ちても理由を出す", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/block") && init?.method === "POST") {
                return Promise.reject(new Error("offline"));
            }
            if (String(url).includes("/replies")) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "u2", name: "しつこい人", text: "…", t: "2026-07-04T12:00:00Z" }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
        expect(await screen.findByRole("alert"), "押しても何も起きないように見える").toBeInTheDocument();
    });

    // **次のストーリーへ持ち越さない。**
    // すぐ上の effect が「前の人へ送ったはずの手応えを持ち越さない」と
    // 戒めているのに、`setBlockError` だけリセットに入れ忘れていた
    // ——s1 で失敗した赤い1行が、s2 の返信一覧に出る
    it("次のストーリーへ持ち越さない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/block") && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            }
            if (String(url).includes("/replies")) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "u2", name: "しつこい人", text: "…", t: "2026-07-04T12:00:00Z" }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        // 自分のストーリー2枚（送りで次へ行ける）
        view([{
            userId: "me", displayName: "自分",
            items: [
                { id: "s1", src: "https://cdn/x/a.jpg", userId: "me", createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z", replyCount: 1 },
                { id: "s2", src: "https://cdn/x/b.jpg", userId: "me", createdAt: "2026-07-04T11:00:00Z", expiresAt: "2099-07-05T11:00:00Z", replyCount: 1 },
            ],
        }]);
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
        await screen.findByRole("alert");

        // 返信シートを閉じて次のストーリーへ（他のテストと同じ矢印キー）
        await userEvent.click(screen.getAllByLabelText("閉じる").slice(-1)[0]);
        fireEvent.keyDown(document, { key: "ArrowRight" });
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));

        expect(screen.queryByRole("alert"), "前のストーリーの失敗を持ち越している").toBeNull();
    });

    // **効いたときだけ画面を変える。** 失敗を成功に見せると
    // 「押したのにまた届く」で二度目の落胆になる
    it("失敗したら「ブロック中」にしない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/block") && init?.method === "POST") {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            }
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "u2", name: "しつこい人", text: "…", t: "2026-07-04T12:00:00Z" }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
        await waitFor(() => expect(blockCalls()).toHaveLength(1));

        expect(screen.queryByText("ブロック済み"), "効いていないのにブロック済みと出ている").toBeNull();
        expect(await screen.findByLabelText("しつこい人 さんをブロック"), "押し直せない").toBeInTheDocument();
    });

    // **押す前に、何が起きるかを言う。** ブロックは相手とのフォローを
    // 両向きに切る（`block.ts`）。黙って切ると「フォロワーが1人減った」
    // だけが残る。戻し方（**設定**——2026-09-21 にプロフィール編集から移設）も
    // 同じ場所に書く
    it("押す前に、フォローも外れることと解除の場所を出す", async () => {
        withReply();
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        const note = await screen.findByText(/お互いのフォローも外れます/);
        expect(note.textContent, "解除の場所を言っていない").toContain("設定の「ブロックした人」");
    });

    // 押せる相手が居ないのに出すと、ただの雑音
    it("ブロックできる相手が居なければ、その一文は出さない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "gone", name: "退会したユーザー", text: "…", t: "2026-07-04T12:00:00Z", deleted: true }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await screen.findByText("退会したユーザー");
        expect(screen.queryByText(/お互いのフォローも外れます/)).toBeNull();
    });

    // ボタンが1つも無くなったら注記も消す（残すと、案内ではなく雑音）
    it("全員ブロックし終えたら、その一文も消える", async () => {
        withReply();
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await screen.findByText(/お互いのフォローも外れます/);
        await userEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
        await screen.findByText("ブロック済み");
        expect(screen.queryByText(/お互いのフォローも外れます/)).toBeNull();
    });

    // 退会した人にはもう届かない（押させない）
    it("退会した人にはボタンを出さない", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (String(url).includes("/replies") && !init?.method) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [{ id: "r1", uid: "gone", name: "退会したユーザー", text: "…", t: "2026-07-04T12:00:00Z", deleted: true }] }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        view(ownGroups(1));
        await userEvent.click(await screen.findByLabelText("届いた返信を見る"));
        await screen.findByText("退会したユーザー");
        expect(screen.queryByLabelText(/さんをブロック/)).toBeNull();
    });
});
