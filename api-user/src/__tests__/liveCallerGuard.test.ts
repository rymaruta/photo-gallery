import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * **認証つきの書く口は、全部が退会の確かめ（`liveCaller.ts`）を通る。**
 *
 * API Gateway の JWT オーソライザは署名と exp しか見ないので、退会して Cognito の
 * ユーザーを消しても、配ったトークンは期限まで通る。2026-10-18 に走査すると、墓石を
 * 見ていたのはプロフィールの読み書き・購入・光の予報・トランクの硬貨だけで、
 * 写真の保存（`savePhoto`）を含む20を超える書く口が素通しだった
 * ——退会の掃除が済んだあとに、写真・コメント・フォロー・端末の登録……を作り直す。
 *
 * 新しい書く口を足した日に、確かめを入れ忘れると同じ穴が開く。だから
 * `serverless.yml` から**認証つきの GET 以外の口を全部**拾い、そのハンドラ
 * （export の本体）が共通の確かめを呼んでいることを要求する。
 * 呼ばない口は、**理由つきで下の EXCLUDED に並べる**（`accountCleanupRows.test.ts` と同じ形）。
 *
 * ⚠️ GET の中で書く口は拾えない（例: `GET /user/profile` は行を作り直す・`GET /user/trunk` は
 * 控えを書き直す）。どちらも墓石を見ている（`getMyProfile` の 410・trunk の口の 410）。
 */

const SRC = path.join(__dirname, "..");
const YML = readFileSync(path.join(SRC, "..", "serverless.yml"), "utf8");

/** 共通の確かめ。どれか1つを export の本体で呼んでいればよい */
const GUARD = /\b(?:assertLiveCaller|readLiveCaller|goneIfDeleted)\(/;

/** コメントを先に落とす。**理由を書くほど綴りが自分の説明に一致する**（台帳の型） */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

type Route = { fn: string; handler: string; method: string; path: string; authorized: boolean };

/**
 * `functions:` の節を関数ごとに割り、httpApi の口を拾う。
 * **YAML パーサは使わない**（`saves.test.ts` の判断: `js-yaml` は推移依存）。
 * 区切りは「列0の英字」だけ（列0のコメントで走査が縮まないように。同じく `saves.test.ts`）
 */
export function routesOf(yml: string): Route[] {
    const body = yml.split(/\nfunctions:\n/)[1];
    if (!body) throw new Error("functions: が見つからない");
    const section = body.split(/\n(?=[a-zA-Z])/)[0];
    const out: Route[] = [];
    const blocks = section.split(/^(?= {2}\w+:$)/m);
    for (const b of blocks) {
        const fn = b.match(/^ {2}(\w+):$/m)?.[1];
        const handler = b.match(/^ {4}handler:\s*(\S+)/m)?.[1];
        if (!fn || !handler) continue;
        for (const ev of b.split(/^\s+- httpApi:/m).slice(1)) {
            const method = ev.match(/^\s+method:\s*(\S+)/m)?.[1];
            const p = ev.match(/^\s+path:\s*(\S+)/m)?.[1];
            if (!method || !p) continue;
            out.push({ fn, handler, method: method.toUpperCase(), path: p, authorized: /^\s+authorizer:/m.test(ev) });
        }
    }
    return out;
}

/** `src/upload.savePhoto` → export の本体（コメント抜き）。見つからなければ投げる */
export function exportBody(src: string, name: string): string {
    const code = stripComments(src);
    const m = code.match(new RegExp(`^export (?:const ${name}\\b|async function ${name}\\b)`, "m"));
    if (!m || m.index === undefined) throw new Error(`export ${name} が見つからない`);
    const rest = code.slice(m.index);
    // 本体の終わり＝列0の閉じ括弧（`};` か `}`）
    const end = rest.search(/^\};?\s*$/m);
    return end < 0 ? rest : rest.slice(0, end);
}

function bodyOfHandler(handler: string): string {
    const [file, name] = [handler.slice(0, handler.lastIndexOf(".")), handler.slice(handler.lastIndexOf(".") + 1)];
    const p = path.join(SRC, "..", `${file}.ts`);
    if (!existsSync(p)) throw new Error(`${handler} のファイルが無い`);
    return exportBody(readFileSync(p, "utf8"), name);
}

/**
 * **確かめを呼ばない口。** 「消す・外す」の系統と、既に自分で墓石を見ている口だけ。
 * 自分で見ている口は、その確かめが今も在ることを `stillChecks` で見る
 * （消えた日に、ここが黙って穴を覆わないように）。
 */
