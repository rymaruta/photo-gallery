import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// /admin/edit に入れた中断ガードが、同じ形の /user/edit には無かった。
// 遅い回線で下書き A を開いて戻り B を開くと、A の応答が後から届いて
// フォームが A の内容で埋まる。save() は現在の photoId（= B）を送るので、
// **B の写真に A のタイトル・説明・タグ・撮影日が上書き保存される**。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ id: "A" as string | null }));

const stableRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? q.id : null) }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
// readApiError と AUTH_REQUIRED_MESSAGE は**本物を使う**。保存の失敗経路が
// サーバーの文言をそのまま出すようになったので、差し替えると
// 「文言が届くか」を確かめられないうえ、export が無いと実行時に落ちる。
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return {
        ...actual,
        userFetch: mockUserFetch,
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const photo = (id: string, title: string) => ({
    id, src: `https://cdn/${id}.jpg`, title, description: `${id}の説明`,
    location: `${id}の場所`, category: "風景", date: "2024-10-12T00:00:00.000Z",
    tags: [`${id}タグ`], published: false,
});
const ALL = [photo("A", "Aのタイトル"), photo("B", "Bのタイトル")];

function deferred() {
    let resolve!: (v: unknown) => void;
    const promise = new Promise<unknown>((r) => { resolve = r; });
    return { promise, resolve };
}

// 応答は「何回目の呼び出しか」ではなく「呼ばれた時点の ?id」で決める
const holds = new Map<string, ReturnType<typeof deferred>>();

beforeEach(() => {
    mockShowToast.mockReset();
    holds.clear();
    q.id = "A";
    mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) => {
        if (init?.method === "PUT" || init?.method === "PATCH" || init?.method === "POST") {
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        }
        const held = q.id ? holds.get(q.id) : undefined;
        if (held) return held.promise;
        return Promise.resolve({ ok: true, json: async () => ALL });
    });
});

describe("/user/edit: 遅れて届いた別の写真の応答", () => {
    it("切り替えたあとに届いた古い応答でフォームを埋めない", async () => {
        const slowA = deferred();
        holds.set("A", slowA);

        const { rerender } = render(<EditPage />);
        // A の取得が動的 import を終えて fetch を掴むところまで進める
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        q.id = "B";
        rerender(<EditPage />);
        await screen.findByDisplayValue("Bのタイトル");

        // ここで A の応答がようやく届く
        slowA.resolve({ ok: true, json: async () => ALL });
        await new Promise((r) => setTimeout(r, 0));

        expect(screen.getByDisplayValue("Bのタイトル")).toBeTruthy();
        expect(screen.queryByDisplayValue("Aのタイトル")).toBeNull();
        expect(screen.queryByDisplayValue("Aの場所")).toBeNull();
    });

    it("普通に開けば内容が入る（今までの動きを壊していない）", async () => {
        render(<EditPage />);
        expect(await screen.findByDisplayValue("Aのタイトル")).toBeTruthy();
        expect(screen.getByDisplayValue("Aの場所")).toBeTruthy();
    });
});

// 開いた時点の全項目を毎回送っていたので、同じ写真を2タブで開いて
// 片方で直したあと、もう片方で保存すると**先の編集が黙って消えた**
// （サーバーは部分更新だが、こちらが全部送れば同じこと。写真の更新には
// プロフィールのような rev が無い）。変えた項目だけを送る。
describe("/user/edit: 変えた項目だけ送る（別タブの編集を消さない）", () => {
    // 共有の ALL は date が "…T00:00:00.000Z"（旧仕様の捏造した0時）なので、
    // 保存すると C-12 の移行で date が必ず差分になる。ここでは移行と
    // 「触っていない項目を送らない」を分けて見たいので、本物の時刻を持つ
    // 写真を使う。
    const REAL = [{
        // 実データと同じ {en, ja} 順（JSON 文字列比較では毎回差分に化けていた形）
        id: "A", src: "https://cdn/A.jpg",
        title: { en: "A title", ja: "Aのタイトル" },
        description: { en: ["A desc"], ja: ["Aの説明"] },
        location: "Aの場所", category: "風景", date: "2024-10-12T08:30:00.000Z",
        tags: ["Aタグ"], published: false,
    }];
    const useRealPhoto = () => {
        mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
            return Promise.resolve({ ok: true, json: async () => REAL });
        });
    };
    const putBody = () => {
        const put = mockUserFetch.mock.calls.find(
            (c) => (c[1] as { method?: string } | undefined)?.method === "PUT");
        return JSON.parse((put![1] as { body: string }).body) as Record<string, unknown>;
    };
    const saveDraft = async () => {
        await userEvent.click(screen.getByRole("button", { name: /下書き|保存/ }));
        await waitFor(() => expect(mockUserFetch.mock.calls.some(
            (c) => (c[1] as { method?: string } | undefined)?.method === "PUT")).toBe(true));
    };

    it("何も触らずに保存したら published しか送らない", async () => {
        useRealPhoto();
        render(<EditPage />);
        await screen.findByDisplayValue("Aのタイトル");

        await saveDraft();
        expect(Object.keys(putBody()).sort()).toEqual(["published"]);
    });

    it("タイトルだけ直したら title と published だけ送る", async () => {
        useRealPhoto();
        render(<EditPage />);
        const input = await screen.findByDisplayValue("Aのタイトル");
        await userEvent.clear(input);
        await userEvent.type(input, "新しいタイトル");

        await saveDraft();
        const body = putBody();
        expect(Object.keys(body).sort()).toEqual(["published", "title"]);
        // 英語側は保ったまま日本語だけ差し替える（mergeLocalizedTitle）
        expect(body.title).toEqual({ ja: "新しいタイトル", en: "A title" });
        // 触っていない項目は送らない＝サーバーは触らない
        expect(body).not.toHaveProperty("location");
        expect(body).not.toHaveProperty("tags");
        expect(body).not.toHaveProperty("date");
    });

    it("旧仕様の0時ちょうどは、触っていなくても日付だけに直して送る（C-12 の移行）", async () => {
        render(<EditPage />);   // 共有 ALL は date が "…T00:00:00.000Z"
        await screen.findByDisplayValue("Aのタイトル");

        await saveDraft();
        const body = putBody();
        expect(body.date).toBe("2024-10-12");
    });
});
