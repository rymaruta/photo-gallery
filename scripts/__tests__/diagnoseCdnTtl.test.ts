import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **LEFT-4「削除がエッジに何日残るか」に、診断が答えられていなかった。**
// 出していたのは `cachePolicyId=658327ea-…（TTL はポリシー側）` だけで、
// ID からは秒数が読めない（本番実測 2026-09-05: 5つの behavior のうち
// 4つがこの形だった）。ポリシーを引いて秒で出す。

const require_ = createRequire(import.meta.url);
const { describeBehavior, humanSeconds, residencyNote, UPLOAD_MAX_AGE, countInvalidationSources, compressNote, errorPageNote, cdnLines } = require_("../diagnose-aws.js") as {
    describeBehavior: (b: Record<string, unknown>, p: Map<string, unknown>) => string;
    humanSeconds: (s: unknown) => string;
    residencyNote: () => string[];
    UPLOAD_MAX_AGE: number;
    countInvalidationSources: (refs: string[]) => { total: number; fromLambda: number; latestLambda: string | null };
    compressNote: (behaviors: Record<string, unknown>[]) => string[];
    errorPageNote: (items: Record<string, unknown>[]) => string[];
    cdnLines: (behaviors: Record<string, unknown>[], policies: Map<string, unknown>, errorResponses?: Record<string, unknown>[]) => string[];
};

const OPTIMIZED = new Map([["p1", {
    name: "Managed-CachingOptimized", MinTTL: 1, DefaultTTL: 86400, MaxTTL: 31536000,
}]]);

describe("CloudFront の TTL の出し方", () => {
    // **1行を丸ごと固定する。** `toContain` の羅列だと
    // **`defaultTTL` と `maxTTL` のラベルを入れ替えても素通り**した
    // （レビューが変異21種で実測。素通り13種）。目的は「maxTTL の秒数を
    // 正しく読ませる」ことなので、どの数がどのラベルに付くかまで見る
    it("ポリシーを引けた行は、この文字列そのもの", () => {
        expect(describeBehavior({ PathPattern: "/uploads/*", CachePolicyId: "p1" }, OPTIMIZED))
            .toBe("  /uploads/*: Managed-CachingOptimized defaultTTL=86400秒（約1日） maxTTL=31536000秒（約365日） minTTL=1秒 圧縮=不明");
    });

    it("旧式の行も、この文字列そのもの", () => {
        expect(describeBehavior({ PathPattern: "/old/*", DefaultTTL: 3600, MaxTTL: 86400, MinTTL: 0 }, OPTIMIZED))
            .toBe("  /old/*: 旧式 defaultTTL=3600秒（約1時間） maxTTL=86400秒（約1日） minTTL=0秒 圧縮=不明");
    });

    it("読めなかった行も、この文字列そのもの", () => {
        expect(describeBehavior({ PathPattern: "/x/*", CachePolicyId: "none" }, OPTIMIZED))
            .toBe("  /x/*: cachePolicyId=none（ポリシーを読めなかった＝TTL 不明） 圧縮=不明");
    });

    it("ポリシーを引けたら秒と日で出す（ID だけで終わらせない）", () => {
        const out = describeBehavior({ PathPattern: "/uploads/*", CachePolicyId: "p1" }, OPTIMIZED);
        expect(out).toContain("/uploads/*");
        expect(out).toContain("Managed-CachingOptimized");
        expect(out, "maxTTL の秒が出ていない").toContain("31536000");
        expect(out, "日に直していない（ID だけ出していた頃と同じ）").toContain("約365日");
        expect(out).not.toContain("TTL はポリシー側");
    });

    // **読めなかったことを「ポリシー側」で誤魔化さない**（分かっていない、と書く）
    it("ポリシーを読めなかったら「不明」と書く", () => {
        const out = describeBehavior({ PathPattern: "/x/*", CachePolicyId: "none" }, OPTIMIZED);
        expect(out).toContain("TTL 不明");
    });

    // 既定の behavior は PathPattern を持たない
    it("既定の behavior は (default) と出す", () => {
        expect(describeBehavior({ CachePolicyId: "p1" }, OPTIMIZED)).toContain("(default)");
    });

    // 旧式（behavior に直接 TTL を書く形）も読めるままにしておく
    it("旧式の behavior はその値をそのまま出す", () => {
        const out = describeBehavior({ PathPattern: "/old/*", DefaultTTL: 3600, MaxTTL: 86400, MinTTL: 0 }, OPTIMIZED);
        expect(out).toContain("旧式");
        expect(out).toContain("3600");
        expect(out).toContain("約1時間");
    });

    it.each([
        [0, "0秒"],
        [59, "59秒"],
        [3600, "約1時間"],
        [86400, "約1日"],
        [31536000, "約365日"],
    ])("%s 秒を読める形にする", (sec, expected) => {
        expect(humanSeconds(sec)).toContain(expected);
    });

    it("数でない値は ? にする（NaN 秒と書かない）", () => {
        expect(humanSeconds(undefined)).toBe("?");
        expect(humanSeconds("86400")).toBe("?");
    });
});

