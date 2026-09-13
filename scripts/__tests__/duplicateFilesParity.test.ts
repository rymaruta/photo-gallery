import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **`api/src` と `api-user/src` に同じ名前のファイルがあるとき、
 * それが「写し」なのか「別物」なのかを、機械に言わせる。**
 *
 * 管理API（`api`）とユーザーAPI（`api-user`）は別サービス（別の Lambda・
 * 別の esbuild）なので、片方から片方を import できない。そのため同じ規則を
 * 2か所に書いている場所がいくつもある——**そして複製は静かにずれる**
 * （台帳の型2。`truncate` `mediaHosts` `publicFeed` `cdnInvalidate`
 *  `albumCleanup` `PRIVATE_FIELDS` は、実際にずれて個別の突き合わせを足した）。
 *
 * ところが**写しそのものが増えたときに気づく仕組みが無かった**。
 * 実際、`env.ts` と `rebuild.ts` は**バイト単位で同一の複製なのに、
 * 一致を見張るものが1つも無かった**（この差分で発見）:
 *
 *   `env.ts`     … `requireEnv`。CLAUDE.md が「本番値のフォールバックは
 *                   置かない。未設定なら止める」と名指ししている当のもの。
 *                   片方だけに既定値が入ると、**その環境だけ設定ミスが
 *                   『動かない』ではなく『本番を触る』に倒れる**
 *   `rebuild.ts` … 再ビルドの依頼（トークン・月次予算・coalesce）。
 *                   片方だけ変わると、**その口からの投稿・削除が
 *                   最大7日 世に出ない**（`7399c41f` で踏んだ形）
 *
 * だからここでは**一覧を手で持たない**。両方に在るファイルを列挙して、
 * 「同一」か「別物として宣言済み」のどちらかであることを要求する。
 * 新しい写しを足した人は、**必ずどちらかを選ばされる**。
 */
const ROOT = join(__dirname, "..", "..");
const A = join(ROOT, "api", "src");
const B = join(ROOT, "api-user", "src");

/**
 * **同じ名前だが中身が違うと分かっているもの。** 理由を必ず書く。
 * ここに足すのは「同じ名前で別の実装」を意図して置くときだけ。
 */
const KNOWN_DIVERGENT: Record<string, string> = {
    "cdnInvalidate.ts": "コメントだけが違う写し。コードの一致は cdnInvalidateParity.test.ts が見る",
    "ddb-photos.ts": "別物。管理APIは全件 Scan、ユーザーAPIは自分の写真だけ（GSI）",
    "dynamodb.ts": "別物。索引名の置き場所が違う（api は ddb-photos 側に持つ）",
    "sanitize.ts": "写しだが冒頭のコメントが違う。項目の一致は個別のテストが見る",
    "types.ts": "別物。api-user だけが退会の墓石（isDeletedProfile）を持つ",
    "upload.ts": "別物。api-user は削除・サムネ・アルバムまで面倒を見る",
};

const bothSides = (): string[] => {
    const a = new Set(readdirSync(A).filter((f) => f.endsWith(".ts")));
    return readdirSync(B).filter((f) => f.endsWith(".ts") && a.has(f)).sort();
};

const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

describe("api と api-user に同じ名前で置いてあるファイル", () => {
    it("列挙できている（走査が空回りしていない）", () => {
        expect(bothSides().length, "1つも見つかっていない（パスが違う）").toBeGreaterThan(5);
    });

    // **これが本体。** 同一でないなら、理由つきで宣言してあること
    it("同一か、別物として理由つきで宣言してある", () => {
        const undeclared: string[] = [];
        for (const f of bothSides()) {
            if (read(A, f) === read(B, f)) continue;
            if (!KNOWN_DIVERGENT[f]) undeclared.push(f);
        }
        expect(undeclared,
            "中身が違うのに宣言が無い（写しがずれたのか、別物を置いたのかが読めない）").toEqual([]);
    });

    // **宣言が古くならないようにする。** 同一になったのに「別物」と
    // 書いたままだと、次に読む人が「ずれていて当たり前」と誤解する
    it("同一になったものが、別物の一覧に残っていない", () => {
        const stale = Object.keys(KNOWN_DIVERGENT).filter((f) => {
            try { return read(A, f) === read(B, f); } catch { return false; }
        });
        expect(stale, "同一になったのに『別物』と宣言したまま").toEqual([]);
    });

    it("消えたファイルが、別物の一覧に残っていない", () => {
        const both = new Set(bothSides());
        expect(Object.keys(KNOWN_DIVERGENT).filter((f) => !both.has(f)),
            "もう両方に無いのに宣言が残っている").toEqual([]);
    });

    // **バイト単位で同一の写しは、これから先も同一であること。**
    // `env.ts` と `rebuild.ts` はここで初めて縛られる
    it("同一の写しは、片方だけ変えたら落ちる", () => {
        const identical = bothSides().filter((f) => read(A, f) === read(B, f));
        expect(identical.length, "同一の写しが1つも無い（この確認が空回りしている）").toBeGreaterThan(2);
        // 名指しで2つ（この差分で見つけた、見張りの無かったもの）
        expect(identical, "env.ts の写しが同一でなくなった").toContain("env.ts");
        expect(identical, "rebuild.ts の写しが同一でなくなった").toContain("rebuild.ts");
        for (const f of identical) expect(read(A, f), `${f} がずれた`).toBe(read(B, f));
    });
});
