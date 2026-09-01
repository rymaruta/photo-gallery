import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// IAM-1: 未認証で呼べる Lambda が、削除権を持った共有ロールで動いていた。
//
// serverless は既定で**サービス内の全関数に1つのロール**を配る。認可を
// 一度も通らない口（api-user の getPublicProfile / searchUsers /
// getLikeCount / getComments / getFollowStats、api の getPhotos / getPhoto）が、
// 写真テーブルの DeleteItem・uploads/* の s3:DeleteObject・
// cognito-idp:AdminAddUserToGroup まで持っていた。
//
// ここで固定したいのは「新しく未認証の口を足したとき、黙って共有ロールに
// 乗らない」こと。**YAML パーサは使わない**——js-yaml はどの package.json
// にも書かれていない推移依存で、巻き上げが変わるとテストだけが先に壊れる
// （台帳 DEP-2 と同じ形）。`.github/workflows` のガードが同じ理由で
// 正規表現だけになっている。
const ROOT = join(__dirname, "..", "..");

/** 関数名 → その関数のブロック（コメント行を除いた本文） */
function functionBlocks(yml: string): Map<string, string> {
    const body = yml.split(/\nfunctions:\n/)[1];
    if (!body) throw new Error("functions: が見つからない");
    // 次の最上位キー（列0の `名前:`）まで
    const section = body.split(/\n(?=[a-zA-Z#])/)[0];
    const out = new Map<string, string>();
    // 2スペース字下げの `名前:` が関数の境目
    const parts = ("\n" + section).split(/\n(?=  \w+:\n)/);
    for (const part of parts) {
        const m = /^\n?  (\w+):/.exec(part);
        if (!m) continue;
        out.set(m[1], part.replace(/^\s*#.*$/gm, ""));
    }
    return out;
}

const services = [
    { name: "api-user", file: "api-user/serverless.yml", publicFns: ["getPublicProfile", "searchUsers", "getLikeCount", "getComments", "getFollowStats"] },
    { name: "api", file: "api/serverless.yml", publicFns: ["getPhotos", "getPhoto"] },
];

describe.each(services)("$name: 未認証の口は読み取り専用ロールで動く", ({ file, publicFns }) => {
    const yml = readFileSync(join(ROOT, file), "utf8");
    const blocks = functionBlocks(yml);

    it("認可の無い httpApi の関数が、洗い出した一覧と一致する", () => {
        const found = [...blocks]
            .filter(([, b]) => b.includes("httpApi:") && !b.includes("authorizer:"))
            .map(([n]) => n);
        // 増えていたら、その関数にも role を付けるか、ここに足す判断をする
        expect(found.sort()).toEqual([...publicFns].sort());
    });

    it.each(publicFns)("%s に role: PublicReadRole が付いている", (fn) => {
        expect(blocks.get(fn), `${fn} が見つからない`).toBeDefined();
        expect(blocks.get(fn)).toMatch(/^\s{4}role: PublicReadRole\s*$/m);
    });

    it("認可のある関数には付けない（共有ロールのまま）", () => {
        for (const [name, b] of blocks) {
            if (!b.includes("authorizer:")) continue;
            expect(b, `${name} に読み取り専用ロールが付いている`).not.toContain("role: PublicReadRole");
        }
    });
});

describe("PublicReadRole の中身に書き込みが混ざっていない", () => {
    // 「ついでに」広げると分けた意味が無くなるので、許す動詞を並べて固定する。
    const ALLOWED = new Set([
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
    ]);

    it.each(services)("$name", ({ file }) => {
        const yml = readFileSync(join(ROOT, file), "utf8");
        const res = yml.split(/\nresources:\n/)[1];
        expect(res, "resources: が無い").toBeDefined();
        const actions = [...res.replace(/^\s*#.*$/gm, "").matchAll(/^\s*-\s+([a-z0-9-]+:[A-Za-z]+)\s*$/gm)].map((m) => m[1]);
        expect(actions.length).toBeGreaterThan(0);
        for (const a of actions) {
            expect(ALLOWED.has(a), `PublicReadRole に ${a} が入っている`).toBe(true);
        }
        // ロールを引き受けられるのは Lambda だけ
        expect(res).toContain("Service: lambda.amazonaws.com");
    });
});
