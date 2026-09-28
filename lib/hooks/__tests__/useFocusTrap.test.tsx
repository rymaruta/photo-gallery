import React, { useRef } from "react";
import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

import { useFocusTrap, FOCUSABLE } from "../useFocusTrap";

// `aria-modal="true"` と言いながら Tab で外へ出られるモーダルが5つあった。
// オーバーレイの裏のボタンにフォーカスが行き、見えないまま Enter で
// 押せてしまう（/user/edit の確認シートの裏は「保存する」）。

function Fixture({ open }: { open: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useFocusTrap(open, ref);
    return (
        <div>
            <button>外1</button>
            {open && (
                <div ref={ref} role="dialog">
                    <button>中1</button>
                    <button>中2</button>
                </div>
            )}
            <button>外2</button>
        </div>
    );
}

const tab = (shift = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey: shift });

describe("useFocusTrap", () => {
    it("開いたら中の最初の要素へフォーカスが移る", () => {
        render(<Fixture open />);
        expect(document.activeElement).toBe(screen.getByText("中1"));
    });

    it("最後の要素から Tab すると先頭へ戻る（外へ出さない）", () => {
        render(<Fixture open />);
        screen.getByText("中2").focus();
        tab();
        expect(document.activeElement).toBe(screen.getByText("中1"));
    });

    it("先頭から Shift+Tab すると最後へ回る", () => {
        render(<Fixture open />);
        screen.getByText("中1").focus();
        tab(true);
        expect(document.activeElement).toBe(screen.getByText("中2"));
    });

    // ポータルで body の末尾に出るモーダルは、外から Tab で入ってくる
    it("外にフォーカスがある状態で Tab すると中へ引き戻す", () => {
        render(<Fixture open />);
        screen.getByText("外2").focus();
        tab();
        expect(document.activeElement).toBe(screen.getByText("中1"));
    });

    it("閉じている間は何もしない", () => {
        render(<Fixture open={false} />);
        screen.getByText("外2").focus();
        tab();
        expect(document.activeElement).toBe(screen.getByText("外2"));
    });

    // 戻さないとフォーカスが body に落ち、次の Tab がページ先頭からになる
    it("閉じたら開く前の要素へ戻す", () => {
        const { rerender } = render(<Fixture open={false} />);
        const opener = screen.getByText("外1");
        opener.focus();
        rerender(<Fixture open />);
        expect(document.activeElement).toBe(screen.getByText("中1"));

        rerender(<Fixture open={false} />);
        expect(document.activeElement).toBe(opener);
    });

    // autoFocus を使っているモーダル（退会確認）の指定を奪わない
    it("中に既にフォーカスがあれば動かさない", () => {
        function WithAutoFocus() {
            const ref = useRef<HTMLDivElement | null>(null);
            useFocusTrap(true, ref);
            return (
                <div ref={ref}>
                    <button>先頭</button>
                    <input autoFocus placeholder="確認" />
                </div>
            );
        }
        render(<WithAutoFocus />);
        expect(document.activeElement).toBe(screen.getByPlaceholderText("確認"));
    });
});

// HeaderNav は認証の判定中（Cognito のセッション確認）だと中身が空になる。
// そこで開くとフォーカスが移らず、「開いても入れない」が残っていた。
describe("useFocusTrap: 押せるものが1つも無いとき", () => {
    function Empty() {
        const ref = useRef<HTMLDivElement | null>(null);
        useFocusTrap(true, ref);
        return (
            <div>
                <button>外</button>
                <div ref={ref} role="dialog"><span aria-hidden>読み込み中</span></div>
            </div>
        );
    }

    it("容器そのものへフォーカスを入れる（外に置き去りにしない）", () => {
        render(<Empty />);
        const dialog = screen.getByRole("dialog");
        expect(document.activeElement).toBe(dialog);
        expect(dialog.tabIndex).toBe(-1);
    });

    // **ここが抜けていた。** `activeElement` と `tabIndex` しか見ていな
    // かったので、「容器へ入れる」分岐が Tab を1つも押さえていないことを
    // 通していた（`items.length === 0` で素通しに戻っていた）。
    // 押せるものが無くなるのは、削除中・退会処理中も同じ。
    it("押せるものが無くても Tab で外へ出さない", () => {
        render(<Empty />);
        const dialog = screen.getByRole("dialog");
        const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        expect(ev.defaultPrevented, "既定の Tab がそのまま通っている").toBe(true);
        expect(document.activeElement).toBe(dialog);
    });

    // **本当に効かせたいのはこちら。** 上のテストはマウント時点で既に
    // `activeElement === dialog` なので、Tab のあとに同じことを見ても差が
    // 出ない（容器へ入れ直す行を消しても緑のままだった）。
    //
    // 実際の場面は「押せる要素0 **かつ** フォーカスは外」——削除確認で
    // 「削除する」を押すと、フォーカスを持っていたキャンセルが disabled に
    // なってフォーカスが body に落ちる。そこから Tab を打つと裏の一覧へ
    // 抜けていく。
    it("外にフォーカスがある状態でも、押せるものが無ければ中へ引き戻す", () => {
        render(<Empty />);
        const dialog = screen.getByRole("dialog");
        screen.getByText("外").focus();
        expect(dialog.contains(document.activeElement)).toBe(false);

        const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(dialog);
    });
});

