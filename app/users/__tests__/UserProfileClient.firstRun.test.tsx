import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **ビルド後に登録した人のプロフィールが、開いた瞬間「まだ写真がありません。」
// と言う。**
//
// `photos` の初期値はビルド時 JSON の絞り込みなので、その人の行が無ければ
// 必ず `[]` から始まる（新しい環境では全員がそう）。空表示の判定は
// `postCount === 0` だけで、「まだ来ていない」を表す状態が無かった。
// 本人が自分のページを開くと「最初の写真を投稿」の誘導まで一度出て消える。
//
// もう1つ、`if (photosRes.ok)` に **`else` が無かった**。500 や 403 が
// 返っても警告バーも再読込も出ず、上の空表示のまま。`loadError` は
// 3つの文言を持っているのに、`photos` を立てる経路が catch（回線断）に
// しか無かった——ビルド時のスナップショットを持たない人にとって、
// コメントの言う「失敗したら静的のまま」は**空のまま**を意味する。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// ビルド時のスナップショット（この人の写真が1枚載っている状態）。
// `vi.mock` の工場は巻き上げられるので、外の定数を参照しない
const OWNER = "22222222-2222-4222-8222-222222222222";
// **ビルド後に登録した人**なので、スナップショットに1枚も載っていない
vi.mock("../../data/photos.json", () => ({ default: [] }));

import UserProfileClient from "../UserProfileClient";

const EMPTY = "まだ写真がありません。";
const CTA = "最初の写真を投稿";
const PHOTOS_ERROR = "最新の写真を読み込めませんでした。";

/** 手で解決できる Promise（「まだ返ってきていない」を作る） */
function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);   // 訪問者（未ログイン）
});

describe("ビルド後に登録した人のプロフィール", () => {
    it("答えが返るまで「まだ写真がありません。」と言わない", async () => {
        const d = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
        mockPublicFetch.mockReturnValue(d.promise);

        render(<UserProfileClient userId={OWNER} />);
        await new Promise((r) => setTimeout(r, 20));

        expect(screen.queryByText(EMPTY), "届く前に「無い」と言っている").toBeNull();

        // 写真が返ってきたら、空の案内は出ないまま一覧になる
        d.resolve({
            ok: true,
            json: async () => [{
                id: "fresh-1", userId: OWNER, src: "https://cdn.example.com/uploads/b.jpg",
                title: "いま公開されている写真", category: "travel", tags: [],
                date: "2026-02-01", createdAt: "2026-02-01", published: true,
            }],
        });
        await waitFor(() => expect(screen.getByAltText("いま公開されている写真")).toBeInTheDocument());
        expect(screen.queryByText(EMPTY)).toBeNull();
    });

    // 本人には投稿の誘導まで出て消える（一番目につく形）。
    //
    // **オーナー判定が済むまで待ってから見る。** 先に書いた版は 20ms で
    // 測っていて、`isOwner` が立つ前に判定していた——**修正前の実装でも
    // 緑**だった（誘導は `isOwner` の内側にあるので、まだ出ていないだけ）。
    // プロフィールが描かれた時点で `isOwner` は確定している。
    it("答えが返るまで「最初の写真を投稿」も出さない", async () => {
        // **実装が読む形に合わせる。** `{ userId }` を返していたが、
        // 実装は `sessionResult.getIdToken().payload["sub"]` を読むので
        // 例外になり、外側の catch に飲まれて `isOwner` が立たなかった
        // ——修正前でも修正後でも緑になる、何も検証しないテストだった。
        mockGetCurrentSession.mockResolvedValue({
            getIdToken: () => ({ payload: { sub: OWNER } }),
        });
        const d = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
        mockUserFetch.mockReturnValue(d.promise);

        render(<UserProfileClient userId={OWNER} />);
        // ここまで来れば本人と分かっている（＝誘導を出す条件は揃っている）
        await waitFor(() => expect(screen.getByText("旅人")).toBeInTheDocument());

        expect(screen.queryByText(CTA), "写真の答えが返る前に投稿を促している").toBeNull();
    });

    // 正常系: 本当に0枚なら、答えが返ったあとに出す
    it("答えが「0枚」なら、そのあとで空の案内を出す", async () => {
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getByText(EMPTY)).toBeInTheDocument());
    });
});

describe("公開一覧の取得が HTTP で失敗したとき", () => {
    // **`else` が無かったので、ここは完全に無言だった**
    it("警告バーを出す（無言で「写真が無い人」にしない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => [] });

        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(
            screen.getByText(PHOTOS_ERROR, { exact: false }),
            "500 を無言で「0枚」にしている",
        ).toBeInTheDocument());
    });

    it("失敗しても画面は進む（空の案内は出す・黙って固まらない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: false, status: 503, json: async () => [] });
        render(<UserProfileClient userId={OWNER} />);
        await waitFor(() => expect(screen.getByText(EMPTY)).toBeInTheDocument());
    });
});
