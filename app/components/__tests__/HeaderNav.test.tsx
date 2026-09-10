import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

// ロールごとの認証状態を切り替えられるモック
const authState = vi.hoisted(() => ({
    current: {
        isAuthenticated: false,
        isAdminUser: false,
        isGeneralUser: false,
        userId: null as string | null,
        loading: false,
        logout: vi.fn(),
    },
}));

vi.mock("../../auth/context", () => ({
    useAuth: () => authState.current,
}));

vi.mock("../../i18n/context", () => ({
    useLocale: () => ({ labels: { navigation: {} } }),
}));

const mockPush = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush }),
    usePathname: () => pathname.current,
}));

import HeaderNav from "../HeaderNav";

function setRole(role: "anonymous" | "general" | "admin") {
    authState.current = {
        isAuthenticated: role !== "anonymous",
        isAdminUser: role === "admin",
        isGeneralUser: role === "general",
        userId: role === "anonymous" ? null : "user-1",
        loading: false,
        logout: vi.fn(),
    };
}

async function openMenu() {
    fireEvent.click(screen.getByLabelText("メニューを開く"));
}

function menuItems(): string[] {
    return screen.getAllByRole("listitem").map((li) => li.textContent?.trim() ?? "");
}

beforeEach(() => {
    mockPush.mockReset();
});

describe("HeaderNav - ロール別のメニュー表示", () => {
    it("未ログイン: 公開項目とログインのみ（管理・マイページ・アップロードは出ない）", async () => {
        setRole("anonymous");
        render(<HeaderNav />);
        await openMenu();
        const items = menuItems();
        expect(items).toContain("Login");
        expect(items).not.toContain("Manage");
        expect(items).not.toContain("My Page");
        expect(items).not.toContain("Upload");
        expect(items).not.toContain("Logout");
    });

    it("一般ユーザー: マイページ・ログアウトは出るが管理は出ない", async () => {
        setRole("general");
        render(<HeaderNav />);
        await openMenu();
        const items = menuItems();
        expect(items).toContain("My Page");
        expect(items).toContain("Logout");
        expect(items).not.toContain("Manage");
        expect(items).not.toContain("Login");
        // プロフィール編集はマイページ/ヘッダーアバターへ集約したためメニューからは除外
        expect(items).not.toContain("Profile");
        // アップロードはマイページの「写真を追加」に集約したためメニューからは除外
        expect(items).not.toContain("Upload");
    });

    it("管理者: 管理メニューが表示される", async () => {
        setRole("admin");
        render(<HeaderNav />);
        await openMenu();
        expect(menuItems()).toContain("Manage");
    });

    it("マイページは自分の userId のプロフィールURLに遷移する", async () => {
        setRole("general");
        render(<HeaderNav />);
        await openMenu();
        fireEvent.click(screen.getByText("My Page"));
        expect(mockPush).toHaveBeenCalledTimes(1);
        const dest = mockPush.mock.calls[0][0] as string;
        expect(dest === "/users/user-1" || dest === "/users?id=user-1").toBe(true);
    });

    it("メニュー開閉が動作する", async () => {
        setRole("anonymous");
        render(<HeaderNav />);
        expect(screen.queryByRole("dialog")).toBeNull();
        await openMenu();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("ログイン中はヘッダーのアバターからマイページへ直行できる", () => {
        setRole("general");
        render(<HeaderNav />);
        const avatarBtn = screen.getByLabelText("My Page");
        fireEvent.click(avatarBtn);
        expect(mockPush).toHaveBeenCalledTimes(1);
        const dest = mockPush.mock.calls[0][0] as string;
        expect(dest === "/users/user-1" || dest === "/users?id=user-1").toBe(true);
    });

    it("未ログインではヘッダーにアバターを出さない", () => {
        setRole("anonymous");
        render(<HeaderNav />);
        expect(screen.queryByLabelText("My Page")).toBeNull();
    });
});

// メニューが「反応しなくなる」回帰を毎回捕まえるための専用テスト。
// ハンバーガーの開閉・各種クローズ経路・遷移・スクロールロックを網羅する。
describe("HeaderNav - メニュー開閉の回帰ガード", () => {
    beforeEach(() => {
        setRole("general");
        document.body.style.overflow = "";
    });

    it("ハンバーガーで開いて、もう一度押すと閉じる（トグルが効く）", () => {
        render(<HeaderNav />);
        // 初期は閉じている
        expect(screen.getByLabelText("メニューを開く")).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("dialog")).toBeNull();

        // 開く
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        const closeBtn = screen.getByLabelText("メニューを閉じる");
        expect(closeBtn).toHaveAttribute("aria-expanded", "true");

        // 同じボタンで閉じる
        fireEvent.click(closeBtn);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByLabelText("メニューを開く")).toHaveAttribute("aria-expanded", "false");
    });

    it("背景（バックドロップ）タップで閉じる", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        const dialog = screen.getByRole("dialog");
        // 最初の子要素がバックドロップ
        fireEvent.click(dialog.firstElementChild as Element);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("Escape キーで閉じる", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("メニュー項目を押すと遷移し、メニューが閉じる", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        const dialog = screen.getByRole("dialog");
        fireEvent.click(within(dialog).getByText("My Page"));
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    // **ロックは共通実装（`lib/utils/scrollLock.ts`）に寄せた。**
    // 自前の `overflow` だけでは iOS Safari や内蔵ブラウザで背景が動く、と
    // 共通実装のコメントが書いている。位置の復元と入れ子の数え上げも要る。
    it("ロックは position:fixed まで掛ける（overflow だけにしない）", () => {
        setRole("general");
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));

        expect(document.body.style.position, "overflow だけのロックに戻っている").toBe("fixed");

        fireEvent.click(screen.getByLabelText("メニューを閉じる"));
        expect(document.body.style.position).toBe("");
    });

    it("開くと body のスクロールがロックされ、閉じると解除される", () => {
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        expect(document.body.style.overflow).toBe("hidden");
        fireEvent.click(screen.getByLabelText("メニューを閉じる"));
        expect(document.body.style.overflow).toBe("");
    });

    it("ハンバーガーボタンは常に表示され、ラベルが状態に追従する", () => {
        render(<HeaderNav />);
        const btn = screen.getByLabelText("メニューを開く");
        expect(btn).toBeInTheDocument();
        fireEvent.click(btn);
        expect(screen.getByLabelText("メニューを閉じる")).toBeInTheDocument();
    });
});

// `loading` を受け取っているのに使っておらず、Cognito のセッション確認が
// 終わる前は isAuthenticated が false なので、**ログイン済みの人にも一瞬
// 「ログイン / 新規登録」が並んでいた**。押すとログイン済みのまま
// ログイン画面に飛ぶ。
describe("認証状態が分かるまで", () => {
    it("判定中はログイン/新規登録もログアウトも出さない", () => {
        authState.current = { ...authState.current, isAuthenticated: false, loading: true };
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText(/メニュー|Menu/i));

        expect(screen.queryByRole("button", { name: /Login|ログイン/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Sign up|新規登録/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Logout|ログアウト/ })).toBeNull();
    });

    it("判定が終われば従来どおり出し分ける", () => {
        authState.current = { ...authState.current, isAuthenticated: false, loading: false };
        const { unmount } = render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText(/メニュー|Menu/i));
        expect(screen.getByRole("button", { name: /Login|ログイン/ })).toBeInTheDocument();
        unmount();

        authState.current = { ...authState.current, isAuthenticated: true, loading: false };
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText(/メニュー|Menu/i));
        expect(screen.getByRole("button", { name: /Logout|ログアウト/ })).toBeInTheDocument();
    });
});