// メニューのように戻る先が1つに決まっているものは明示する。
// ブラウザの click はボタンにフォーカスも当てるが、それに寄りかかると
// 環境差で崩れる（jsdom の click は当てない）。
describe("useFocusTrap: 戻り先の指定", () => {
    function WithRestore({ open }: { open: boolean }) {
        const ref = useRef<HTMLDivElement | null>(null);
        const restore = useRef<HTMLButtonElement | null>(null);
        useFocusTrap(open, ref, restore);
        return (
            <div>
                <button ref={restore}>開くボタン</button>
                <button>別のボタン</button>
                {open && <div ref={ref}><button>中1</button></div>}
            </div>
        );
    }

    it("閉じたら指定した要素へ戻す（開く前の位置ではなく）", () => {
        const { rerender } = render(<WithRestore open={false} />);
        // わざと「別のボタン」にフォーカスを置いてから開く
        screen.getByText("別のボタン").focus();
        rerender(<WithRestore open />);
        expect(document.activeElement).toBe(screen.getByText("中1"));

        rerender(<WithRestore open={false} />);
        expect(document.activeElement).toBe(screen.getByText("開くボタン"));
    });
});

// GalleryModal は「前へ」ボタンを指名している。今はそれが DOM 順の先頭でも
// あるので、あちらのテストでは指名を無視する変異を捕まえられない
// （実際に変異させて確かめた）。**指名が効くこと自体はここで固定する。**
// これが無いと、将来ボタンの並びを変えたときに、初期フォーカスの位置が
// 誰にも気づかれずに動く。
describe("useFocusTrap: 最初に当てる要素の指定", () => {
    function Named() {
        const ref = useRef<HTMLDivElement | null>(null);
        const initial = useRef<HTMLButtonElement | null>(null);
        useFocusTrap(true, ref, undefined, initial);
        return (
            <div ref={ref}>
                <button>先頭</button>
                <button ref={initial}>指名された方</button>
                <button>末尾</button>
            </div>
        );
    }

    it("DOM 順の先頭ではなく、指名した要素へ入れる", () => {
        render(<Named />);
        expect(document.activeElement).toBe(screen.getByText("指名された方"));
    });
});

// **セレクタを import して使うテストだけだと、セレクタが痩せても落ちない。**
// テスト側の `items` も同じだけ痩せて、境界（先頭・末尾）が揃って動くだけ
// だから。実際 `audio[controls], iframe, ` を落としても28件すべて緑だった。
// ここは `FOCUSABLE` を通さず、**期待する要素をテスト側で数える**。
describe("メディア要素も巡回に入る（セレクタを通さずに数える）", () => {
    function Media() {
        const ref = useRef<HTMLDivElement | null>(null);
        useFocusTrap(true, ref);
        return (
            <div ref={ref} role="dialog">
                <button>ボタン</button>
                <video data-testid="v" controls />
                <audio data-testid="a" controls />
                <iframe data-testid="f" title="埋め込み" />
            </div>
        );
    }

    it("button / video[controls] / audio[controls] / iframe の4つが対象になる", () => {
        const { container } = render(<Media />);
        const dialog = container.querySelector('[role="dialog"]')!;
        // 期待する集合をテスト側で列挙する（実装のセレクタは参照しない）
        const expected = [
            dialog.querySelector("button"),
            dialog.querySelector("video"),
            dialog.querySelector("audio"),
            dialog.querySelector("iframe"),
        ];
        const matched = Array.from(dialog.querySelectorAll(FOCUSABLE));
        for (const el of expected) {
            expect(matched, `${el?.tagName} が巡回から外れている`).toContain(el);
        }
    });

    // `controls` の無いメディアは操作するものが無いので巡回に入れない
    // （StoryViewer の背景動画がこれ。入れると空のタブストップが増える）
    it("controls の無い video / audio は入れない", () => {
        function NoControls() {
            const ref = useRef<HTMLDivElement | null>(null);
            useFocusTrap(true, ref);
            return (
                <div ref={ref} role="dialog">
                    <button>ボタン</button>
                    <video data-testid="v" />
                    <audio data-testid="a" />
                </div>
            );
        }
        const { container } = render(<NoControls />);
        const dialog = container.querySelector('[role="dialog"]')!;
        const matched = Array.from(dialog.querySelectorAll(FOCUSABLE));
        expect(matched).not.toContain(dialog.querySelector("video"));
        expect(matched).not.toContain(dialog.querySelector("audio"));
        expect(matched).toContain(dialog.querySelector("button"));
    });
});

