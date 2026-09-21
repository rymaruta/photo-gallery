import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **保存された曲のアートワークを、そのまま読み込んでいた。**
//
// サーバーの許可リストは「これから保存する値」にしか効かない。許可リストを
// 入れる前に保存された曲は任意のホストのまま残りうる（`mediaHosts.ts`）。
// 公開側（`getPublicProfile`）は `withCheckedSongUrls` を通しているのに、
// **`GET /user/profile` は行をそのまま返す**——つまり本人の編集画面だけ
// サーバーの検査もクライアントの検査も両方無かった。開いただけで
// 任意のホストに IP・User-Agent・時刻が渡る。
//
// **落とすのは表示だけ。** 復元した値そのものを落とすと、保存の差分の
// 比較先に入って「利用者が消した」と読まれる（プロフィールの曲で一度
// 踏んだ形。`page.tsx` の 418・424 行がその値を保存の本文に載せる）。

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

// ブロック一覧は境界として外す（`GET /user/blocks` を勝手に呼ぶので、
// この画面の「何を送ったか」の数え上げに混ざる）。中身は
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({ userFetch: (...args: unknown[]) => mockUserFetch(...args) }));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error { },
    AVATAR_MAX_PX: 512,
    COVER_MAX_PX: 1280,
}));

const ProfilePage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });
const EVIL = "https://evil.example/art.jpg";
const GOOD = "https://is1-ssl.mzstatic.com/image/art.jpg";
const song = (artwork: string) => ({
    title: "曲名", artist: "だれか", artwork,
    previewUrl: "https://audio-ssl.itunes.apple.com/x.m4a",
    trackUrl: "https://music.apple.com/jp/album/1",
});
/** 描かれた <img> の src を全部集める */
const imgSrcs = () => Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"));

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
});

describe("プロフィール編集: 保存済みの曲のアートワーク", () => {
    it("許可ホスト以外は読み込まない", async () => {
        mockUserFetch.mockResolvedValue(ok({ userId: "u1", songs: [song(EVIL)] }));
        render(<ProfilePage />);

        await screen.findByText("曲名");
        expect(imgSrcs(), "許可していないホストを読み込んでいる").not.toContain(EVIL);
    });

    it("許可ホストはそのまま出す（壊していない）", async () => {
        mockUserFetch.mockResolvedValue(ok({ userId: "u1", songs: [song(GOOD)] }));
        render(<ProfilePage />);

        await screen.findByText("曲名");
        expect(imgSrcs(), "正当なアートワークまで消している").toContain(GOOD);
    });

    // **表示だけ落とす。** 復元した値を落とすと、触っていない曲が
    // 「消した」と読まれて保存で消える
    it("読み込まなかった曲も、保存の本文では元のまま", async () => {
        mockUserFetch
            .mockResolvedValueOnce(ok({ userId: "u1", bio: "こんにちは", songs: [song(EVIL)] }))
            .mockResolvedValue(ok({}));
        render(<ProfilePage />);

        const bio = await screen.findByDisplayValue("こんにちは");
        await userEvent.clear(bio);
        await userEvent.type(bio, "旅の記録");
        await userEvent.click(await screen.findByRole("button", { name: /保存/ }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());

        const puts = mockUserFetch.mock.calls.filter((c) => c[1]?.method === "PUT");
        const body = JSON.parse(puts[puts.length - 1][1].body as string) as Record<string, unknown>;
        // **この画面はプレイリストを毎回そのまま送る**（`songs` と、旧形式の
        // `songArtwork` などを `selectedSongs[0]` から組み立てる）。だから
        // 「表示のために落とした値」が保存の本文に混ざると、**触っていない曲が
        // 消える**。送る値は復元したときのまま＝落とす前でなければならない。
        // （許可外のホストはサーバー側の許可リストが保存時に落とす＝そこで掃除される）
        expect(body.songArtwork, "表示のために落とした値を保存してしまっている").toBe(EVIL);
        // `songs` はこの回では送られない——PUT は「変えた項目だけ」で、
        // プレイリストは触っていないため。`songArtwork` が本文に出るのは、
        // このフィクスチャが旧形式の項目を持たず「未設定 → EVIL」に見えるから。
        // 落とす実装だと "" になって差分が消え、この行ごと届かなくなる
    });
});
