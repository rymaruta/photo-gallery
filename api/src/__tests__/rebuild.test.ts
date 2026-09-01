import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// api/src/rebuild.ts と api-user/src/rebuild.ts は**同じ中身**で運用している。
// 再ビルドの予算（月の上限）は両方が同じ DynamoDB のアイテムを数えるので、
// 片方だけ直すと「管理API から消したぶんは数えない」形で歯止めが抜ける。
//
// 中身の振る舞いのテストは api-user/src/__tests__/rebuild.test.ts が持つ。
// ここは**食い違いを検知するだけ**——2つ目のテストを写すと、今度は
// テストの方が食い違う。
it("api と api-user の rebuild.ts は同じ内容（片方だけ直さない）", () => {
    const root = join(__dirname, "..", "..", "..");
    const a = readFileSync(join(root, "api", "src", "rebuild.ts"), "utf8");
    const b = readFileSync(join(root, "api-user", "src", "rebuild.ts"), "utf8");
    expect(a).toBe(b);
});
