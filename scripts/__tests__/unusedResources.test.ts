import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classify, KNOWN } = require("../unused-resources.js") as {
    classify: (name: string, opts?: { known?: string[]; prefixes?: string[] }) => string;
    KNOWN: { buckets: string[]; distributions: string[]; tables: string[]; pools: string[]; functionPrefixes: string[] };
};

/**
 * **「使っていない」と言い切らないための仕分け。**
 *
 * この道具の目的は費用の当たりを付けることで、**消す判断は人がする**。
 * いちばん危ないのは「知らない＝不要」と読ませること——別のプロジェクトの
 * ものかもしれないし、コンソールで手で作った依存（CloudFront の関数・
 * 応答ヘッダーポリシー・Route53・ACM）は**このリポジトリのコードに
 * 一切現れない**。
 *
 * なので仕分けの語を固定する。
 */
describe("在るものの仕分け", () => {
    it("名指ししているものは「使っている」", () => {
        expect(classify("prod-journey-photo.com", { known: KNOWN.buckets })).toContain("使っている");
        expect(classify("EYRLTGCPOS9E4", { known: KNOWN.distributions })).toContain("使っている");
    });

    it("命名規則に合うものも「使っている」（関数は80件超あるので名前で列挙しない）", () => {
        expect(classify("photo-gallery-api-prod-savePhoto", { prefixes: KNOWN.functionPrefixes })).toContain("使っている");
        expect(classify("photo-gallery-user-api-staging-getStories", { prefixes: KNOWN.functionPrefixes })).toContain("使っている");
    });

    // **ここがいちばん大事。** 知らないものを「不要」と呼ばない
    it("知らないものを「不要」と呼ばない", () => {
        const s = classify("some-other-project-bucket");
        expect(s).toContain("判断がつかない");
        expect(s).toContain("触らない");
        expect(s).not.toContain("不要");
        expect(s).not.toContain("消");
    });

    // 消した環境の残骸は見分けたい（費用が残り続けるので）。ただし
    // 「残骸かも」であって「消してよい」ではない
    it("このプロジェクトの名前だが構成にないものは、そう名指しする（断定はしない）", () => {
        const s = classify("dev-journey-photo-upload");
        expect(s).toContain("いまの構成にない");
        expect(s).toContain("かも");
        expect(s).not.toContain("消してよい");
    });

    it("`photo-gallery` で始まる見知らぬものも同じ扱い", () => {
        expect(classify("photo-gallery-old-thing")).toContain("いまの構成にない");
    });

    // 本番と staging のどちらも「使っている」側に入っていること
    it("本番と staging を両方 知っている（片方だけだと staging が残骸に見える）", () => {
        for (const b of ["prod-journey-photo.com", "staging-journey-photo.com"]) {
            expect(classify(b, { known: KNOWN.buckets }), b).toContain("使っている");
        }
        for (const t of ["prod-photo-gallery-photos", "staging-photo-gallery-users"]) {
            expect(classify(t, { known: KNOWN.tables }), t).toContain("使っている");
        }
        for (const p of ["prod-journey-photo-client-spa", "staging-journey-photo-client-spa"]) {
            expect(classify(p, { known: KNOWN.pools }), p).toContain("使っている");
        }
    });

    it("空や未定義でも落ちない", () => {
        expect(classify("")).toContain("判断がつかない");
        expect(classify(undefined as unknown as string)).toContain("判断がつかない");
    });

    // 一覧が空になると全部「判断がつかない」に落ちて、読み手が
    // 「全部要らないのか」と誤解する
    it("知っている一覧が空でない", () => {
        expect(KNOWN.buckets.length).toBeGreaterThan(3);
        expect(KNOWN.tables.length).toBeGreaterThan(3);
        expect(KNOWN.functionPrefixes.length).toBeGreaterThan(3);
    });
});
