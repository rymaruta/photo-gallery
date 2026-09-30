import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **通報の理由は2か所にある。**
 *
 *     api-user/src/report.ts        REPORT_REASONS      サーバーが通す値
 *     app/components/ReportDialog   REPORT_REASON_LABELS 画面が出す選択肢
 *
 * 片方だけ増やすと「選べるのに 400 で断られる」か「送れるのにサーバーが
 * 知らない値」になる。**画面から import すれば1つにできるが、
 * `api-user` を `app/` から import すると `next build` が落ちる**
 * （`7276c2b8`——`exclude` は import で辿られたファイルを止められず、
 *  `@types/aws-lambda` が見つからなくなって**本番リリースが止まった**）。
 * だから写しは残し、**ソースを読んで突き合わせる**。
 *
 * 補足の上限（`REPORT_NOTE_MAX` / `NOTE_MAX`）も同じ理由で2か所にある。
 */
const read = (p: string) => readFileSync(join(__dirname, "../../..", p), "utf8");

const listFrom = (src: string, name: string): string[] => {
    const m = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as const)?;`).exec(src);
    if (!m) throw new Error(`${name} を読めない（名前が変わった？）`);
    return [...m[1].matchAll(/(?:value:\s*)?"([a-z]+)"/g)].map((x) => x[1]);
};

describe("通報の理由が、画面とサーバーで食い違わない", () => {
    const server = read("api-user/src/report.ts");
    const client = read("app/components/ReportDialog.tsx");

    it("読み取り自体が効いている（空振りで通らない）", () => {
        expect(listFrom(server, "REPORT_REASONS").length).toBeGreaterThan(3);
        expect(listFrom(client, "REPORT_REASON_LABELS").length).toBeGreaterThan(3);
        expect(() => listFrom(server, "NO_SUCH_LIST")).toThrow();
    });

    it("同じ値・同じ並び", () => {
        expect(listFrom(client, "REPORT_REASON_LABELS"), "画面とサーバーで理由がずれている")
            .toEqual(listFrom(server, "REPORT_REASONS"));
    });

    it("補足の上限が同じ", () => {
        const s = /REPORT_NOTE_MAX\s*=\s*(\d+)/.exec(server)?.[1];
        const c = /NOTE_MAX\s*=\s*(\d+)/.exec(client)?.[1];
        expect(s, "サーバーの上限を読めない").toBeTruthy();
        expect(c, "画面の上限を読めない").toBeTruthy();
        expect(c, "画面で打てるのにサーバーが切る（またはその逆）").toBe(s);
    });
});