// **この行は本番の診断ログに印字される断定**。一度ここに
// 「削除経路に CreateInvalidation は無い」と書いて出したが誤りだった
// （退会・ストーリー削除・期限切れ掃除には前からある）。
// 文面を変えたらここが落ちる。
describe("残存期間の解釈（LEFT-4）", () => {
    it("エッジの掃除がある経路と無い経路を、名指しで書く", () => {
        const text = residencyNote().join("\n");
        expect(text, "誤った断定に戻っている").not.toContain("削除経路に CreateInvalidation は");
        for (const path of ["退会", "ストーリー削除", "期限切れ掃除", "自分の写真削除", "管理APIの削除"]) {
            expect(text, `掃除がある経路 ${path} を落としている`).toContain(path);
        }
        // **直した側を「無い側」に置き去りにしない。** 実際に一度やった
        // ——`0a30de3d` で管理APIに掃除を足したのに、この行は
        // 「管理APIの deletePhoto…には無いので」と言い続けていた
        expect(text, "掃除を足した経路を、まだ無い側に書いている").not.toContain("には無いので");
        expect(text, "残る経路（discardUpload）を名指ししていない").toContain("discardUpload");
        expect(text).toContain(`max-age=${UPLOAD_MAX_AGE}`);
    });

    // **二重管理の突き合わせ。** 秒数は診断・`api-user/src/upload.ts`・
    // `api/src/upload.ts` の3か所にある。片方を変えても診断は黙って
    // 古い値を言い続けるので、ソースを読んで揃っていることを見る
    it.each([
        ["api-user/src/upload.ts"],
        ["api/src/upload.ts"],
    ])("%s の Cache-Control と同じ秒数を使っている", (rel) => {
        const src = readFileSync(join(__dirname, "..", "..", rel), "utf8");
        const m = src.match(/CacheControl:\s*"max-age=(\d+)"/);
        expect(m, `${rel} に max-age の指定が無い（経路が変わった？）`).not.toBeNull();
        expect(Number(m![1]), "診断が言う秒数とアップロード側がずれている").toBe(UPLOAD_MAX_AGE);
    });
});

// **`exclude: ['@aws-sdk/*']` なので SDK はバンドルされない。**
// `@aws-sdk/client-cloudfront` が Lambda ランタイムに無ければ、
// `invalidateUploads` は警告1行で静かに落ちる（＝削除しても掃除されない）。
// 中からは分からないので、無効化の履歴を外から見て見分ける。
describe("無効化を誰が作ったか（LEFT-4 の効き確認）", () => {
    it("Lambda 由来（del-…）だけを数える", () => {
        const out = countInvalidationSources([
            "del-1757000000000-0-3",   // Lambda（削除・退会・ストーリー掃除）
            "1757000000000-0",          // デプロイ（deploy-static-site.js）
            "reheal-1757000000000",     // デプロイの 5xx 再無効化
            "restrict-originals-1757",  // 保守スクリプト
            "shrink-profiles-1757",     // 保守スクリプト
        ]);
        expect(out).toEqual({ total: 5, fromLambda: 1, latestLambda: "del-1757000000000-0-3" });
    });

    // **「まだ誰も消していない」と「動いていない」を混ぜない。**
    // 0件は証拠にならない（この診断の出力もそう書く）
    it("Lambda 由来が無ければ 0 と null（推測で埋めない）", () => {
        expect(countInvalidationSources(["1757000000000-0"]))
            .toEqual({ total: 1, fromLambda: 0, latestLambda: null });
        expect(countInvalidationSources([])).toEqual({ total: 0, fromLambda: 0, latestLambda: null });
    });

    // 頭が `del-` の判定であること（`del` を含むだけの別物を拾わない）
    it("頭が del- のものだけ（含むだけでは数えない）", () => {
        expect(countInvalidationSources(["shrink-del-1", "xdel-2"]).fromLambda).toBe(0);
    });
});


