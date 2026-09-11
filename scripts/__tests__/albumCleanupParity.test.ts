import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **`api/src/albumCleanup.ts` は `api-user/src/albumCleanup.ts` の写し。**
// 管理APIは別サービス（別の Lambda・別の esbuild）なので import できない。
// **複製した規則は静かにずれる**ので、コードが一致することで縛る
// （`cdnInvalidateParity.test.ts` と同じ手）。
//
// 切り出した経緯: 写真を消す経路は3つ（本人・退会・管理者）あるのに、
// アルバムから取り除いていたのは**本人の削除だけ**だった。
// 残り2つを塞ぐには管理API側からも呼ぶ必要があり、そのために
// 「写しを持てる小さなファイル」へ移した。
const root = join(__dirname, "..", "..");
const FILES = ["api-user/src/albumCleanup.ts", "api/src/albumCleanup.ts"];

/**
 * コメントと空白を落としたコード。
 *
 * コメントを残すと「片方に注釈を1行足しただけ」で落ちる。守りたいのは
 * **振る舞いが同じこと**（`cdnInvalidateParity` と同じ判断）。
 */
const codeOf = (rel: string) =>
    readFileSync(join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
        .replace(/\s+/g, " ")
        .trim();

describe("アルバムの掃除の複製2本は同じ中身", () => {
    it("2本のコードが一致する（片方だけ直さない）", () => {
        const [a, b] = FILES.map((f) => codeOf(f));
        expect(b, `${FILES[1]} が ${FILES[0]} と違う（片方だけ直した？）`).toBe(a);
    });

    // **空になっていないことを確かめる。** コメントの落とし方を間違えると
    // 全部消えて「空 === 空」で通る（この台帳で実際に踏んだ型）
    it.each(FILES)("%s のコードが空になっていない", (rel) => {
        const code = codeOf(rel);
        expect(code.length, "コメントを落としすぎて空になっている").toBeGreaterThan(300);
        expect(code).toContain("removePhotoFromAlbum");
        // **守っている中身を名指しで見る。** 「書き直す前の一覧を条件に
        // 入れる」を落とすと、掃除の最中に足された写真を取りこぼす
        expect(code, "条件付き書き込みが落ちている")
            .toContain("attribute_exists(id) AND photoIds = :prev");
        expect(code, "キーの綴りが落ちている").toContain("album#");
    });

    // **キーの綴りが `invite.ts` とずれていないこと。**
    // 写し側は `albumKey` を import できないので、綴りを直接書いている
    // ——`invite.ts` の方を変えたら、こちらも変える必要がある
    it("キーの綴りが invite.ts の albumKey と揃っている", () => {
        const invite = readFileSync(join(root, "api-user/src/invite.ts"), "utf8");
        const m = /export const albumKey = \(albumId: string\) => `([^`]*)\$\{albumId\}`/.exec(invite);
        expect(m, "invite.ts の albumKey が見つからない（書き方が変わった？）").not.toBeNull();
        const prefix = m?.[1] ?? "";
        expect(prefix, "接頭辞が読めていない").toBe("album#");
        for (const rel of FILES) {
            expect(codeOf(rel), `${rel} のキーが invite.ts と違う`).toContain(`\`${prefix}\${albumId}\``);
        }
    });

    // **実装が2本に増えていないこと。** `albums.ts` に書き戻すと、
    // 「呼ぶ側が3経路」の問題を解いた形が崩れる
    it("api-user 側の実装は1本だけ（albums.ts は再輸出）", () => {
        const albums = readFileSync(join(root, "api-user/src/albums.ts"), "utf8");
        expect(albums, "albums.ts に実装が戻っている")
            .not.toMatch(/export async function removePhotoFromAlbum/);
        expect(albums, "再輸出が消えている").toContain('export { removePhotoFromAlbum } from "./albumCleanup"');
    });
});
