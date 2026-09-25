import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 🔴 **プッシュの鍵は「送る関数」にだけ配り、送る関数には必ず配る。**
 *
 * `rebuildTokenScope.test.ts` と同じ形の見張り。あちらの教訓がそのまま
 * 当てはまる:
 *
 *   1. **provider には置かない。** `provider.environment` は**サービス内の
 *      全関数**に配られるので、未認証で呼べる口（`getPhotos` など）の環境変数に
 *      APNs の秘密鍵が入る。環境変数は `lambda:GetFunctionConfiguration`
 *      （読み取り権だけ）で読める
 *   2. **`deliverPush` に届く関数には配られている** ——こちらが本題。
 *      **配り忘れると、症状が再ビルドより静か**: `apnsConfigured()` が false に
 *      なって `notify.ts` が無言で return する。**ログすら出ない。**
 *      通知はアプリ内には積まれるので、気づけるのは「プッシュだけ来ない」と
 *      誰かが言ったときだけ
 *
 * 次に通知の経路が増えたとき（メッセージ・メンション・お知らせ）、
 * 100% この形で漏れる。だから人が突き合わせるのをやめる。
 */
const ROOT = join(__dirname, "..", "..");
const KEY = "APNS_PRIVATE_KEY";
/** 送り先。これが欠けても「設定済みのつもりで送れない」になる（5つで1組） */
const ALL_VARS = ["APNS_PRIVATE_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_TOPIC", "APNS_HOST"];

/**
 * `pushNotification` を**実際に呼んでいるファイル**（`api-user/src/*.ts`）。
 *
 * ⚠️ **依存を辿る形では精度が出ない。** 最初「`notify.ts` に届くか」で
 * 書いたら26関数、「グラフ内に呼び出しがあるか」でも22関数が引っかかった
 * ——`notify.ts` は `lookupDisplayName` / `deletedUserIds` も export していて
 * 通知を積まない関数がそれ目的で import するし、`stories.ts` は
 * `storyReplies.ts` を import するので `getStories` まで釣れる。
 *
 * なので**呼んでいるファイルを名指しで宣言し、その一覧が実物と一致すること**を
 * 見る。5本目が現れたら必ずここが落ちるので、そのとき env を配ったかを
 * 下のテストが続けて見る。
 */
const PUSHING_FILES = ["comments.ts", "follow.ts", "likes.ts", "storyReplies.ts"];

