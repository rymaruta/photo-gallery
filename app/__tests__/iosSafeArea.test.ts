import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * 🔴 **iPhone の安全領域（時計・電池の帯／ノッチ／ホームへ戻る帯）を空けていること。**
 *
 * `app/layout.tsx` は `viewportFit: "cover"` と `statusBarStyle: "black-translucent"`
 * を宣言している。ホーム画面から起動すると、ページは時計・電池の帯の下まで、
 * 横向きではノッチの下まで広がる。空けるのは各部品の責任になる。
 *
 * 空けていなかった箇所（2026-09-25 の洗い出し `docs/ios-bug-audit-2026-09-25.md`）:
 *
 *   #1  ヘッダーのロゴとメニューが時計・Dynamic Island と重なる
 *       写真モーダルの「閉じる・いいね・保存」が電池の表示の下に入る
 *   #38 横向き・ログイン中にメニューを開くと「設定」「ログアウト」が画面の外
 *       （実測 844x390: パネルの下端 489px。中はスクロールできなかった）
 *   #42 横向きで本文と写真モーダルの矢印がノッチの下に入る
 *
 * jsdom は CSS を解釈しないので、**描いて測る形では捕まえられない**。
 * `bottomBarOverlap.test.ts` と同じく、そう書いてあるかをソースで見る。
 */

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/** コメントを落とす（理由を書くほど、綴りで見る判定が自分の説明に当たる） */
const code = (rel: string): string =>
    read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("上の安全領域（ホーム画面から起動したとき）", () => {
    it("共通ヘッダーが上の安全領域を空けている", () => {
        const src = code("app/layout.tsx");
        const header = src.slice(src.indexOf("<header"), src.indexOf(">", src.indexOf("paddingTop", src.indexOf("<header"))));
        expect(header).toMatch(/paddingTop:\s*"env\(safe-area-inset-top/);
    });

    it("ヘッダーの下に貼る面は、ヘッダーの高さを直書きしない（安全領域込みの変数を使う）", () => {
        for (const f of ["app/components/HeaderNav.tsx", "app/components/NotificationsBell.tsx"]) {
            const src = code(f);
            expect(src, f).not.toMatch(/top-\[64px\]/);
            expect(src, f).not.toMatch(/top-\[72px\]/);
            expect(src, f).toContain("top-[var(--header-h)]");
        }
        const css = read("app/globals.css");
        expect(css).toMatch(/--header-h:\s*calc\(64px \+ env\(safe-area-inset-top/);
        expect(css).toMatch(/--header-h:\s*calc\(72px \+ env\(safe-area-inset-top/);
    });

    it("写真モーダルが四辺の安全領域の内側に収まる（スマホは黒い内枠、広い画面は外枠で空ける）", () => {
        const css = read("app/globals.css");
        const util = css.slice(css.indexOf("@utility pad-safe"), css.indexOf("}", css.indexOf("@utility pad-safe")));
        for (const side of ["top", "right", "bottom", "left"]) {
            expect(util).toContain(`padding-${side}: env(safe-area-inset-${side}`);
        }
        const src = code("app/components/GalleryModal/index.tsx");
        // 外枠は押すと閉じる半透明の面。スマホでここを空けると、帯が透けて
        // 押すと閉じる（レビューで指摘）。スマホは内枠（黒）の側で空ける
        const overlay = src.slice(src.indexOf('role="dialog"'), src.indexOf(">", src.indexOf("className=", src.indexOf('role="dialog"'))));
        // `max-sm:pad-safe` も「sm:pad-safe」を含むので、前に文字が付かない形で探す
        // （含むだけで見ると、出し分けを逆にしても通ってしまう）
        expect(overlay).toMatch(/(?<![\w:-])sm:pad-safe/);
        expect(overlay).not.toMatch(/max-sm:pad-safe/);
        expect(overlay).not.toMatch(/(?<![\w:-])pad-safe/);
        const inner = src.slice(src.indexOf("max-sm:pad-safe") - 200, src.indexOf("max-sm:pad-safe") + 200);
        expect(inner).toContain("bg-black");
    });

    it("キャプションの高さの上限から、上下の安全領域を引いている（引かないと共有の行が切れる）", () => {
        const src = code("app/components/GalleryModal/ModalCaption.tsx");
        const line = src.split("\n").find((l) => l.includes("maxHeight:")) ?? "";
        expect(line).toContain("safe-area-inset-top");
        expect(line).toContain("safe-area-inset-bottom");
    });
});

describe("横向きの iPhone", () => {
    it("メニューのパネルは画面が低いと中でスクロールする", () => {
        const src = code("app/components/HeaderNav.tsx");
        const i = src.indexOf("max-w-[220px]");
        expect(i).toBeGreaterThan(0);
        const panel = src.slice(src.lastIndexOf("<div", i), src.indexOf("<nav", i));
        expect(panel).toContain("overflow-y-auto");
        expect(panel).not.toMatch(/(?<![-\w])overflow-hidden/);
        // 下はホームへ戻る帯のぶんも引く（引かないとログアウトの下端が帯に掛かる）
        expect(panel).toMatch(/maxHeight:\s*"calc\([^"]*safe-area-inset-bottom/);
        // 右もノッチのぶん内側へ寄せる
        expect(panel).toMatch(/marginRight:\s*"env\(safe-area-inset-right/);
    });

    it("横に貼り付く柱は、ヘッダーの高さを直書きしない", () => {
        for (const f of ["app/GalleryPageClient.tsx", "app/components/SpotGuideClient.tsx", "app/user/upload/page.tsx"]) {
            const src = code(f);
            expect(src, f).not.toContain("lg:top-[88px]");
            expect(src, f).toContain("lg:top-[calc(var(--header-h)_+_16px)]");
        }
        // 上端を安全領域ぶん下げたら、高さの上限も同じ変数から引く。
        // 88px 前提の上限のままだと、下端がタブバーの裏に潜る（iPad・ホーム画面起動）
        for (const f of ["app/GalleryPageClient.tsx", "app/components/SpotGuideClient.tsx"]) {
            const src = code(f);
            expect(src, f).not.toContain("100vh-168px");
            expect(src, f).toContain("lg:max-h-[calc(100vh_-_var(--header-h)_-_96px_-_env(safe-area-inset-bottom,0px))]");
        }
    });

    it("ヘッダーの地は本文の左右の余白を打ち消して端まで届く", () => {
        const src = code("app/layout.tsx");
        expect(src).toMatch(/marginLeft:\s*"calc\(-1 \* env\(safe-area-inset-left/);
        expect(src).toMatch(/marginRight:\s*"calc\(-1 \* env\(safe-area-inset-right/);
        // 地を伸ばしたぶん、中身は内側へ戻す（戻さないとロゴとメニューがノッチの下）
        const header = src.slice(src.indexOf("<header"), src.indexOf("<header") + 2500);
        expect(header).toMatch(/paddingLeft:\s*"env\(safe-area-inset-left/);
        expect(header).toMatch(/paddingRight:\s*"env\(safe-area-inset-right/);
    });

    it("本文が左右の安全領域を空ける", () => {
        const css = read("app/globals.css");
        expect(css).toMatch(/padding-left:\s*env\(safe-area-inset-left/);
        expect(css).toMatch(/padding-right:\s*env\(safe-area-inset-right/);
    });
});

describe("下の安全領域（ホームへ戻る帯）", () => {
    it("下から出るシートが帯のぶんを下に足す", () => {
        expect(code("app/components/ReportDialog.tsx")).toMatch(/paddingBottom:\s*"calc\([^"]*safe-area-inset-bottom/);
        expect(code("app/user/albums/page.tsx")).toMatch(/paddingBottom:\s*"calc\([^"]*safe-area-inset-bottom/);
    });
});

describe("iOS Safari の細部", () => {
    it("写真モーダルのボタンのぼかしに -webkit- 付きも書く（React はインラインに接頭辞を足さない）", () => {
        const src = code("app/components/GalleryModal/ModalControls.tsx");
        expect(src).toMatch(/WebkitBackdropFilter:/);
    });

    it("中でスクロールする面は、端で画面全体を弾ませない", () => {
        expect(code("app/components/GalleryModal/ModalCaption.tsx")).toContain("overscroll-contain");
        expect(code("app/components/ReportDialog.tsx")).toContain("overscroll-contain");
        expect(code("app/components/NotificationsBell.tsx")).toContain("overscroll-contain");
    });
});

/**
 * 🔴 **高さとスクロール**（`docs/ios-bug-audit-2026-09-25.md` #4・#24・#39・#7・#47・#51）。
 * どれも実測で見つけたもの（Chromium・iPhone の画面を真似た・本番と同じ設定のビルド）。
 */
describe("高さとスクロール", () => {
    const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

    it("body に高さを固定しない（sticky のヘッダーが画面1枚ぶんで流れて消えた）", () => {
        // `html, body { … height: 100% … }` の形が残っていないこと
        const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
        const bodyHeight = rules.filter((r) => r.sel.split(",").map((x) => x.trim()).includes("body") && /(^|[;\s])height:\s*100%/.test(r.body));
        expect(bodyHeight.map((r) => r.sel)).toEqual([]);
        expect(rules.some((r) => r.sel === "html" && /(^|[;\s])height:\s*100%/.test(r.body))).toBe(true);
    });

    it("html に scroll-padding-top を置かない（ヘッダーへのフォーカスでページが跳ぶ）", () => {
        // a07e342 で置いたら、メニューを閉じるたびにページが約330px 上へ跳んだ
        // （戻り先のメニューボタンが「隠れる扱い」の帯の中にあるため）。
        expect(css).not.toMatch(/scroll-padding-top/);
    });

    it("「コメントを見る」の行き先は、ヘッダーの高さぶん手前で止まる", () => {
        const src = code("app/photo/[id]/PhotoPageClient.tsx");
        expect(src).toMatch(/ref=\{tabsRef\}[^>]*scrollMarginTop:\s*"var\(--header-h\)"/);
    });

    it("遷移のスクロールはなめらかにしない（Next 16 は html の data 属性を見て遷移の間だけ切る）", () => {
        expect(code("app/layout.tsx")).toMatch(/<html[^>]*data-scroll-behavior="smooth"/);
    });

    it("トーストは下部タブバーの上に出す", () => {
        expect(code("app/components/Toast.tsx")).toMatch(/bottom:\s*"calc\(var\(--bottom-bar-h/);
    });

    it("退会の確認は入り切らないときスクロールできる（横向きで上下が切れていた）", () => {
        const src = code("app/components/DeleteAccountModal.tsx");
        const outer = src.slice(src.indexOf("ref={dialogRef}"), src.indexOf("role=\"dialog\""));
        expect(outer).toContain("overflow-y-auto");
        expect(outer).not.toContain("items-center");
        expect(src).toContain("my-auto");
    });

    it("地図の下限は、スマホでは見えている高さを超えない", () => {
        const src = code("app/map/MapPageClient.tsx");
        expect(src).not.toMatch(/(?<![\w:-])min-h-\[320px\]/);
        expect(src).toContain("min-h-[min(320px,calc(100dvh_-_var(--header-h)_-_var(--bottom-bar-h,84px)_-_24px))]");
    });
});
