import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **「行き止まりを履歴に残さない」の再発防止ガード。**
//
// 認証ガード（見せられないので送り返す）と、もう存在しないものの画面から
// 送り返す遷移を `router.push` で書くと、送り先から戻ったときにその画面へ
// 着地し、そこがまた送り返す——**戻るで抜けられない**。
//
// 実際に起きていた2つ:
//   1. 未ログインで /user/upload → /login?next=… へ push。ログイン後に
//      /user/upload へ進み、戻ると /login に着地。/login はログイン済みだと
//      next へ送り返すので、戻るを何度押しても2画面を往復するだけ。
//   2. 下書きを削除 → /user/drafts へ push。戻ると /user/edit?id=X が
//      再マウントされ「写真が見つかりません」の赤いトーストを出して
//      また送り返す。前の画面に二度と戻れない。
//
// ここは**行を数えるのではなく、その1行がどちらの呼び方かを見る**。
// 綴りだけ見て通す形にしない（この campaign で何度も出ている型）。
describe("行き止まりからの遷移は replace で書く", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8").split("\n");
    const callsOn = (lines: string[], needle: string, kind: "push" | "replace") =>
        lines.filter((l) => l.includes(needle) && new RegExp(`router(Ref\\.current)?\\.${kind}\\(`).test(l));

    /**
     * ファイル → その中の遷移を、**呼び方ごとの本数**で数える。
     *
     * 前は「その needle を含む行が push でないこと」だけを見ていたが、
     * needle に当たらない行は**そもそも数えられない**——`admin/edit` の
     * `replace(ROUTES.ADMIN)` 2か所がどの needle にも当たらず、
     * push に戻しても全件緑だった（レビューが実測）。
     * 本数で見れば、1本でも呼び方が変われば必ず落ちる。
     */
    const SITES: Array<[string, string, number, number]> = [
        // ファイル, needle, replace の本数, push の本数
        ["lib/hooks/useMemberGate.ts", "loginWithNext(", 1, 0],
        ["app/login/page.tsx", "nextPath ?? (", 2, 0],
        ["app/signup/page.tsx", "isAuthenticated) router", 1, 0],
        ["app/admin/login/page.tsx", '"/admin")', 1, 0],
        ["app/admin/login/page.tsx", '"/")', 1, 0],
        ["app/admin/page.tsx", '"/admin/login")', 1, 0],
        ["app/admin/page.tsx", '"/")', 1, 0],
        ["app/admin/edit/page.tsx", '"/admin/login")', 1, 0],
        ["app/admin/edit/page.tsx", '"/")', 1, 0],
        // **ここが抜けていた。** 「写真が見つかりません」「読み込みに失敗
        // しました」からの送り返し2本と、保存後の前進遷移1本が同じ
        // `ROUTES.ADMIN` なので、本数で分ける
        ["app/admin/edit/page.tsx", "ROUTES.ADMIN)", 2, 1],
        // 「写真が見つかりません」と削除後の2本が replace、保存後の1本が push
        ["app/user/edit/page.tsx", "ROUTES.DRAFTS)", 2, 1],
    ];

    it.each(SITES)("%s の「%s」は replace %d 本 / push %d 本", (file, needle, replaces, pushes) => {
        const lines = read(file);
        expect(callsOn(lines, needle, "replace").length,
            `${file}: 「${needle}」の replace の本数が変わった（push に戻していないか）`).toBe(replaces);
        expect(callsOn(lines, needle, "push").length,
            `${file}: 「${needle}」の push の本数が変わった`).toBe(pushes);
    });

    // 逆向き（消しすぎ）も見る。前に進む遷移まで replace にすると、
    // 戻るで前の画面に帰れなくなる
    it("前に進む遷移は push のまま", () => {
        const nav = readFileSync(join(process.cwd(), "app/components/HeaderNav.tsx"), "utf8");
        expect(nav).toMatch(/router\.push\(href\)/);
        // 保存したあとの遷移は「編集画面へ戻れる」方が正しい
        const edit = readFileSync(join(process.cwd(), "app/user/edit/page.tsx"), "utf8");
        expect(edit).toMatch(/router\.push\(published && photoId \?/);
    });
});
