import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { STORY_VISIBILITIES } from "../../lib/stories";

// **公開範囲の値が2か所にある。**
// クライアントから `api-user` は import できない（別パッケージ・別ビルド）ので
// 複製するしかない。**複製した規則は静かにずれる**——ずれたときの出方が
// 分かりにくい: `storyVisibility` は知らない値を**狭い側**（フォロワーのみ）に
// 倒すので、「全員に公開」を選んだ投稿が**誰のトレイにも出ない**のに、
// 投稿した本人には自分のバーに出る（本人は素通しなので）。
// `storyReactionsParity` と同じ手で、値そのものを突き合わせる。
const root = join(__dirname, "..", "..");
const server = readFileSync(join(root, "api-user/src/storyVisibility.ts"), "utf8");

const constant = (name: string) => {
    const m = server.match(new RegExp(`export const ${name} = "([^"]+)";`));
    expect(m, `サーバー側の ${name} を読み取れない（形が変わった？）`).toBeTruthy();
    return m![1];
};

describe("ストーリーの公開範囲: サーバーと画面で同じ値", () => {
    it("STORY_PUBLIC / STORY_FOLLOWERS_ONLY と一致する", () => {
        expect([constant("STORY_PUBLIC"), constant("STORY_FOLLOWERS_ONLY")],
            "画面とサーバーで公開範囲の値がずれている").toEqual([...STORY_VISIBILITIES]);
    });

    it("サーバーが知らない値を「全員に公開」へ倒していない", () => {
        // ここが逆を向くと、将来「親しい友達」を足したとき、その値を
        // 知らない版のサーバーに当たった投稿が全員に出る。
        // 判定そのものは `api-user` のテストが見るので、こちらは
        // **既定の向きが書き換わっていないこと**だけ押さえる
        expect(server, "知らない値がフォロワー限定へ倒れていない")
            .toMatch(/return STORY_FOLLOWERS_ONLY;\s*\}/);
    });
});
