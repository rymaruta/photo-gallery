import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 遅い回線で /admin/edit?id=A を開き、戻って B を開くと、A の応答が
// 後から届く。中断ガードが無かった頃はフォームが A の内容で埋まり、
// URL と photoId は B のままだったので、保存すると
// **B の写真に A のタイトル・説明・タグ・撮影日・公開状態が書き込まれた**。
//
// 直したのは中断ガード1つだけ。「保存時に photoId とフォームの出どころを
// 突き合わせる」二重の守りも書いてみたが、UI から到達できないので入れていない
// （写真を切り替えると取得の開始と同時にスピナーへ変わり、保存ボタンが消える）。

const mockAuthFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

// vi.mock のファクトリはホイストされるので、可変の値は vi.hoisted の箱に入れる
const q = vi.hoisted(() => ({ id: "A" as string | null }));

// router は**同じオブジェクトを返す**。本物の Next.js は安定した参照を返すが、
// 毎回新しく作ると取得の effect の deps が毎描画で変わって回り続け、
// テストがモックの作りのせいで落ちる。
const stableRouter = { push: mockPush, replace: vi.fn(), back: vi.fn() };
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? q.id : null) }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({ authenticatedFetch: mockAuthFetch }));

const EditPage = (await import("../page")).default;

const photo = (id: string, title: string) => ({
    // 実データと同じ {en, ja} 順（DDB を通ると順番が変わる）
    id, src: `https://cdn/${id}.jpg`, title: { en: `${id} title`, ja: title },
    description: { en: [`${id} desc`], ja: [`${id}の説明`] },
    location: `${id}の場所`, category: "風景", date: "2024-10-12T00:00:00.000Z",
    tags: [`${id}タグ`], published: true, exif: {},
});
const ALL = [photo("A", "Aのタイトル"), photo("B", "Bのタイトル")];

/** 解決を手元で握る応答 */
function deferred() {
    let resolve!: (v: unknown) => void;
    const promise = new Promise<unknown>((r) => { resolve = r; });
    return { promise, resolve };
}

// **応答は「何回目の呼び出しか」ではなく「呼ばれた時点の ?id」で決める。**
// 呼び出し順のキューにすると、effect が想定より多く走った回に別の理由で
// 落ち（あるいは通り）、テストが実装ではなくモックを測ることになる。
const holds = new Map<string, ReturnType<typeof deferred>>();

beforeEach(() => {
    mockShowToast.mockReset();
    mockPush.mockReset();
    holds.clear();
    q.id = "A";
    mockAuthFetch.mockReset().mockImplementation(
        (_url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
            }
            const held = q.id ? holds.get(q.id) : undefined;
            if (held) return held.promise;               // この id の取得は止めておく
            return Promise.resolve({ ok: true, json: async () => ALL });
        },
    );
});

const putCalls = () => mockAuthFetch.mock.calls.filter(
    (c) => (c[1] as { method?: string } | undefined)?.method === "PUT");

describe("/admin/edit: 遅れて届いた別の写真の応答", () => {
    it("切り替えたあとに届いた古い応答でフォームを埋めない", async () => {
        const slowA = deferred();
        holds.set("A", slowA);

        const { rerender } = render(<EditPage />);
        // A の取得が「動的 import を終えて fetch を掴んだ」ところまで進める。
        // ここを待たずに切り替えると、A の import が解決する前に B の effect が
        // 走り、モジュールの読み込み待ちが噛み合わずテストが実装を測れない。
        await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());

        // B に切り替える。こちらはすぐ返る
        q.id = "B";
        rerender(<EditPage />);
        await screen.findByDisplayValue("Bのタイトル");

        // ここで A の応答がようやく届く
        slowA.resolve({ ok: true, json: async () => ALL });
        await new Promise((r) => setTimeout(r, 0));

        // フォームは B のまま。A の内容に置き換わらない
        expect(screen.getByDisplayValue("Bのタイトル")).toBeTruthy();
        expect(screen.queryByDisplayValue("Aのタイトル")).toBeNull();
    });

    it("読み込めていれば普通に保存できる（変えた項目が正しい写真へ届く）", async () => {
        render(<EditPage />);
        const input = await screen.findByDisplayValue("Aのタイトル");
        await userEvent.clear(input);
        await userEvent.type(input, "直したタイトル");

        await userEvent.click(screen.getByRole("button", { name: /保存/ }));

        await waitFor(() => expect(putCalls()).toHaveLength(1));
        const [url, init] = putCalls()[0] as [string, { body: string }];
        expect(url).toBe("/photos/A");
        expect(JSON.parse(init.body).title.ja).toBe("直したタイトル");
        // 触っていない項目は送らない（別タブの編集を消さないため）
        expect(JSON.parse(init.body)).not.toHaveProperty("location");
    });
});

// 素の文字列 title/description は「日本語のみ・英語版なし」。以前は
// 読み込みで ja/en 両方の欄に同じ文字列が入り、保存で en に日本語が
// 焼き込まれた（/user/edit の mergeLocalizedTitle は守っている——対の乖離）。
describe("素の文字列タイトルを en に複製しない", () => {
    it("読み込んでそのまま保存しても、en に日本語が入らない", async () => {
        const stringPhoto = {
            id: "A", src: "https://cdn/A.jpg",
            title: "夕焼けの湖",                       // 素の文字列
            description: "湖畔にて。",                  // 素の文字列
            location: "山中湖", category: "風景",
            date: "2024-10-12", tags: [], published: true, exif: {},
        };
        mockAuthFetch.mockImplementation((_url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
            return Promise.resolve({ ok: true, json: async () => [stringPhoto] });
        });

        render(<EditPage />);
        await screen.findByDisplayValue("夕焼けの湖");

        await userEvent.click(screen.getByRole("button", { name: /保存/ }));
        await waitFor(() => expect(putCalls()).toHaveLength(1));

        const body = JSON.parse((putCalls()[0][1] as { body: string }).body) as {
            title?: { ja: string; en: string };
            description?: { ja: string[]; en: string[] };
        };
        // 素の文字列 → {ja, en:""} は「値が変わっていない」と見なされ、
        // そもそも送られない（＝ en に日本語が焼き込まれる余地が無い）。
        // 送る場合でも en は空でなければならない。
        expect(body.title?.en ?? "").toBe("");
        expect(body.description?.en ?? []).toEqual([]);
        expect(body.title?.ja ?? "夕焼けの湖").toBe("夕焼けの湖");
    });
});
