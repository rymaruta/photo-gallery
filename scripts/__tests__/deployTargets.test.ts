import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickDeployTargets, SHARED } from "../lib/deployTargets.mjs";

/**
 * **YAML パーサは使わない。** `js-yaml` はどの package.json にも
 * 書かれていない（vitest/eslint の推移依存に寄りかかることになる）
 * ——`deployConfig.test.ts` が同じ理由で避けている。最初 `js-yaml` で
 * 書いたら、**ルートの `tsc` が型定義を見つけられずに落ち**、
 * `photoIndexParity.slow.test.ts`（中で `tsc` を走らせる）まで巻き添えで
 * 落ちた。素のテキストで読む。
 */
const WF = readFileSync(
    join(__dirname, "..", "..", ".github", "workflows", "deploy-api.yml"), "utf8",
);

/** ジョブ1つぶんの本文を切り出す */
function job(name: string): string {
    const start = WF.indexOf(`\n  ${name}:\n`);
    expect(start, `ジョブ ${name} が無い`).toBeGreaterThan(-1);
    const after = WF.slice(start + 1);
    const next = after.search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return next === -1 ? after : after.slice(0, next);
}

/**
 * **どちらの Lambda スタックを配るかの判断。**
 *
 * 節約のための判断だが、間違えると「API を直したのに反映されない」——
 * `CLAUDE.md` が実際に踏んだ、いちばん静かな壊れ方になる。
 * だから**疑わしい入力はすべて「両方配る」に落ちること**を固定する。
 */
describe("配る先の判断", () => {
    const push = (changed: string[] | null) => pickDeployTargets({ eventName: "push", changed });

    it("api-user/ だけなら user だけ配る", () => {
        expect(push(["api-user/src/signedUrl.ts"])).toMatchObject({ admin: false, user: true });
    });

    it("api/ だけなら admin だけ配る", () => {
        expect(push(["api/src/photos.ts"])).toMatchObject({ admin: true, user: false });
    });

    it("両方変われば両方配る", () => {
        expect(push(["api/src/a.ts", "api-user/src/b.ts"])).toMatchObject({ admin: true, user: true });
    });

    // ここから下は**全部「両方」に落ちること**。1つでも片方になっていたら、
    // その入力で反映されない写真・API が出る
    describe("疑わしい入力は両方配る", () => {
        it("変更ファイルが辿れない（null）", () => {
            expect(push(null)).toMatchObject({ admin: true, user: true });
        });
        it("変更ファイルが空", () => {
            expect(push([])).toMatchObject({ admin: true, user: true });
        });
        it("どちらの領域にも当たらない", () => {
            expect(push(["README.md"])).toMatchObject({ admin: true, user: true });
        });
        it("ワークフロー自身が変わった（api-user/ だけと一緒でも）", () => {
            expect(push([".github/workflows/deploy-api.yml", "api-user/src/x.ts"]))
                .toMatchObject({ admin: true, user: true });
        });
        it("この判断そのものが変わった", () => {
            expect(push(["scripts/lib/deployTargets.mjs", "api-user/src/x.ts"]))
                .toMatchObject({ admin: true, user: true });
        });
    });

    // **`api-user/` は `api/` で始まらない。** 素朴な前方一致で書くと
    // `api/` の判定が `api-user/` にも当たり、節約が1回も効かなくなる
    // （安全側に外れるので気づきにくい）
    it("api-user/ を api/ と取り違えない", () => {
        expect(push(["api-user/src/x.ts"]).admin).toBe(false);
    });

    describe("手動実行は選ばれた対象に従う（今までどおり）", () => {
        const m = (t?: string) => pickDeployTargets({ eventName: "workflow_dispatch", dispatchTarget: t, changed: null });
        it("both", () => expect(m("both")).toMatchObject({ admin: true, user: true }));
        it("admin-api", () => expect(m("admin-api")).toMatchObject({ admin: true, user: false }));
        it("user-api", () => expect(m("user-api")).toMatchObject({ admin: false, user: true }));
        it("未指定なら両方", () => expect(m(undefined)).toMatchObject({ admin: true, user: true }));
    });
});

/**
 * **ワークフローと突き合わせる。** 起動条件の `paths` に載っている
 * 「`api/` でも `api-user/` でもないファイル」は、必ず `SHARED` にも
 * 入っていること——入っていないと、そのファイルだけを変えた push で
 * 「どちらにも当たらない」に落ちる。いまは両方配るので害は無いが、
 * **理由が「読み違えた」になって記録が濁る**。
 */
describe("ワークフローの起動条件と揃っている", () => {
    // `on: push: paths:` の一覧を取り出す
    const paths = (() => {
        const m = /\n    paths:\n((?: {6}- .*\n)+)/.exec(WF);
        return (m?.[1] ?? "").split("\n").map((l) => l.replace(/^ {6}- /, "").replace(/"/g, "").trim())
            .filter(Boolean);
    })();

    it("paths が読めている", () => {
        expect(paths.length, "起動条件の paths が読めていない").toBeGreaterThan(0);
        expect(paths).toContain("api/**");
    });

    // ここに載っていて `api/` でも `api-user/` でもないファイルは、
    // それだけを変えた push で「どちらにも当たらない」に落ちる。
    // いまは両方配るので害は無いが、**理由が「読み違えた」になって記録が濁る**
    it("api/ でも api-user/ でもない paths は SHARED に在る", () => {
        for (const p of paths.filter((x) => !x.startsWith("api/") && !x.startsWith("api-user/"))) {
            expect(SHARED, `${p} が SHARED に入っていない`).toContain(p);
        }
    });
});

/**
 * 🔴 **判断が在るだけでは効かない。**
 *
 * このリポジトリは「実装はあるのに受け渡しが抜けていて、テストは緑」を
 * 何度も踏んでいる（`stripPrivate` が `body` に通っていなかった・
 * 新しい URL が `SET` 句に入っていなかった）。**鎖を見る。**
 */
describe("ワークフローに配線されている", () => {
    const config = job("config");
    const admin = job("deploy-admin-api");
    const user = job("deploy-user-api");

    it("判断の段が、この台本を実際に呼んでいる", () => {
        expect(config).toContain("id: targets");
        expect(config).toContain("node scripts/pick-deploy-targets.mjs");
    });

    it("判断の結果が job の outputs に出ている", () => {
        expect(config).toContain("deployAdmin: ${{ steps.targets.outputs.admin }}");
        expect(config).toContain("deployUser: ${{ steps.targets.outputs.user }}");
    });

    it("配るジョブが、その outputs を見て動く", () => {
        expect(admin).toContain("needs.config.outputs.deployAdmin == 'true'");
        expect(user).toContain("needs.config.outputs.deployUser == 'true'");
    });

    // **テストを通さずに配らない。** 畳んだときに `needs` を落とすと、
    // テストが落ちてもデプロイが走る形になる
    it("配るジョブは、テストを含むジョブを待つ", () => {
        expect(admin).toContain("needs: [config]");
        expect(user).toContain("needs: [config]");
        expect(config, "テストが config ジョブの中に無い").toContain("vitest run api api-user");
    });

    // **差分が引けないと節約が1回も効かない**（安全側に外れるので気づきにくい）
    it("履歴を全部取っている（差分に要る）", () => {
        expect(config).toMatch(/uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 0/);
    });
});