// パネルは createPortal(..., document.body) で body の末尾に出るので、
// DOM 順は**ページの一番最後**。開いてから Tab を押すと、フォーカスは
// メニューではなくその下の本文へ進み、トップページなら数十個のリンクと
// フッターを通り抜けないと「マイページ」に届かなかった（＝開いても入れない）。
describe("HeaderNav: 開いたらメニューの中へ入れる", () => {
    it("開くとメニュー内の最初の項目にフォーカスが移る", async () => {
        render(<HeaderNav />);
        const toggle = screen.getByLabelText("メニューを開く");
        fireEvent.click(toggle);

        const panel = await screen.findByRole("dialog");
        const first = panel.querySelector<HTMLElement>('a[href], button:not([disabled])');
        expect(first).not.toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(first));
    });

    // 戻さないとフォーカスが body に落ち、次の Tab がページ先頭からになる
    it("閉じたら開いたボタンへフォーカスが戻る", async () => {
        render(<HeaderNav />);
        const toggle = screen.getByLabelText("メニューを開く");
        fireEvent.click(toggle);
        await screen.findByRole("dialog");

        // 開いているときはラベルが変わる
        fireEvent.click(screen.getByLabelText("メニューを閉じる"));
        await waitFor(() => expect(document.activeElement).toBe(toggle));
    });
});