/**
 * **圧縮しているかを、診断が出していなかった。**
 *
 * 2026-09-12 にビルドの出力を数えて「写真ページ 688KB → gzip 215KB」と
 * 報告したが、**その gzip を掛けるのは CloudFront**で、
 * `scripts/deploy-static-site.js` は `ContentEncoding` を付けない
 * （事前に圧縮して上げてはいない）。つまり配信側の `Compress` ひとつで
 * 決まるのに、診断は TTL しか出していなかった——**見積もりが3倍外れて
 * いても誰も気づけない**。
 *
 * 台帳の型「道具が『0件』と言うとき、数え方を疑う」の裏返し:
 * **道具が何も言わない項目は、無いのではなく見ていない。**
 */
describe("圧縮しているかを出す", () => {
    it("行の末尾に ON / OFF / 不明 を付ける", () => {
        const at = (c: unknown) => describeBehavior({ PathPattern: "/x/*", CachePolicyId: "p1", Compress: c }, OPTIMIZED);
        expect(at(true)).toContain("圧縮=ON");
        expect(at(false), "OFF が目立たない").toContain("圧縮=**OFF**");
        expect(at(undefined), "読めなかったのを ON 扱いにしている").toContain("圧縮=不明");
    });

    // **秒数と同じで、`Compress=false` とだけ出しても意味が伝わらない。**
    // 「何が起きるか」と「どこを直すか」まで書く
    it("OFF の経路は名指しして、何が起きるかを書く", () => {
        const out = compressNote([
            { PathPattern: "/_next/static/*", Compress: true },
            { PathPattern: "/uploads/*", Compress: false },
            { Compress: false },
        ]).join("\n");
        expect(out).toContain("/uploads/*");
        expect(out, "既定の経路を名指ししていない").toContain("(default)");
        expect(out, "ON の経路まで名指ししている").not.toContain("/_next/static/*");
        expect(out, "何が起きるかを書いていない").toContain("そのままのバイト数");
        expect(out, "どこを直すかを書いていない").toContain("自動的に圧縮");
    });

    it("全部 ON なら、そう言い切る", () => {
        expect(compressNote([{ Compress: true }, { PathPattern: "/x/*", Compress: true }]).join("\n"))
            .toContain("全経路で ON");
    });

    // **読めなかったのを「ON」に丸めない。** 丸めると、権限が足りない日に
    // 「圧縮されている」と嘘を報告する
    it("読めなかった経路は、別に名指しする", () => {
        const out = compressNote([{ PathPattern: "/y/*" }]).join("\n");
        expect(out).toContain("読めなかった");
        expect(out).toContain("/y/*");
        expect(out, "読めないのを「全部 ON」にしている").not.toContain("全経路で ON");
    });
});

/**
 * **配線は「呼んだか」ではなく「出た行」で見る。**
 * 前は `cdnTtl()` の中で順に `line()` していたので、`compressNote` の
 * 呼び出しを**丸ごと消しても全テストが緑**だった（変異で確認）。
 */
describe("CDN の節に出す行（組み立て）", () => {
    const behaviors = [
        { PathPattern: "/uploads/*", CachePolicyId: "p1", Compress: false },
        { CachePolicyId: "p1", Compress: true },
    ];
    it("TTL の行・圧縮の注記・残り期間の注記が全部入る", () => {
        const out = cdnLines(behaviors, OPTIMIZED);
        expect(out.some((l) => l.includes("/uploads/*") && l.includes("maxTTL=")), "TTL の行が無い").toBe(true);
        expect(out.some((l) => l.includes("圧縮が OFF の経路")), "圧縮の注記が無い").toBe(true);
        expect(out.join("\n"), "残り期間の注記が無い").toContain(residencyNote()[0]);
    });

    it("behavior の数だけ TTL の行が出る（1つも落とさない）", () => {
        const ttlLines = cdnLines(behaviors, OPTIMIZED).filter((l) => l.includes("maxTTL="));
        expect(ttlLines).toHaveLength(behaviors.length);
    });
});