// **容器が「有効になったのと同じコミット」で付かない**ことがある
// （React が更新を分けたとき）。エフェクトの時点で ref が空だと
// 早期 return していたので、あとから容器が来てもトラップが二度と付かなかった
// ——deps は `[active, ...]` なので再実行されない。
// フルスイートを並列で回すと、ストーリーの下書きでこれが再現していた。
describe("容器があとから付いても閉じ込める", () => {
    function LateContainer({ mounted }: { mounted: boolean }) {
        const ref = useRef<HTMLDivElement | null>(null);
        // active は最初から true。容器だけ1コミット遅れて付く
        useFocusTrap(true, ref);
        return (
            <div>
                <button>外</button>
                {mounted && (
                    <div ref={ref} role="dialog">
                        <button>中1</button>
                        <button>中2</button>
                    </div>
                )}
            </div>
        );
    }

    it("あとから付いた容器でも Tab を止める", () => {
        // 1回目: active=true・容器なし（エフェクトはここで走る）
        const { rerender } = render(<LateContainer mounted={false} />);
        // 2回目: 容器が付く。deps は [active,...] なのでエフェクトは再実行されない
        rerender(<LateContainer mounted />);

        const dialog = screen.getByRole("dialog");
        screen.getByText("中2").focus();

        const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        expect(ev.defaultPrevented, "ハンドラが付いていない").toBe(true);
        expect(dialog.contains(document.activeElement)).toBe(true);
    });
});

// 早期 return を外したことで、**容器が一度も付かないまま閉じたとき**にも
// クリーンアップが走るようになった。そこで無条件に戻すと、フォーカスを
// 一度も動かしていないのに「ユーザーが今いる場所から奪う」——保険が
// 逆向きに倒れる形。容器があった時だけ戻す。
describe("容器が一度も付かなければ、閉じてもフォーカスを奪わない", () => {
    function NeverMounts({ active }: { active: boolean }) {
        const ref = useRef<HTMLDivElement | null>(null);
        const opener = useRef<HTMLButtonElement | null>(null);
        useFocusTrap(active, ref, opener);
        return (
            <div>
                <button ref={opener}>開く</button>
                <button>ほかの場所</button>
            </div>
        );
    }

    it("閉じても、そのとき触っていた要素にフォーカスが残る", () => {
        const { rerender } = render(<NeverMounts active />);
        const elsewhere = screen.getByText("ほかの場所");
        elsewhere.focus();
        expect(document.activeElement).toBe(elsewhere);

        rerender(<NeverMounts active={false} />);
        // 戻り先（開くボタン）へ飛ばされていないこと
        expect(document.activeElement, "容器が無いのに戻り先へフォーカスを奪った").toBe(elsewhere);
    });

    it("容器があるときは、これまでどおり戻り先へ戻す", () => {
        function WithContainer({ active }: { active: boolean }) {
            const ref = useRef<HTMLDivElement | null>(null);
            const opener = useRef<HTMLButtonElement | null>(null);
            return (
                <div>
                    <button ref={opener}>開く</button>
                    <Trap active={active} containerRef={ref} restoreRef={opener} />
                </div>
            );
        }
        function Trap({ active, containerRef, restoreRef }: {
            active: boolean;
            containerRef: React.RefObject<HTMLDivElement | null>;
            restoreRef: React.RefObject<HTMLButtonElement | null>;
        }) {
            useFocusTrap(active, containerRef, restoreRef);
            if (!active) return null;
            return (
                <div ref={containerRef} role="dialog">
                    <button>中</button>
                </div>
            );
        }

        const { rerender } = render(<WithContainer active />);
        expect(document.activeElement).toBe(screen.getByText("中"));
        rerender(<WithContainer active={false} />);
        expect(document.activeElement).toBe(screen.getByText("開く"));
    });
});

