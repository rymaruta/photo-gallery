import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// 応答が返らない回線で、他人のプロフィールが「**0投稿・0いいね**」と言い切っていた
// （実測: 5秒・20秒・45秒のいずれでも同じ）。同じ画面の写真グリッドは
// `photosResolved` で、フォロー数は `countsKnown` で守られているのに、
// 数字のピルだけ素通しだった。ビルド後に登録した人（定期ビルドは週1なので
// 最大7日）のプロフィールが該当する。

vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    // **返らない回線**（失敗ではない。返事が来ない）
    userFetch: vi.fn(() => new Promise(() => {})),
    publicFetch: vi.fn(() => new Promise(() => {})),
    userPublicFetch: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../components/GalleryGrid", () => ({ default: () => <div>grid</div> }));
vi.mock("../../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../components/FollowButton", () => ({ default: () => null, FollowAction: () => null, FollowCounts: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const UserProfileClient = (await import("../UserProfileClient")).default;

beforeEach(() => { window.history.replaceState({}, "", "/users?id=someone"); });

describe("応答が返らないプロフィール", () => {
    it("投稿数・いいね数を 0 と言い切らない", async () => {
        render(<UserProfileClient userId="someone" />);
        // 「投稿」はタブにも出るので、数字のピル（`tabular-nums` の隣）で見る
        await waitFor(() => expect(document.querySelector(".tabular-nums")).toBeTruthy());
        const nums = [...document.querySelectorAll(".tabular-nums")].map((n) => n.textContent);
        const posts = nums[0];
        const likes = nums[1];
        expect(posts, "届く前に「0投稿」と言っている").toBe("…");
        expect(likes, "届く前に「0いいね」と言っている").toBe("…");
    });
});
