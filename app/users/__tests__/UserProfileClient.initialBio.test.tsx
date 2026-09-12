import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * **自己紹介が、JS が走る前の本文に1文字も出ていなかった。**
 *
 * 実測（実ビルド・`/users/<id>`）: 静的本文は**131文字**（見出しと `…` だけ）。
 * 自己紹介は `<head>` の `description` と JSON-LD には出ているのに、本文には
 * 無かった——本人が書いた唯一の自己記述で、索引に載るページなのに。
 * ビルド時に `app/data/profiles.json` で分かっているので、`initialBio` で渡す。
 */

const profileResponse = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(() => new Promise(() => { })),
    publicFetch: vi.fn(() => new Promise(() => { })),
    userPublicFetch: vi.fn((path: string) => {
        if (String(path).includes("/profile/")) {
            if (profileResponse.current === null) return new Promise(() => { });
            return Promise.resolve({ ok: true, status: 200, json: async () => profileResponse.current });
        }
        return new Promise(() => { });
    }),
}));
vi.mock("../../components/GalleryGrid", () => ({ default: () => <div>grid</div> }));
vi.mock("../../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../components/FollowButton", () => ({ default: () => null, FollowAction: () => null, FollowCounts: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const UserProfileClient = (await import("../UserProfileClient")).default;

beforeEach(() => {
    profileResponse.current = null;
    window.history.replaceState({}, "", "/users?id=someone");
});

describe("ビルド時の自己紹介を、届く前に出す", () => {
    it("応答が返る前でも自己紹介が本文に出る", async () => {
        render(<UserProfileClient userId="someone" initialBio="旅先の光を追いかけて写真を撮っています。" />);
        expect(await screen.findByText("旅先の光を追いかけて写真を撮っています。")).toBeTruthy();
    });

    it("渡されなければ何も出ない（クエリ版のページ）", async () => {
        render(<UserProfileClient userId="someone" />);
        await waitFor(() => expect(document.querySelector(".tabular-nums")).toBeTruthy());
        expect(document.body.textContent).not.toContain("旅先の光");
    });

    // **届いたら控えは使わない。** ここが `?? initialBio` だと、自己紹介を
    // **消した**人の画面にビルド時の古い自己紹介が次のビルドまで残る
    // （消す操作が効かなく見える）
    it("自己紹介を消した人には、古い控えを出さない", async () => {
        profileResponse.current = { userId: "someone", displayName: "誰か" };
        render(<UserProfileClient userId="someone" initialBio="もう消した自己紹介" />);
        await waitFor(() => expect(document.body.textContent).toContain("誰か"));
        expect(document.body.textContent, "消したはずの自己紹介が残っている").not.toContain("もう消した自己紹介");
    });

    it("届いた自己紹介で置き換わる", async () => {
        profileResponse.current = { userId: "someone", displayName: "誰か", bio: "いまの自己紹介" };
        render(<UserProfileClient userId="someone" initialBio="ビルド時の自己紹介" />);
        expect(await screen.findByText("いまの自己紹介")).toBeTruthy();
        expect(document.body.textContent).not.toContain("ビルド時の自己紹介");
    });
});