/**
 * **2つ同時に開いたとき、Tab を扱うのは最前面の1つだけ。**
 *
 * 写真の拡大表示（`?photo=`）の上に「はじめる前に」が出ると、両方が
 * document の keydown を聞いていて、Tab を押すたびに同意画面の先頭へ
 * 戻された——「同意してはじめる」にキーボードで届かなかった。
 */
function Trap({ open, label, children, priority }: { open: boolean; label: string; children?: React.ReactNode; priority?: number }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useFocusTrap(open, ref, undefined, undefined, priority);
    return open ? (
        <div ref={ref} role="dialog" aria-label={label}>
            <button>{label}1</button>
            {children}
            <button>{label}2</button>
        </div>
    ) : null;
}

describe("useFocusTrap: 2つ同時に開いたとき", () => {
    it("並んだ2つなら、後から開いた方の中を Tab で最後まで進める", () => {
        const { rerender } = render(<><Trap open label="下" /><Trap open={false} label="上" /></>);
        rerender(<><Trap open label="下" /><Trap open label="上" /></>);
        expect(document.activeElement).toBe(screen.getByText("上1"));
        // 先頭から次へは**既定の動き**に任せる（閉じ込めは端でしか止めない）。
        // 以前は下の閉じ込めが「中に居ない」と既定を止めて引き戻し、上がまた
        // 引き戻すので、**Tab が何も起こさなかった**（先頭から動けない）
        expect(tab(), "Tab の既定の動きを止めている（上の中を進めない）").toBe(true);
        screen.getByText("上2").focus();
        tab();   // 末尾から折り返す
        expect(document.activeElement, "上の閉じ込めの中で折り返していない").toBe(screen.getByText("上1"));
        screen.getByText("上1").focus();
        tab(true);
        expect(document.activeElement).toBe(screen.getByText("上2"));
    });

    it("最前面が閉じたら、下の閉じ込めがまた効く", () => {
        const { rerender } = render(<><Trap open label="下" /><Trap open label="上" /></>);
        rerender(<><Trap open label="下" /><Trap open={false} label="上" /></>);
        screen.getByText("下2").focus();
        tab();
        expect(document.activeElement).toBe(screen.getByText("下1"));
    });

    it("入れ子なら内側が扱う（同じコミットで開いて、子の effect が先に走っても）", () => {
        render(<Trap open label="外"><Trap open label="内" /></Trap>);
        screen.getByText("内1").focus();
        expect(tab(), "内側の中を進めない").toBe(true);
        screen.getByText("内2").focus();
        tab();
        expect(document.activeElement, "外側の閉じ込めが内側の折り返しを奪った").toBe(screen.getByText("内1"));
    });

    /**
     * **優先度の高い方（同意画面）が先に開き、あとから裏で別のものが開く。**
     * 新しく投稿した写真の共有リンクは、一覧が届いてから拡大表示が開くので、
     * 同意画面より後になることがある。「後から開いた方」で決めると裏が勝ち、
     * 開いた瞬間に見えない「前へ」へフォーカスが移っていた
     */
    it("優先度の高い閉じ込めは、あとから開いた普通の閉じ込めにフォーカスも Tab も奪われない", () => {
        const { rerender } = render(<><Trap open label="同意" priority={1} /><Trap open={false} label="拡大" /></>);
        expect(document.activeElement).toBe(screen.getByText("同意1"));
        rerender(<><Trap open label="同意" priority={1} /><Trap open label="拡大" /></>);
        expect(document.activeElement, "裏で開いた閉じ込めがフォーカスを奪った").toBe(screen.getByText("同意1"));
        expect(tab(), "同意画面の中を進めない").toBe(true);
        screen.getByText("同意2").focus();
        tab();
        expect(document.activeElement, "同意画面の中で折り返していない").toBe(screen.getByText("同意1"));
    });
});
