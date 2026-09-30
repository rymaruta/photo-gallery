import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **ログイン画面が「そのメールアドレスは登録されている」を教えていた（A-5）。**
//
// Cognito は既定（`PreventUserExistenceErrors: LEGACY`）だと、存在しない
// メールアドレスに `UserNotFoundException` を返す。それを「ユーザーが
// 見つかりません」と表示すると、**ログイン画面がアカウントの有無を確かめる
// 道具**になる（総当たりでメールアドレスの一覧が作れる）。パスワード再設定も
// 同じ（「メールアドレスが見つかりません」）。
//
// 本来はプール側の設定で塞ぐが、**本番プールの現状はこの環境から確認できない**
// （AWS の資格情報はプレースホルダで、`sts:GetCallerIdentity` が
// `InvalidClientTokenId` を返す）。設定がどうであれ画面が教えないようにし、
// あわせて `provision-env.js` が作る新しいクライアントでは
// `PreventUserExistenceErrors: ENABLED` を指定する。
//
// 実物の SDK を動かせないので、ここは**分岐の形**を固定する。

const code = (rel: string) =>
    readFileSync(join(process.cwd(), rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

describe("アカウントの有無を教えない", () => {
    it("ログイン: 未登録と パスワード違いを同じ文面にする", () => {
        const src = code("lib/auth/cognito.ts");
        expect(src, "未登録だけ別の文面になっている（存在を教えている）")
            .not.toMatch(/UserNotFoundException"\s*\)\s*\{\s*\n?\s*errorMessage = "ユーザーが見つかりません/);
        // 同じ分岐にまとめてあること
        expect(src).toMatch(/NotAuthorizedException"\s*\|\|\s*err\.code === "UserNotFoundException"/);
    });

    it("新しいプールのクライアントは PreventUserExistenceErrors を有効にする", () => {
        const src = code("scripts/provision-env.js");
        expect(src, "入口（Cognito 側）で塞いでいない")
            .toContain('PreventUserExistenceErrors: "ENABLED"');
    });
});
