import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **ブロックしても、その人のリングがバーに残っていた。**
//
// サーバーは `GET /stories` でブロック両向きを除外する
// （`api-user/src/stories.ts` の `hiddenUserIds`）。だが `StoriesBar` が
// 取り直すのは**マウント時と `isAuthenticated` の変化時だけ**で、
// `StoryViewer` から「ブロックした」を伝える口が無かった。
//
// **プロフィール経由のブロックでは起きない**——あちらはギャラリーへ戻る
// 時点で `StoriesBar` が再マウントされて取り直す。**症状が出る唯一の経路が
// ビューア側**という非対称は、フォローの一覧でまったく同じ形を踏んだばかり。

const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return {
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        authenticatedFetch: vi.fn(),
        publicFetch: vi.fn(),
        userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
        readApiError: actual.readApiError,
        isGoneResponse: actual.isGoneResponse,
    };
});

import StoriesBar from "../StoriesBar";

/** 自分の1本（返信一覧を開ける＝ブロックを押せる） */
const mine = {
    id: "s1", src: "https://cdn/a.jpg", userId: "me", displayName: "自分",
    createdAt: "2098-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", replyCount: 1,
};
const reply = { id: "r1", uid: "u2", name: "しつこい人", text: "…", t: "2098-01-01T01:00:00Z" };

const listCalls = () => mockUserFetch.mock.calls.filter(
    (c) => c[0] === "/stories" && (c[1] as { method?: string } | undefined)?.method !== "DELETE");

/**
 * ビューアを閉じる。**「閉じる」は複数ある**（ビューア本体・閲覧者シート・
 * 返信シート）ので、ビューアが消えるまで順に押す
 */
async function closeViewer() {
    for (let i = 0; i < 4; i++) {
        const buttons = screen.queryAllByRole("button", { name: "閉じる" });
        if (buttons.length === 0) return;
        fireEvent.click(buttons[buttons.length - 1]);
        await waitFor(() => { /* 反映を待つ */ });
    }
}

beforeEach(() => {
    authState.current = { isAuthenticated: true, userId: "me" };
    localStorage.clear();
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/stories") return Promise.resolve({ ok: true, json: async () => [mine] });
        if (String(url).includes("/replies")) {
            return Promise.resolve({ ok: true, json: async () => ({ items: [reply] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
});

async function blockFromViewer() {
    render(<StoriesBar />);
    fireEvent.click(await screen.findByRole("button", { name: "自分のストーリーを見る" }));
    fireEvent.click(await screen.findByLabelText("届いたリアクション・返信を見る"));
    fireEvent.click(await screen.findByLabelText("しつこい人 さんをブロック"));
    await waitFor(() => expect(mockUserFetch.mock.calls.some(
        (c) => String(c[0]).includes("/block") && (c[1] as { method?: string })?.method === "POST")).toBe(true));
}

describe("返信一覧からブロックしたあと、ストーリーのバーを取り直す", () => {
    it("ビューアを閉じたときに取り直す", async () => {
        await blockFromViewer();
        expect(listCalls(), "開いている間に取り直している（添字がずれる）").toHaveLength(1);

        await closeViewer();
        await waitFor(() => expect(
            listCalls(),
            "ブロックした相手のリングが残ったままになる",
        ).toHaveLength(2));
    });

    // **ブロックしていない回は取り直さない。** 開いて閉じるたびに
    // 一覧を引き直すのは、Lambda の同時実行が10しかないこの環境では重い
    it("ブロックしていなければ、閉じても取り直さない", async () => {
        render(<StoriesBar />);
        fireEvent.click(await screen.findByRole("button", { name: "自分のストーリーを見る" }));
        await closeViewer();

        await waitFor(() => expect(screen.queryByLabelText("届いたリアクション・返信を見る")).toBeNull());
        expect(listCalls(), "押していないのに取り直している").toHaveLength(1);
    });

    // 札は使ったら下ろす（2回目に開いて閉じただけで取り直さない）
    it("一度取り直したら、次に閉じたときは取り直さない", async () => {
        await blockFromViewer();
        await closeViewer();
        await waitFor(() => expect(listCalls()).toHaveLength(2));

        fireEvent.click(await screen.findByRole("button", { name: "自分のストーリーを見る" }));
        await closeViewer();
        await waitFor(() => expect(screen.queryByLabelText("届いたリアクション・返信を見る")).toBeNull());
        expect(listCalls(), "札を下ろしていない").toHaveLength(2);
    });
});