/** `api-user/src/*.ts` のうち、`pushNotification(...)` を呼んでいるもの */
function filesThatPush(): string[] {
    const dir = resolve(ROOT, "api-user", "src");
    return readdirSync(dir)
        .filter((f) => f.endsWith(".ts"))
        .filter((f) => {
            // **コメントを先に潰す**（経緯を1行書いただけで落ちる守りは外される）
            const src = readFileSync(join(dir, f), "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
            if (f === "notify.ts") return false;   // 定義の場所
            return /\bpushNotification\s*\(/.test(src);
        })
        .sort();
}

/**
 * `handler: src/foo.bar` の `bar` の**本文だけ**を切り出す
 * （`rebuildTokenScope.test.ts` と同じ手。ファイル単位で見ると、同じファイルに
 * 居るだけの関数まで「通知を出す」に見える——`likes.ts` には `likePhoto` と
 * `getLikeCount` が同居している）。
 */
function handlerBody(serviceDir: string, handler: string): string {
    const [file, name] = [handler.replace(/\.[^./]+$/, ""), handler.split(".").pop()!];
    const path = resolve(ROOT, serviceDir, file + ".ts");
    if (!existsSync(path)) return "";
    const src = readFileSync(path, "utf8");
    const start = new RegExp(`^export (?:const|function|async function) ${name}\\b`, "m").exec(src);
    if (!start) return "";
    const rest = src.slice(start.index + start[0].length);
    const next = /^(?:export )?(?:const|function|async function|type|interface) /m.exec(rest);
    return rest.slice(0, next ? next.index : rest.length)
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** その関数自身が通知を積むか */
const sendsPush = (handler: string) => /\bpushNotification\s*\(/.test(handlerBody("api-user", handler));

describe("api-user: APNs の鍵は送る関数にだけ配る", () => {
    const yml = readFileSync(join(ROOT, "api-user", "serverless.yml"), "utf8");
    const provider = yml.split(/\nfunctions:\n/)[0];
    const fnSection = yml.split(/\nfunctions:\n/)[1].split(/\n(?=[a-zA-Z#])/)[0];

    const fns = new Map<string, { handler: string; vars: string[] }>();
    for (const part of ("\n" + fnSection).split(/\n(?=  \w+:\n)/)) {
        const m = /^\n?  (\w+):/.exec(part);
        if (!m) continue;
        // **コメントを先に潰す。** 経緯を1行書いただけで落ちる守りは
        // やがて外される（`rebuildTokenScope` の教訓）
        const body = part.replace(/^\s*#.*$/gm, "");
        const h = /^\s{4}handler:\s*(\S+)\s*$/m.exec(body);
        if (!h) continue;
        fns.set(m[1], { handler: h[1], vars: ALL_VARS.filter((v) => body.includes(v)) });
    }

    it("関数を読み取れている（走査が空振りしていない）", () => {
        expect(fns.size).toBeGreaterThan(30);
    });

    it("provider.environment には置かない（全関数に配られる）", () => {
        for (const v of ALL_VARS) expect(provider, `${v} が全関数に配られている`).not.toContain(v);
    });

    // 🔴 本題。**通知を出す関数に配り忘れると、無言でプッシュが止まる**
    // 5本目が現れたら落ちる。そのとき下の2本が「env を配ったか」を見る
    it("`pushNotification` を呼ぶファイルは、宣言した一覧と一致する", () => {
        expect(filesThatPush(),
            "通知を積むファイルが増えた（減った）。`PUSHING_FILES` を直し、"
            + "その関数に APNs の env を配ったか確かめること").toEqual([...PUSHING_FILES].sort());
    });

    // 🔴 本題。**配り忘れると、無言でプッシュが止まる**
    it("通知を積む関数は、全部 鍵を持っている", () => {
        const missing = [...fns]
            .filter(([, v]) => sendsPush(v.handler) && !v.vars.includes(KEY))
            .map(([n]) => n);
        expect(missing,
            "通知を出す関数に APNs の鍵を配り忘れている。"
            + "`apnsConfigured()` が false になり、ログも出さずにプッシュだけ止まる").toEqual([]);
    });

    it("鍵を持つ関数は、通知を積むものだけ", () => {
        const extra = [...fns]
            .filter(([, v]) => v.vars.includes(KEY) && !sendsPush(v.handler))
            .map(([n]) => n);
        expect(extra, "送らない関数に秘密鍵を配っている").toEqual([]);
    });

    // 走査が空振りしていないことの自己確認（0件どうしの一致で緑にならない）
    it("通知を積む関数を1つ以上見つけている", () => {
        const sending = [...fns].filter(([, v]) => sendsPush(v.handler)).map(([n]) => n).sort();
        expect(sending).toEqual(["followUser", "likePhoto", "postComment", "postStoryReply"]);
    });

    // **5つで1組。** 中途半端に Key ID だけ入ると「設定済みのつもりで
    // 送れない」になる（`APNS_HOST` は既定値を置かないので、欠けると
    // `apnsConfigured()` が false）
    it("鍵を配る関数には、5つ全部を配る", () => {
        const partial = [...fns]
            .filter(([, v]) => v.vars.length > 0 && v.vars.length < ALL_VARS.length)
            .map(([n, v]) => `${n}: ${ALL_VARS.filter((x) => !v.vars.includes(x)).join(",")} が無い`);
        expect(partial).toEqual([]);
    });
});