const EXCLUDED: Array<{ route: string; reason: string; stillChecks?: [file: string, fn: string, re: RegExp] }> = [
    { route: "DELETE /user/account", reason: "退会そのもの。やり直し（途中で落ちた回の続き）も通す" },
    { route: "DELETE /upload/discard", reason: "削除の系統（上げた実体を消す）" },
    { route: "DELETE /photos/{id}", reason: "削除の系統" },
    { route: "DELETE /albums/{id}", reason: "削除の系統" },
    { route: "DELETE /albums/{id}/invite", reason: "削除の系統（招待の取り消し）" },
    { route: "DELETE /stories/{id}", reason: "削除の系統" },
    { route: "DELETE /user/close-friends/{id}", reason: "外す。PUT と同じハンドラで、PUT のときだけ確かめる" },
    { route: "DELETE /photos/{id}/like", reason: "削除の系統（いいねを外す）" },
    { route: "DELETE /photos/{id}/save", reason: "削除の系統（保存を外す）" },
    { route: "DELETE /user/spots/{slug}", reason: "削除の系統" },
    { route: "DELETE /user/trips/{planId}", reason: "削除の系統" },
    { route: "DELETE /user/trunk/labels/{id}", reason: "削除の系統。trunk の口は DELETE 以外を確かめる" },
    { route: "DELETE /photos/{id}/comments/{commentId}", reason: "削除の系統" },
    { route: "DELETE /users/{uid}/follow", reason: "削除の系統（フォローを外す）" },
    { route: "DELETE /users/{id}/block", reason: "削除の系統（ブロックを外す）" },
    { route: "DELETE /user/devices", reason: "端末の登録の解除（退会した端末から通知の宛先を外せるように）" },
    { route: "DELETE /highlights/{id}", reason: "削除の系統" },
    {
        route: "PUT /user/profile", reason: "前から自分の読み（getProfile）で墓石を見て 410（読みを増やさない）",
        stillChecks: ["userProfile.ts", "updateMyProfile", /isDeletedProfile\(prev\)[\s\S]{0,200}statusCode: 410/],
    },
    {
        route: "POST /user/purchases", reason: "前から自分の読みで墓石を見て 410。退会済みなら結び付けも消す（先に止めると消せない）",
        stillChecks: ["purchases.ts", "recordPurchase", /status === "deleted"[\s\S]{0,600}jsonError\(410/],
    },
    {
        route: "POST /user/trunk/welcome", reason: "硬貨を配る前に自分の読みで墓石を見る（配らずに 200）。印のある2回目以降は users を読まない設計",
        stillChecks: ["trunk.ts", "welcomeCoins", /isDeletedProfile\(profile\)\) return/],
    },
    {
        route: "POST /user/trunk/reward", reason: "同上（お礼の硬貨）",
        stillChecks: ["trunk.ts", "rewardCoins", /isDeletedProfile\(profile\)\) return/],
    },
];

const routes = routesOf(YML);
const writes = routes.filter((r) => r.authorized && r.method !== "GET");
const key = (r: Route) => `${r.method} ${r.path}`;
const excluded = new Map(EXCLUDED.map((e) => [e.route, e]));

/**
 * 確かめが要るハンドラ（除外されていない書く口を1つでも持つもの）。
 * 1つのハンドラが複数の口を持つ（trunk・親しい友達の PUT/DELETE）ので、ハンドラ単位で見る
 */
export function handlersNeedingGuard(ws: Route[], ex: ReadonlySet<string>): string[] {
    return [...new Set(ws.filter((r) => !ex.has(key(r))).map((r) => r.handler))].sort();
}

describe("走査の自己確認", () => {
    it("serverless.yml から書く口を十分な数だけ拾えている（走査が静かに縮んでいない）", () => {
        // 2026-10-18 の実測: 認証つきの GET 以外は 57 口
        expect(writes.length).toBeGreaterThanOrEqual(55);
        expect(writes.map(key)).toEqual(expect.arrayContaining([
            "POST /upload/presigned-url", "POST /upload/save", "POST /photos/{id}/comments", "POST /user/devices",
        ]));
    });

    it("除外に置いた口がハンドラを丸ごと外すわけではない（合成の入力）", () => {
        const r = (method: string, p: string, handler: string): Route => ({ fn: "f", handler, method, path: p, authorized: true });
        const ws = [r("PUT", "/a", "src/x.h"), r("DELETE", "/a", "src/x.h"), r("DELETE", "/b", "src/y.h")];
        expect(handlersNeedingGuard(ws, new Set(["DELETE /a", "DELETE /b"]))).toEqual(["src/x.h"]);
        expect(handlersNeedingGuard(ws, new Set())).toEqual(["src/x.h", "src/y.h"]);
    });

    it("見張りは確かめの無い本体を見逃さない（合成の入力）", () => {
        const src = [
            "export const a = async (event) => {",
            "    // assertLiveCaller(uid) はコメントなので数えない",
            "    return ok();",
            "};",
            "export const b = async (event) => {",
            "    const gone = await assertLiveCaller(uid);",
            "};",
        ].join("\n");
        expect(GUARD.test(exportBody(src, "a"))).toBe(false);
        expect(GUARD.test(exportBody(src, "b"))).toBe(true);
    });
});

describe("認証つきの書く口は、退会の確かめを通る", () => {
    const need = handlersNeedingGuard(writes, new Set(excluded.keys()));

    it("確かめの要るハンドラに、保存と署名の口が入っている", () => {
        expect(need).toEqual(expect.arrayContaining(["src/upload.savePhoto", "src/upload.presignedUrl", "src/trunk.handler"]));
    });

    it.each(need)("%s が liveCaller の確かめを呼ぶ", (h) => {
        expect(GUARD.test(bodyOfHandler(h)), `${h} が assertLiveCaller / readLiveCaller / goneIfDeleted を呼んでいない`).toBe(true);
    });

    it("除外の一覧に、もう無い口が残っていない（残すと同じ名前の新しい口を黙って吸う）", () => {
        const present = new Set(writes.map(key));
        expect(EXCLUDED.map((e) => e.route).filter((r) => !present.has(r))).toEqual([]);
    });

    it.each(EXCLUDED.filter((e) => e.stillChecks).map((e) => [e.route, e.stillChecks!] as const))(
        "%s は今も自分で墓石を見ている",
        (_route, [file, fn, re]) => {
            expect(exportBody(readFileSync(path.join(SRC, file), "utf8"), fn)).toMatch(re);
        },
    );
});