// ヘッダーはルートレイアウトにあるのでクライアント遷移では再マウント
// されない。`open` を戻すのはリンク・Escape・× の3つだけで、**戻る・進む**
// では背後のページだけが変わり、オーバーレイと `body` のスクロールロックが
// 残っていた（スマホの「戻る＝閉じる」と逆に、遷移だけが起きる）。
describe("画面が変わったらメニューを閉じる", () => {
    it("戻る・進むでパスが変われば閉じる（body のロックも戻る）", () => {
        setRole("general");
        pathname.current = "/";
        const { rerender } = render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(document.body.style.overflow).toBe("hidden");

        // ブラウザの戻る＝パスだけが変わる（再マウントはされない）
        pathname.current = "/users";
        rerender(<HeaderNav />);

        expect(screen.queryByRole("dialog"), "遷移してもメニューが開いたまま").toBeNull();
        expect(document.body.style.overflow, "スクロールロックが残っている").toBe("");
    });

    // **ここは自分が入れた回帰。** `open = openedAt === pathname` は
    // 「画面が変わったら閉じる」ではなく「**そのパスに居る間ずっと開いている**」
    // という意味になる。閉じる操作を経ずに離れると `openedAt` が残り、
    // 戻ってきた瞬間に**触っていないのに開き直す**（スクロールロックも
    // かかり、フォーカスもメニューへ攫われる）。
    it("離れて戻ってきても、開き直さない", () => {
        setRole("general");
        pathname.current = "/";
        const { rerender } = render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        pathname.current = "/photo/x";      // 戻る
        rerender(<HeaderNav />);
        expect(screen.queryByRole("dialog")).toBeNull();

        pathname.current = "/";             // 進む（または同じ画面へ戻る）
        rerender(<HeaderNav />);
        expect(screen.queryByRole("dialog"), "触っていないのにメニューが開いた").toBeNull();
        expect(document.body.style.overflow, "スクロールロックが復活した").toBe("");
    });

    // **クエリだけ変わる移動もある。** `/users?id=A` → `?id=B`（プロフィールの
    // 行き来）や `/user/edit?id=` は `usePathname` が変わらないので、上の
    // 調整は効かない——メニューも `body` のロックも残ったまま、背後だけが
    // 新しいプロフィールに変わる。`useSearchParams` はルートレイアウトで
    // 使うと静的書き出し全体に響くので、履歴の移動そのものを聞く。
    it("クエリだけ変わる戻る・進むでも閉じる", () => {
        setRole("general");
        pathname.current = "/users";
        render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(document.body.style.overflow).toBe("hidden");

        // 戻る（/users?id=B → /users?id=A）。パスは同じ
        fireEvent.popState(window, { state: null });

        expect(screen.queryByRole("dialog"), "クエリだけの移動でメニューが残っている").toBeNull();
        expect(document.body.style.overflow, "スクロールロックが残っている").toBe("");
    });

    // 閉じているときの戻る・進むは何もしない（開くほうへ倒さない）
    it("閉じているときの戻る・進むでは何も起きない", () => {
        setRole("general");
        pathname.current = "/users";
        render(<HeaderNav />);
        fireEvent.popState(window, { state: null });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.body.style.overflow).toBe("");
    });

    it("メニューを開いただけでは閉じない（パスは変わらない）", () => {
        setRole("general");
        pathname.current = "/";
        const { rerender } = render(<HeaderNav />);
        fireEvent.click(screen.getByLabelText("メニューを開く"));
        rerender(<HeaderNav />);   // 同じパスでの再描画
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
});

// 撮影地マップ（/map）は**公開の入口**なので、ログイン状態に関係なく出す。
// 他の項目はロールで出し分けているので、条件の書き間違いで
// 「ログインした人にだけ地図が出る」形になっても他のテストは通る。
describe("HeaderNav - 撮影地マップ", () => {
    it.each(["anonymous", "general", "admin"] as const)("%s にも出て、/map へ移動する", async (role) => {
        setRole(role);
        render(<HeaderNav />);
        await openMenu();
        expect(menuItems()).toContain("Map");
        fireEvent.click(screen.getByRole("button", { name: "Map" }));
        expect(mockPush).toHaveBeenCalledWith("/map");
    });
});

// 共同アルバム（案C）は**招待リンクを配る側の画面**なので、ログイン中だけ。
// 未ログインに出すと、押した先が会員限定の案内になる（行き先の無い項目）。
describe("HeaderNav - 共同アルバム", () => {
    it("ログイン中は出て、/user/albums へ移動する", async () => {
        setRole("general");
        render(<HeaderNav />);
        await openMenu();
        expect(menuItems()).toContain("Shared Albums");
        fireEvent.click(screen.getByRole("button", { name: "Shared Albums" }));
        expect(mockPush).toHaveBeenCalledWith("/user/albums");
    });

    it("未ログインには出さない", async () => {
        setRole("anonymous");
        render(<HeaderNav />);
        await openMenu();
        expect(menuItems(), "行き先の無い項目を出している").not.toContain("Shared Albums");
    });

    // **画面と同じ条件で出す。** 行き先は `useMemberGate`（グループが要る）で
    // 守られているので、`isAuthenticated` だけで出すと、グループ未所属の人には
    // **押した先が会員限定の案内**になる（登録直後にトリガーが失敗した人）
    it("グループ未所属には出さない（押した先が会員限定の案内になる）", async () => {
        authState.current = {
            isAuthenticated: true, isAdminUser: false, isGeneralUser: false,
            userId: "user-1", loading: false, logout: vi.fn(),
        };
        render(<HeaderNav />);
        await openMenu();
        expect(menuItems(), "会員限定の案内に当たる項目を出している").not.toContain("Shared Albums");
    });

    it("管理者にも出る", async () => {
        setRole("admin");
        render(<HeaderNav />);
        await openMenu();
        expect(menuItems()).toContain("Shared Albums");
    });
});
