import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// **プライバシーポリシーに書いた数と、実装の数が食い違わないか。**
//
// 2026-10-18 に、公開プロフィール・旅のトランク・光と天気の知らせ・プッシュ通知の
// 節を足した。本文には実装の上限（何件まで残す・何台まで・何件まで見る）を
// そのまま書いている。実装の数を変えたのに本文を直さないと、**法的な文が
// 実際の扱いと違うことを言い続ける**ので、数を実装のソースから読んで突き合わせる。
//
// api-user のモジュールは読み込み時に環境変数（`USERS_TABLE` など）を要求するので
// import せず、ソースの定数を文字で読む。

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");
const page = read("app/privacy/page.tsx");

/** `export const NAME = 1_000;` の値を読む（読めなければ落とす） */
function constOf(file: string, name: string): number {
    const m = read(file).match(new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)\\s*;`));
    expect(m, `${file} に ${name} が見つからない`).not.toBeNull();
    return Number(m![1].replace(/_/g, ""));
}

/** 本文の数（3,000 のような桁区切りも読む） */
const inPage = (n: number) => page.includes(n.toLocaleString("en-US")) || page.includes(String(n));

describe("プライバシーポリシーの数が実装と合っている", () => {
    it("旅のトランク: 配った投稿の符号は 3,000 件まで", () => {
        const n = constOf("api-user/src/trunk.ts", "DEALT_LEDGER_MAX");
        expect(n).toBe(3000);
        expect(inPage(n), "本文の件数が実装と違う").toBe(true);
    });

    it("旅のトランク: 取り消しは投稿から24時間以内", () => {
        const src = read("api-user/src/trunk.ts");
        expect(src, "取り消しの窓が 24 時間でなくなった").toMatch(/export const REVOKE_WINDOW_MS = 24 \* 3_600_000;/);
        expect(page).toContain("投稿から24時間以内");
    });

    it("プッシュ通知: 端末は1人10台まで", () => {
        const n = constOf("api-user/src/devices.ts", "DEVICES_MAX");
        expect(page, "本文の台数が実装と違う").toContain(`${n}台分まで`);
    });

    it("光と天気の知らせ: 行きたい場所は新しい方から20件まで", () => {
        const n = constOf("api-user/src/lightForecast.ts", "MAX_SPOTS");
        expect(page, "本文の件数が実装と違う").toContain(`新しい方から${n}件まで`);
    });

    it("最終更新日は書いてある", () => {
        expect(page).toMatch(/const LAST_UPDATED = "\d{4}年\d{1,2}月\d{1,2}日";/);
    });
});

/**
 * 公開プロフィールの節が、**公開の形（`toPublicProfile`）に載る項目**を言っているか。
 * 項目を公開の形に足したのに本文に書かないと、「公開されるのは次の項目です」が嘘になる。
 */
describe("公開プロフィールの節が公開の形と合っている", () => {
    it("券面（passFace）と Pro とサポーターを本文が説明している", () => {
        const src = read("api-user/src/userProfile.ts");
        expect(src, "公開の形に passFace が無くなった。本文の説明も見直すこと").toContain("passFace: isPro(p)");
        expect(page).toContain("特別な乗車券の券面を表示してよいか");
        expect(page).toContain("いま Pro であるかどうかは他の方に分かります");
        expect(page).toContain("サポーターの番号・申し込んだ日・続けた月数");
    });

    it("居住地を公開すると書いてある（公開の形が homeLocation を出す）", () => {
        const src = read("api-user/src/userProfile.ts");
        expect(src).toMatch(/tripTitles, tripCovers, tripSongs, statusText, homeLocation, verified,/);
        expect(page).toContain("居住地");
    });
});