/**
 * **静的サイトの 404 は CloudFront の設定で決まる。**
 *
 * `fix-cdn-error-pages.js` が 403/404 を `/404.html` に振り替え、
 * **ステータスは 404 のまま**返すよう設定する。これが無いと
 * `/404.html` の中身が **200 で**返る＝soft-404 になり、消した写真の URL も
 * 「中身のあるページ」として扱われて**検索エンジンが索引に残し続ける**。
 *
 * ところが**その設定を確かめるものが何も無かった**——圧縮と同じ盲点で、
 * ディストリビューションを作り直した日に静かに戻る。
 */
describe("存在しない URL に何を返しているか", () => {
    const ok = [
        { ErrorCode: 403, ResponsePagePath: "/404.html", ResponseCode: "404" },
        { ErrorCode: 404, ResponsePagePath: "/404.html", ResponseCode: "404" },
    ];

    it("正しい設定なら `!!` を出さない", () => {
        const out = errorPageNote(ok).join("\n");
        expect(out).toContain("404 → /404.html / ステータス 404");
        expect(out, "正しい設定に !! を出している").not.toContain("!!");
    });

    // **200 で返すのが soft-404。** 何が起きるかまで書く（秒数と同じ）。
    // **403 も揃えたフィクスチャで見る**——404 だけだと「403 の振り替えが
    // 無い」の `!!` が出て、**その行のおかげで判定が通ってしまう**
    // （実際そうなっていて、ステータスを見ない変異が2種素通りした）
    it("200 で返していたら soft-404 と言い、その行に `!!` を出す", () => {
        const lines = errorPageNote([
            { ErrorCode: 403, ResponsePagePath: "/404.html", ResponseCode: "404" },
            { ErrorCode: 404, ResponsePagePath: "/404.html", ResponseCode: "200" },
        ]);
        const out = lines.join("\n");
        expect(out, "soft-404 だと言っていない").toContain("soft-404");
        expect(out, "何が起きるかを書いていない").toContain("索引に残り続ける");
        // **その 404 の行自体**に `!!` が付いていること（別の行の `!!` で
        // 通さない）
        const line404 = lines.find((l) => l.includes("404 → /404.html / ステータス 200"));
        expect(line404, "404 の行が出ていない").toBeTruthy();
        expect(line404, "ステータスを見ていない（期待は404 と言っていない）").toContain("!!");
        expect(lines.filter((l) => l.includes("403")).join(""), "正しい 403 に !! を出している").not.toContain("!!");
    });

    it("振り替えが片方だけなら、無い方を名指しする", () => {
        const out = errorPageNote([{ ErrorCode: 404, ResponsePagePath: "/404.html", ResponseCode: "404" }]).join("\n");
        expect(out).toContain("403 の振り替えが無い");
        expect(out, "在る方まで !! にしている").toContain("404 → /404.html / ステータス 404");
    });

    it("1つも無ければ、何が起きるかとどこで直すかを書く", () => {
        const out = errorPageNote([]).join("\n");
        expect(out).toContain("1つも無い");
        expect(out, "何が起きるかを書いていない").toContain("S3 の XML エラー");
        expect(out, "どこで直すかを書いていない").toContain("cdn-error-pages");
    });

    // 振り替え先が別のページになっていたら気づく。
    // **403 も揃えて、その行自体を見る**（欠けた 403 の `!!` で通さない）
    it("振り替え先が違えば、その行に `!!` を出す", () => {
        const lines = errorPageNote([
            { ErrorCode: 403, ResponsePagePath: "/404.html", ResponseCode: "404" },
            { ErrorCode: 404, ResponsePagePath: "/index.html", ResponseCode: "404" },
        ]);
        const line404 = lines.find((l) => l.includes("404 → /index.html"));
        expect(line404, "404 の行が出ていない").toBeTruthy();
        expect(line404, "振り替え先を見ていない").toContain("!!");
    });

    // **配線は「出た行」で見る**（`cdnLines` から抜けても気づく）
    it("CDN の節に入っている", () => {
        const out = cdnLines([{ PathPattern: "/x/*", CachePolicyId: "p1", Compress: true }], OPTIMIZED, ok);
        expect(out.some((l) => l.includes("404 → /404.html")), "404 の行が節に入っていない").toBe(true);
    });
});
