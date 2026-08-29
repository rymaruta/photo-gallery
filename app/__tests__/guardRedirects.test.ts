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
    /** ファイル → その中で「送り返し」に当たる遷移が含む文字列 */
    const SITES: Array<[string, string[]]> = [
        ["lib/hooks/useMemberGate.ts", ["loginWithNext("]],
        ["app/login/page.tsx", ["nextPath ?? (userId ?", "nextPath ?? (result.userId ?"]],
        ["app/signup/page.tsx", ['isAuthenticated) router']],
        ["app/admin/login/page.tsx", ['"/admin")', '"/")']],
        ["app/admin/page.tsx", ['"/admin/login")', '"/")']],
        ["app/admin/edit/page.tsx", ['"/admin/login")', '"/")']],
        // `(ROUTES.DRAFTS)` と括弧まで見る。保存後の遷移
        // （`push(published ? ROUTES.PHOTO(id) : ROUTES.DRAFTS)`）は
        // **前に進む遷移なので push のまま**で、そちらを巻き込まないため
        ["app/user/edit/page.tsx", ["(ROUTES.DRAFTS)"]],
    ];

    it.each(SITES)("%s の送り返しは push を使っていない", (file, needles) => {
        const src = readFileSync(join(process.cwd(), file), "utf8");
        for (const needle of needles) {
            const lines = src.split("\n").filter((l) => l.includes(needle) && /router(Ref\.current)?\.(push|replace)\(/.test(l));
            expect(lines.length, `${file}: 「${needle}」を含む遷移が見つからない（テストが実装からずれている）`).toBeGreaterThan(0);
            for (const line of lines) {
                expect(line, `${file}: ${line.trim()} — push だと戻るで往復して抜けられない`).not.toMatch(/router(Ref\.current)?\.push\(/);
            }
        }
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
