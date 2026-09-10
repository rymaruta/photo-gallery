import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **公開してはいけない項目のふるいが3か所にある。**
//
//   api/src/photos.ts               … `GET /photos` / `GET /photos/{id}` の応答
//   scripts/sync-photos-from-ddb.js … ビルド時に `app/data/photos.json` を作る
//   lib/server/photos.ts            … その JSON を読み出す側（二重の守り）
//
// **4つ目もある**（ここでは突き合わせない）: `scripts/deploy-static-site.js` の
// `FORBIDDEN_IN_OUTPUT`。あれは「出来上がった `out/` に禁止語が混ざっていたら
// デプロイを止める」最後の関門で、意図的に網が狭い（誤検知で全デプロイが
// 止まるため）。同じ一覧に揃えるものではない。
//
// **突き合わせるものが無かった。** 実際、`keptFrom` を足したとき
// `lib/server/photos.ts` だけ落ちていて、誰も落ちなかった。書き手（sync）が
// 落としているので当座は漏れないが、**二重の守りは片方が欠けても静か**
// ——このリポジトリが「複製した規則は静かにずれる」と呼んでいる形。
//
// 綴りではなく**実際の配列**で見る（コメントに項目名を書いただけで
// 満たされる `toContain` の羅列にしない）。
const ROOT = join(__dirname, "..", "..");

/** `PRIVATE_FIELDS = [...]` の中の文字列リテラルを取り出す */
function fieldsOf(relPath: string): string[] {
    const src = readFileSync(join(ROOT, relPath), "utf8");
    const m = /PRIVATE_FIELDS\s*(?::[^=]+)?=\s*\[([^\]]*)\]/.exec(src);
    if (!m) return [];
    return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

const API = "api/src/photos.ts";
const SYNC = "scripts/sync-photos-from-ddb.js";
const READER = "lib/server/photos.ts";

// sync だけが余分に落としてよいもの（理由つき）。
//   commentCount … 定期ビルドが週1なので、静的HTMLに焼くと古い数字が残る
//                  （NUM-3。API はその場で数えるので落とさない）
const SYNC_ONLY = ["commentCount"];

describe("公開データのふるいは3か所で揃っている", () => {
    // 正規表現が壊れて「空 vs 空」で緑になるのを防ぐ
    it.each([API, SYNC, READER])("%s から一覧を読み取れる", (path) => {
        expect(fieldsOf(path).length).toBeGreaterThan(3);
    });

    it("読み出し側（lib/server）は API と同じものを落とす", () => {
        expect([...fieldsOf(READER)].sort()).toEqual([...fieldsOf(API)].sort());
    });

    it("ビルド時（sync）は API のぶんを全部落とす", () => {
        for (const f of fieldsOf(API)) {
            expect(fieldsOf(SYNC), `${f} が静的JSONに残る`).toContain(f);
        }
    });

    // 増やすときに理由を書かせる。書かずに増やすと、
    // 「API には出るのに静的HTMLには無い」というずれが静かに入る
    it("sync だけが余分に落とすものは、理由を書いた一覧と一致する", () => {
        const extra = fieldsOf(SYNC).filter((f) => !fieldsOf(API).includes(f));
        expect(extra.sort()).toEqual([...SYNC_ONLY].sort());
    });

    // **名指しでも固定する。** 上の3本は「3つが揃っているか」しか見ないので、
    // **そろって1項目を落とす**変更は素通りする（`publicFeed` を3ファイルとも
    // 消す変異で7件とも緑だったのを実測）。出してはいけないと分かっている
    // ものは、理由つきで1つずつ名前で縛る。
    const MUST_DROP: [string, string][] = [
        ["srcOriginal", "EXIF を落とす前の原本（GPS 入り）の URL"],
        ["key", "S3 のオブジェクトキー"],
        ["staticStale", "静的ページの掃除が届いていないという内部の印"],
        ["publicFeed", "公開一覧の GSI に載せるための内部の印"],
        ["keptFrom", "ストーリーから残した写真に付く、元のストーリーのID"],
    ];
    it.each(MUST_DROP)("%s はどこでも落とす（%s）", (field) => {
        for (const p of [API, SYNC, READER]) {
            expect(fieldsOf(p), `${p} が ${field} を出している`).toContain(field);
        }
    });
});
