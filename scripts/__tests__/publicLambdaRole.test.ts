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
    {
        name: "api-user", file: "api-user/serverless.yml",
        // `getInvite` は共同アルバムの招待（案C）。**開いた瞬間にログインを
        // 求めると拡散の輪がそこで切れる**ので、閲覧だけ未認証で開ける。
        // 守りは「認証」ではなく**推測不能なトークン**（192ビット）で、
        // 読むのは招待の行とアルバムの行の GetItem 2回だけ
        // ——PublicReadRole の権限（写真テーブルは GetItem のみ。索引の Query は
        // 持たない）に収まる。
        // `getFeed`（公開写真のページ）だけは索引を Query するので、共有の
        // PublicReadRole に足さず専用の `PublicFeedRole` で動かす（下の `ownRole`）。
        // 🔴 **ハイライト（`getUserHighlights` / `getHighlight`）はここに入れない。**
        // 一度入れて本番まで出してしまった。中身はストーリーそのもので、
        // **ストーリーはフォロワーだけが見る**（2026-09-22・owner の判断。
        // 経緯は `api-user/src/storyVisibility.ts`）。当時の理由は
        // 「全員に公開のアーカイブしか入らないから」だったが、あの「全員」は
        // **ログインした全員**の意味で、インターネット全体ではなかった。
        // 今はログインを要求したうえで、さらにフォローを見ている
        publicFns: [
            "getPublicProfile", "searchUsers", "getLikeCount", "getComments", "getFollowStats", "getInvite", "getFeed",
            // App Store Server Notifications（Apple から・署名で確かめる。`purchases.ts`）
            "appStoreNotification",
        ],
        /** PublicReadRole ではなく専用ロールで動かす公開関数（関数名 → ロール名） */
        ownRole: { getFeed: "PublicFeedRole", appStoreNotification: "AppStoreNotifyRole" } as Record<string, string>,
    },
    { name: "api", file: "api/serverless.yml", publicFns: ["getPhotos", "getPhoto"], ownRole: {} as Record<string, string> },
];

