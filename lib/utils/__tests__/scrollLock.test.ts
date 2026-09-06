import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lockBodyScroll, unlockBodyScroll } from "../scrollLock";

// モーダルを閉じたときのスクロール復元。
// **`globals.css` の `html { scroll-behavior: smooth }` を拾わせない。**
// 拾うと復元がアニメーションになり、写真を1枚見て閉じるたびに、見ていた
// 場所まで景色が流れる。実測（実ブラウザ・390x780・1440px スクロールして
// メニューを開閉）: 修正前は 2 → 73 → … → 1440 と約0.7秒かけて滑り、
// 修正後は閉じた直後の1フレーム目から 1440。

const scrollTo = vi.fn();
let prevScrollTo: typeof window.scrollTo;

beforeEach(() => {
    prevScrollTo = window.scrollTo;
    // jsdom は scrollTo を実装していないので差し替える
    Object.defineProperty(window, "scrollTo", { value: scrollTo, writable: true, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 1440, writable: true, configurable: true });
    scrollTo.mockReset();
    document.body.removeAttribute("style");
});
afterEach(() => {
    Object.defineProperty(window, "scrollTo", { value: prevScrollTo, writable: true, configurable: true });
    document.body.removeAttribute("style");
});

describe("背景スクロールのロック", () => {
    it("開いている間は position: fixed で位置を控える", () => {
        lockBodyScroll();
        expect(document.body.style.position).toBe("fixed");
        expect(document.body.style.top).toBe("-1440px");
        unlockBodyScroll();
    });

    // **ここで固定できるのは「呼び方」まで**（jsdom はスクロールを実装して
    // いないので、滑らないことそのものは実ブラウザでしか測れない。
    // 実測は `lib/utils/scrollLock.ts` の但し書きを参照）
    it("閉じたら、smooth を止めたうえでその場に戻す", () => {
        document.documentElement.style.scrollBehavior = "";
        let behaviorAtCall: string | null = null;
        scrollTo.mockImplementation(() => { behaviorAtCall = document.documentElement.style.scrollBehavior; });

        lockBodyScroll();
        unlockBodyScroll();

        expect(document.body.style.position).toBe("");
        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(scrollTo.mock.calls[0]).toEqual([0, 1440]);
        // 戻すあいだだけ `scroll-behavior` を殺す。知らない `behavior` の値を
        // 渡された実装は**スクロールごと黙って無視する**ので、値の列挙に頼らない
        expect(behaviorAtCall, "smooth を止めずに戻している").toBe("auto");
        // 終わったら元に戻す（ページの他の滑らかなスクロールを殺さない）
        expect(document.documentElement.style.scrollBehavior).toBe("");
    });

    // 入れ子（モーダルの上にメニュー）で、内側を閉じただけで背景が戻らない
    it("数を数える: 内側を閉じただけでは戻さない", () => {
        lockBodyScroll();
        lockBodyScroll();
        unlockBodyScroll();
        expect(document.body.style.position, "外側がまだ開いているのに戻した").toBe("fixed");
        expect(scrollTo).not.toHaveBeenCalled();
        unlockBodyScroll();
        expect(scrollTo).toHaveBeenCalledTimes(1);
    });
});
