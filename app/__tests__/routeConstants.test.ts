import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROUTES } from "@/lib/routes";

/**
 * **サイト内の行き先は `ROUTES` を通す。**
 *
 * ⚠️ これは「きれいに書く」ための規則ではなく、**測定のための規則**。
 *
 * 2026-09-16、`ROUTES.*` を grep して「投稿・下書き・プロフィール設定への
 * 導線がメニューにもフッターにも無い」と**欠陥として報告しかけた**。
 * 実際には3つとも在って、`UserProfileClient.tsx` が
 * `href="/user/upload"` と**文字列で直書き**していただけだった
 * ——`ROUTES` を数えても出てこない。
 *
 * 直書きが混ざっていると、
 *   - 導線の有無を機械で数えられない（今回の誤報）
 *   - パスを変えたときに片方だけ残る（台帳がいちばん多く記録している型）
 *
 * **クエリを組む側（`?id=`・`?photo=`）は対象外**。あちらは
 * `ROUTES.PHOTO` / `ROUTES.USER_PROFILE` が id ごとに組む値で、
 * 静的な文字列として書ける形が無い。
 */

/** `ROUTES` の静的な値（関数でないもの）だけを集める */
const STATIC_PATHS = Object.entries(ROUTES)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => [k, v as string] as const)
    // ルート（"/"）は `href="/"` が普通なので除く（ロゴ・パンくず）
    .filter(([, v]) => v !== "/");

function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
        if (e === "__tests__" || e === "node_modules") continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) sources(p, out);
        else if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
}

/** 行コメント・ブロックコメントを落としてから走査する（説明文に一致させない） */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FILES = sources("app").filter((f) => f !== "app/__tests__/routeConstants.test.ts");

describe("サイト内の行き先は ROUTES を通す（導線を機械で数えられるように）", () => {
    it("ROUTES の静的なパスを直書きした href が1つも無い", () => {
        const hits: string[] = [];
        for (const f of FILES) {
            const src = strip(readFileSync(f, "utf8"));
            for (const [key, path] of STATIC_PATHS) {
                const re = new RegExp(`href=(?:"${path}"|'${path}'|\\{\`${path}\`\\})`, "g");
                let m: RegExpExecArray | null;
                while ((m = re.exec(src))) {
                    const line = src.slice(0, m.index).split("\n").length;
                    hits.push(`${f}:${line} ${m[0]} → ROUTES.${key} を使う`);
                }
            }
        }
        expect(hits, `直書きの href:\n${hits.join("\n")}`).toEqual([]);
    });

    // **検出器の自己確認。** いま0件なので、壊れた検出器と正しい検出器が
    // 同じ答えを返す（台帳の `68134035` と同じ立場）
    it("検出器が、直書きを見分けられる", () => {
        const find = (src: string) => {
            const s = strip(src);
            return STATIC_PATHS.filter(([, path]) =>
                new RegExp(`href=(?:"${path}"|'${path}'|\\{\`${path}\`\\})`).test(s));
        };
        expect(find(`<a href="${ROUTES.UPLOAD}">`), "直書きを見逃している").toHaveLength(1);
        expect(find(`<a href='${ROUTES.DRAFTS}'>`), "シングルクォートを見逃している").toHaveLength(1);
        expect(find("<Link href={ROUTES.UPLOAD}>"), "定数を使っている行を誤検知している").toHaveLength(0);
        expect(find(`// 以前は href="${ROUTES.UPLOAD}" と書いていた`), "コメントを検知している").toHaveLength(0);
        expect(find(`/* href="${ROUTES.UPLOAD}" */`), "ブロックコメントを検知している").toHaveLength(0);
        expect(find(`<a href="${ROUTES.UPLOAD}x">`), "別のパスを誤検知している").toHaveLength(0);
    });

    // 一覧が空だと上の判定が何も見ない
    it("見ているパスが十分にある", () => {
        expect(STATIC_PATHS.length).toBeGreaterThanOrEqual(10);
        expect(FILES.length).toBeGreaterThan(50);
    });
});