describe.each(services)("$name: 未認証の口は読み取り専用ロールで動く", ({ file, publicFns, ownRole }) => {
    const yml = readFileSync(join(ROOT, file), "utf8");
    const blocks = functionBlocks(yml);

    it("認可の無い httpApi の関数が、洗い出した一覧と一致する", () => {
        const found = [...blocks]
            .filter(([, b]) => b.includes("httpApi:") && !b.includes("authorizer:"))
            .map(([n]) => n);
        // 増えていたら、その関数にも role を付けるか、ここに足す判断をする
        expect(found.sort()).toEqual([...publicFns].sort());
    });

    // 公開関数には PublicReadRole。**専用ロールを認めるのは `ownRole` に書いた関数だけ**
    // （その中身は下の「PublicFeedRole は…」で最小権限かを見る）
    it.each(publicFns)("%s に読み取り専用ロールが付いている", (fn) => {
        expect(blocks.get(fn), `${fn} が見つからない`).toBeDefined();
        const role = ownRole[fn] ?? "PublicReadRole";
        expect(blocks.get(fn)).toMatch(new RegExp(`^\\s{4}role: ${role}\\s*$`, "m"));
    });

    it("専用ロールは、その関数のほかに誰も使っていない", () => {
        for (const [fn, role] of Object.entries(ownRole)) {
            const users = [...blocks].filter(([, b]) => new RegExp(`^\\s{4}role: ${role}\\s*$`, "m").test(b)).map(([n]) => n);
            expect(users, `${role} を ${fn} 以外も使っている`).toEqual([fn]);
        }
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

    /** `resources:` の中から、名前を指定したロールのブロックだけを切り出す。
     *  **resources 全体を見ない**——ロールが2つ以上あると、別のロールの動詞を
     *  このロールのものとして数えてしまう（`GeocodeRole` を足したとき実際に
     *  そうなった） */
    const roleBlock = (yml: string, name: string): string => {
        const res = yml.split(/\nresources:\n/)[1];
        expect(res, "resources: が無い").toBeDefined();
        const m = new RegExp(`^ {4}${name}:$([\\s\\S]*?)(?=^ {4}\\w+:$|(?![\\s\\S]))`, "m").exec(res);
        expect(m, `${name} のブロックが見つからない`).not.toBeNull();
        return m![1];
    };
    const actionsOf = (block: string): string[] =>
        [...block.replace(/^\s*#.*$/gm, "").matchAll(/^\s*-\s+([a-z0-9-]+:[A-Za-z]+)\s*$/gm)].map((m) => m[1]);

    it.each(services)("$name", ({ file }) => {
        const yml = readFileSync(join(ROOT, file), "utf8");
        const block = roleBlock(yml, "PublicReadRole");
        const actions = actionsOf(block);
        expect(actions.length).toBeGreaterThan(0);
        for (const a of actions) {
            expect(ALLOWED.has(a), `PublicReadRole に ${a} が入っている`).toBe(true);
        }
        // ロールを引き受けられるのは Lambda だけ
        expect(block).toContain("Service: lambda.amazonaws.com");
    });
});

// 地名さがし（Nominatim の代理）専用ロール。利用者入力を外向き URL に載せる
// 口なので、**共有ロール（写真の削除・S3・CloudFront）には載せない**。
// 要るのはログと、結果の控えの読み書きだけ
describe("GeocodeRole は控えの読み書きしか持たない", () => {
    const ALLOWED = new Set(["logs:CreateLogStream", "logs:PutLogEvents", "dynamodb:GetItem", "dynamodb:PutItem"]);
    it("api-user", () => {
        const yml = readFileSync(join(ROOT, "api-user/serverless.yml"), "utf8");
        const res = yml.split(/\nresources:\n/)[1]!;
        const m = /^ {4}GeocodeRole:$([\s\S]*?)(?=^ {4}\w+:$)/m.exec(res);
        expect(m, "GeocodeRole が無い").not.toBeNull();
        const actions = [...m![1].replace(/^\s*#.*$/gm, "").matchAll(/^\s*-\s+([a-z0-9-]+:[A-Za-z]+)\s*$/gm)].map((x) => x[1]);
        expect(actions.length).toBeGreaterThan(0);
        for (const a of actions) expect(ALLOWED.has(a), `GeocodeRole に ${a} が入っている`).toBe(true);
        // 触れるのは写真テーブルだけ（users テーブル・S3・CloudFront は無い）
        expect(m![1]).not.toMatch(/usersTable|s3:|cloudfront:/);
    });

    it("geocodeSearch にこのロールが付いている", () => {
        const yml = readFileSync(join(ROOT, "api-user/serverless.yml"), "utf8");
        const fn = /^ {2}geocodeSearch:$([\s\S]*?)(?=^ {2}\w+:$)/m.exec(yml);
        expect(fn).not.toBeNull();
        expect(fn![1]).toMatch(/^\s{4}role: GeocodeRole\s*$/m);
    });
});

// 公開写真のページ（getFeed）専用ロール。未認証で呼べる口なので、getFeed が
// 実際に使うものだけ: ログ・公開一覧の索引の Query・users テーブルの GetItem
// （表示名をいまの値に）。**索引の Query を共有の PublicReadRole に足さない**
// ——足すと他の公開口まで索引を読める
describe("PublicFeedRole は公開一覧の索引の Query と最小限しか持たない", () => {
    const yml = readFileSync(join(ROOT, "api-user/serverless.yml"), "utf8");
    const res = yml.split(/\nresources:\n/)[1]!;
    const roleOf = (name: string): string => {
        const m = new RegExp(`^ {4}${name}:$([\\s\\S]*?)(?=^ {4}\\w+:$|(?![\\s\\S]))`, "m").exec(res);
        expect(m, `${name} が無い`).not.toBeNull();
        return m![1].replace(/^\s*#.*$/gm, "");
    };
    /** 文（`- Effect:`）ごとに、動詞と資源の組を取り出す */
    const statements = (block: string) =>
        block.split(/^\s*- Effect: /m).slice(1).map((st) => ({
            effect: st.split("\n")[0].trim(),
            actions: [...st.split(/Resource:/)[0].matchAll(/^\s*-\s+([a-z0-9-]+:[A-Za-z]+)\s*$/gm)].map((x) => x[1]),
            resources: [...(st.split(/Resource:/)[1] ?? "").matchAll(/^\s*-\s+(arn:\S+)\s*$/gm)].map((x) => x[1]),
        }));
    const INDEX_ARN = "arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${param:photosTable}/index/publicFeed-createdAt-index";
    const USERS_ARN = "arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${param:usersTable}";
    const LOGS_ARN = "arn:aws:logs:${aws:region}:${aws:accountId}:log-group:/aws/lambda/${self:service}-${sls:stage}*:*";

    it("動詞と資源の組がちょうどこれだけ", () => {
        const block = roleOf("PublicFeedRole");
        expect(block).toContain("Service: lambda.amazonaws.com");
        const pairs = statements(block).flatMap((st) => {
            expect(st.effect, "Allow 以外の文がある").toBe("Allow");
            return st.actions.flatMap((a) => st.resources.map((r) => `${a} ${r}`));
        }).sort();
        expect(pairs).toEqual([
            `dynamodb:GetItem ${USERS_ARN}`,
            `dynamodb:Query ${INDEX_ARN}`,
            `logs:CreateLogStream ${LOGS_ARN}`,
            `logs:PutLogEvents ${LOGS_ARN}`,
        ].sort());
    });

    it("共有の PublicReadRole は索引を Query できない", () => {
        const block = roleOf("PublicReadRole");
        expect(block).not.toContain("dynamodb:Query");
        expect(block).not.toContain("/index/");
    });
});

describe("AppStoreNotifyRole は知らせの処理に要るものだけ持つ", () => {
    const yml = readFileSync(join(ROOT, "api-user/serverless.yml"), "utf8");
    const res = yml.split(/\nresources:\n/)[1]!;
    const m = /^ {4}AppStoreNotifyRole:$([\s\S]*?)(?=^ {4}\w+:$)/m.exec(res);
    const USERS_ARN = "arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${param:usersTable}";
    const PHOTOS_ARN = "arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${param:photosTable}";
    const LOGS_ARN = "arn:aws:logs:${aws:region}:${aws:accountId}:log-group:/aws/lambda/${self:service}-${sls:stage}*:*";

    it("動詞と資源の組がちょうどこれだけ（Scan・Delete・S3・索引を持たない）", () => {
        expect(m, "AppStoreNotifyRole が無い").not.toBeNull();
        const block = m![1].replace(/^\s*#.*$/gm, "");
        expect(block).toContain("Service: lambda.amazonaws.com");
        const pairs = block.split(/^\s*- Effect: /m).slice(1).flatMap((st) => {
            expect(st.split("\n")[0].trim()).toBe("Allow");
            const actions = [...st.split(/Resource:/)[0].matchAll(/^\s*-\s+([a-z0-9-]+:[A-Za-z]+)\s*$/gm)].map((x) => x[1]);
            const resources = [...(st.split(/Resource:/)[1] ?? "").matchAll(/^\s*-\s+(arn:\S+)\s*$/gm)].map((x) => x[1]);
            return actions.flatMap((a) => resources.map((r) => `${a} ${r}`));
        }).sort();
        expect(pairs).toEqual([
            `dynamodb:GetItem ${PHOTOS_ARN}`,
            `dynamodb:GetItem ${USERS_ARN}`,
            `dynamodb:PutItem ${USERS_ARN}`,
            `dynamodb:UpdateItem ${PHOTOS_ARN}`,
            `logs:CreateLogStream ${LOGS_ARN}`,
            `logs:PutLogEvents ${LOGS_ARN}`,
        ].sort());
    });
});
