import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEVICE_TOKEN_RE } from "../../lib/push/deviceToken";

/**
 * **宛先の形が、画面とサーバーで2か所にある。**
 *
 * クライアントから `api-user` は import できないので複製する。ずれると
 * **画面は送ったつもりでサーバーが 400 を返す**（`STORY_REACTIONS` /
 * `highlightParity` と同じ手で、正規表現そのものを突き合わせる）。
 *
 * 画面側で形を見るのは「送る前に弾く」ためで、**守りはサーバー側**。
 * だから緩い方向にずれると 400 が増え、厳しい方向にずれると
 * **登録できない端末が出る**（どちらも静かに壊れる）。
 */
const ROOT = join(__dirname, "..", "..");
const server = readFileSync(join(ROOT, "api-user/src/devices.ts"), "utf8");

describe("端末トークン: サーバーと画面で同じ形", () => {
    it("正規表現が一致する", () => {
        const m = server.match(/\/\^\[0-9a-f\]\{(\d+),(\d+)\}\$\/i/);
        expect(m, "サーバー側の `isDeviceToken` の形を読み取れない（変わった？）").toBeTruthy();
        expect(DEVICE_TOKEN_RE.source).toBe(`^[0-9a-f]{${m![1]},${m![2]}}$`);
        expect(DEVICE_TOKEN_RE.flags).toBe("i");
    });

    // 両側とも小文字に畳む（DynamoDB の Set では大文字小文字が別メンバー）
    it("両側で小文字に畳んでいる", () => {
        expect(server, "サーバー側の畳み込みが無くなった").toMatch(/toLowerCase\(\)/);
        const client = readFileSync(join(ROOT, "lib/push/deviceToken.ts"), "utf8");
        expect(client).toMatch(/toLowerCase\(\)/);
    });

    // 口の綴り。変えたら画面が 404 を受ける（`userFetch` はそれを投げない）
    it("叩く先が `/user/devices` で一致する", () => {
        const yml = readFileSync(join(ROOT, "api-user/serverless.yml"), "utf8");
        const client = readFileSync(join(ROOT, "lib/push/deviceToken.ts"), "utf8");
        for (const method of ["POST", "DELETE"]) {
            expect(yml, `${method} /user/devices が serverless.yml に無い`)
                .toMatch(new RegExp(`path: /user/devices\\n\\s+method: ${method}`));
        }
        expect((client.match(/"\/user\/devices"/g) ?? []).length,
            "画面側が叩く先が2か所（登録・解除）でない").toBe(2);
    });
});
