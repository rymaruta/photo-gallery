import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = join(__dirname, "..", "..");
const path = join(root, "scripts", "setup-private-delivery.sh");
const src = readFileSync(path, "utf8");

/**
 * 本番の CloudFront を触る道具。**開発環境からは流せない**
 * （`AWS_ACCESS_KEY_ID` が AWS に通らず、`aws` も入っていない）ので、
 * ここで見られるのは**安全装置が在ること**と**既定が下見であること**。
 *
 * それでも見る価値がある——この script が1つ間違えると
 * **サイト全体の画像が割れる**（`/uploads/*` に署名必須を付けた場合）。
 */
describe("絞った写真の配信を設定する道具", () => {
    it("bash として構文が通る", () => {
        expect(() => execFileSync("bash", ["-n", path])).not.toThrow();
    });

    // 🔴 **これが最後の砦。** `/uploads/*` に署名必須を付けると、
    // 公開写真も 403 になってサイト全体の画像が割れる
    it("経路に `uploads` が入っていたら止まる", () => {
        expect(src).toContain("assert_not_uploads");
        expect(src).toMatch(/\*uploads\*\)/);
        expect(src).toContain("exit 2");
    });

    it("その見張りを、**足す直前にもう一度**呼んでいる", () => {
        const calls = src.split("\n").filter(
            (l) => l.trim() === "assert_not_uploads" || l.trim().startsWith("assert_not_uploads "));
        expect(calls.length, "1回しか呼んでいない（途中で書き換わっても気づけない）")
            .toBeGreaterThanOrEqual(2);
    });

    // **既定は下見。** 何も渡さずに流して本番が変わるのは駄目
    it("既定では何も変えない（`--apply` が要る）", () => {
        expect(src).toContain("APPLY=0");
        expect(src).toMatch(/--apply.*APPLY=1|APPLY=1.*--apply/);
        // **下見は道具が無くても流せること。** 流せないと、安全装置が
        // 効くかを誰も確かめられない（`aws` が無い環境で止まっていた）
        const out = execFileSync("bash", [path], { encoding: "utf8" });
        expect(out).toContain("下見");
    });

    it("対象の経路は `private/*` だけ", () => {
        expect(src).toContain('PATTERN="private/*"');
    });

    // **秘密鍵を commit しない**（`.gitignore` に在ること）
    it("秘密鍵は commit されない", () => {
        expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("*.pem");
    });

    // **もう在るなら触らない**（二度流しても壊れない）
    it("冪等（既にあれば作り直さない）", () => {
        expect(src).toContain("既にあります");
    });
});
    // 🔴 **安全装置を、実際に動かして確かめる。** 「在ること」だけ見ると、
    // 書いてあるのに効かない状態を通す（今日3回やった形）
    it("経路を `uploads/*` に変えると、本当に止まる", () => {
        const dir = mkdtempSync(join(tmpdir(), "setup-"));
        const bad = join(dir, "bad.sh");
        writeFileSync(bad, src.replace('PATTERN="private/*"', 'PATTERN="uploads/*"'));
        let code = 0;
        let out = "";
        try {
            out = execFileSync("bash", [bad], { encoding: "utf8" });
        } catch (e) {
            const err = e as { status: number; stdout: string };
            code = err.status;
            out = err.stdout;
        }
        expect(code, "止まっていない").toBe(2);
        expect(out).toContain("サイト全体の画像が割れます");
    });

