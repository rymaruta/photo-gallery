import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// このスクリプトは app/api を退避し、out/ を消し、next build を回す
// ——**副作用の塊**。他の scripts/*.js が全部持っている
// `require.main === module` のガードが、このファイルにだけ無かった。
// 一度囲ったが、**前回の中断の後始末だけトップレベルに残っていて**、
// require しただけで `_api_build_backup` を動かしていた（レビューが実測）。
//
// root は `__dirname/..` なので、/tmp に scripts/ ごとコピーすれば
// 偽のリポジトリを root として読み込ませられる。

/** vitest の import() は /tmp を解決できないので、素の require で読む */
function loadScript(root: string) {
    const req = createRequire(path.join(root, "scripts/x.cjs"));
    delete req.cache?.[path.join(root, "scripts/prepare-static-build.js")];
    req(path.join(root, "scripts/prepare-static-build.js"));
}

const tmpRoots: string[] = [];
afterEach(() => {
    for (const d of tmpRoots.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** 偽のリポジトリを作り、そこへスクリプトをコピーして絶対パスを返す */
function sandbox(tree: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "psb-"));
    tmpRoots.push(root);
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.copyFileSync(
        path.resolve(process.cwd(), "scripts/prepare-static-build.js"),
        path.join(root, "scripts/prepare-static-build.js"),
    );
    for (const [rel, body] of Object.entries(tree)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body);
    }
    return root;
}

describe("prepare-static-build: require しても何もしない", () => {
    it("退避中のバックアップを動かさない", () => {
        const root = sandbox({ "_api_build_backup/route.ts": "export {}", "app/page.tsx": "x" });
        // app/api は無い＝「前回の中断」に見える状態
        loadScript(root);

        expect(fs.existsSync(path.join(root, "_api_build_backup/route.ts"))).toBe(true);
        expect(fs.existsSync(path.join(root, "app/api"))).toBe(false);
    });

    it("残骸に見えるバックアップも消さない", () => {
        const root = sandbox({ "_api_build_backup/route.ts": "export {}", "app/api/route.ts": "export {}" });
        loadScript(root);

        expect(fs.existsSync(path.join(root, "_api_build_backup/route.ts"))).toBe(true);
        expect(fs.existsSync(path.join(root, "app/api/route.ts"))).toBe(true);
    });

    it("out/ を消さない", () => {
        const root = sandbox({ "out/index.html": "<html>", "app/page.tsx": "x" });
        loadScript(root);

        expect(fs.existsSync(path.join(root, "out/index.html"))).toBe(true);
    });
});
