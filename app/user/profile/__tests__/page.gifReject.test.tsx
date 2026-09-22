import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **GIF は選んだ時点で断る。**
// `toUploadSafeFile` は GIF を必ず `UnstrippableFileError` にするので、
// 進めても必ず失敗する——プレビューが一瞬出てから断られる形だった。
// アップロード画面（アイコン）とストーリーは選択時に断っているのに、
// **カバーとアバターの2か所だけ**残っていた。
//
// 直したのに**テストを1本も足しておらず**、2か所とも削除する変異が
// 4,249件すべて緑だった（レビューが実証）。

const mockShowToast = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockSafe = vi.hoisted(() => vi.fn(async (f: File) => f));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: (...a: unknown[]) => mockSafe(...(a as [File])),
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512, COVER_MAX_PX: 1280,
}));

const ProfilePage = (await import("../page")).default;

const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは" };
const gif = () => new File(["x"], "cat.gif", { type: "image/gif" });
const jpg = () => new File(["x"], "cat.jpg", { type: "image/jpeg" });
const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
    mockShowToast.mockReset();
    mockSafe.mockReset().mockImplementation(async (f: File) => f);
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => STORED });
});

/**
 * ファイル入力を引く。**ラベルが無い**——`className="hidden"` で、見えている
 * ボタンが ref 経由で開く作り。**カバー写真の欄は 2026-09-22 に外した**
 * （マイページがカバーを出さなくなったので）ので、残るのはアバターだけ。
 * **本数が変わったら気づけるように**数も見る
 */
async function pickInto(file: File) {
    const { container } = render(<ProfilePage />);
    await screen.findByDisplayValue("こんにちは");
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs.length, "ファイル入力の本数が変わった（前提が崩れている）").toBe(1);
    await userEvent.upload(inputs[0], file);
}

describe("プロフィールのアバター: GIF は選んだ時点で断る", () => {
    it("アバターに GIF を選ぶと、その場で断る", async () => {
        await pickInto(gif());
        await waitFor(() => expect(toasts().length, "無言で進んでいる").toBeGreaterThan(0));
        expect(toasts()[0]).toMatch(/GIF/);
        // **上げに行かない**（presign も呼ばない）
        expect(mockUserFetch.mock.calls.some((c) => String(c[0]).includes("presign")),
            "断ったのに上げに行っている").toBe(false);
        expect(mockSafe, "断ったのに下ごしらえまで進んでいる").not.toHaveBeenCalled();
    });

    // **正当な形式は今までどおり通す**（断りすぎていないこと）
    it("JPEG は断らない", async () => {
        await pickInto(jpg());
        await waitFor(() => expect(mockSafe, "正当な画像まで断っている").toHaveBeenCalled());
        expect(toasts().some((t) => /GIF/.test(t))).toBe(false);
    });
});
