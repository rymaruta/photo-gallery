import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

// IAM-2 の半分: GitHub の**書き込み**トークンが provider.environment にあった。
//
// serverless の `provider.environment` は**サービス内の全関数**に配られる。
// つまり REBUILD_DISPATCH_TOKEN は、未認証で呼べる getPhotos や getComments を
// 含む全 Lambda の環境変数に入っていた。環境変数は `lambda:GetFunctionConfiguration`
// （読み取り権だけ）で読めるので、AWS の読み取り → リポジトリへの書き込み →
// デプロイ鍵、と輪が閉じる。実際に再ビルドを頼むのは5つの関数だけ。
//
// ここで固定するのは両方向:
//   1. provider には無い（＝全関数に配られていない）
//   2. **rebuild.ts に届く関数には配られている** ——こちらが本題。
//      配り忘れると `requestSiteRebuild` は警告1行を出して false を返すだけで、
//      削除は成功したように見えたまま**静的ページが公開のまま残る**
//      （台帳 LEFT-1 と同じ壊れ方）。静かなので気づけない。
const ROOT = join(__dirname, "..", "..");
const TOKEN = "REBUILD_DISPATCH_TOKEN";

/** `handler: src/foo.bar` から src/foo.ts をたどり、rebuild.ts に届くか */
function reachesRebuild(serviceDir: string, handler: string): boolean {
    const entry = resolve(ROOT, serviceDir, handler.replace(/\.[^./]+$/, "") + ".ts");
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
        const file = stack.pop()!;
        if (seen.has(file) || !existsSync(file)) continue;
        seen.add(file);
        if (/[/\\]rebuild\.ts$/.test(file)) return true;
        const src = readFileSync(file, "utf8");
        // 静的 import と、動的 import（rebuild.ts は dynamodb を await import する）
        for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
            stack.push(resolve(dirname(file), m[1].replace(/\.js$/, "") + ".ts"));
        }
    }
    return false;
}

const services = [
    { name: "api-user", dir: "api-user", expected: ["updatePhotoVisibility", "deleteMyPhoto", "deleteAccount"] },
    { name: "api", dir: "api", expected: ["updatePhoto", "deletePhoto"] },
];

describe.each(services)("$name: 再ビルドのトークンは使う関数にだけ配る", ({ dir, expected }) => {
    const yml = readFileSync(join(ROOT, dir, "serverless.yml"), "utf8");
    const provider = yml.split(/\nfunctions:\n/)[0];
    const fnSection = yml.split(/\nfunctions:\n/)[1].split(/\n(?=[a-zA-Z#])/)[0];

    /** 関数名 → { handler, トークンを持つか } */
    const fns = new Map<string, { handler: string; hasToken: boolean }>();
    for (const part of ("\n" + fnSection).split(/\n(?=  \w+:\n)/)) {
        const m = /^\n?  (\w+):/.exec(part);
        if (!m) continue;
        const body = part.replace(/^\s*#.*$/gm, "");
        const h = /^\s{4}handler:\s*(\S+)\s*$/m.exec(body);
        if (!h) continue;
        fns.set(m[1], { handler: h[1], hasToken: body.includes(TOKEN) });
    }

    it("provider.environment には置かない（全関数に配られる）", () => {
        expect(provider).not.toContain(TOKEN);
    });

    it("トークンを持つ関数は、洗い出した一覧と一致する", () => {
        const have = [...fns].filter(([, v]) => v.hasToken).map(([n]) => n);
        expect(have.sort()).toEqual([...expected].sort());
    });

    // 本題。ソースを辿って「実際に rebuild.ts に届く関数」と突き合わせる。
    it("rebuild.ts に届く関数と、トークンを配った関数が一致する", () => {
        const reaches = [...fns].filter(([, v]) => reachesRebuild(dir, v.handler)).map(([n]) => n);
        // たどれていない（＝正規表現が壊れている）のを緑にしない
        expect(reaches.length).toBeGreaterThan(0);
        expect(reaches.sort()).toEqual([...expected].sort());
    });
});
