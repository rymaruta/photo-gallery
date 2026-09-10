import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { STORY_REACTIONS } from "../../lib/stories";

// **クイックリアクションの一覧が2か所にある。**
// クライアントから `api-user` は import できない（別パッケージ・別ビルド）ので
// 複製するしかない。**複製した規則は静かにずれる**——ずれると、画面に出ている
// 絵文字を押しても、サーバーは「一覧に無い」と見て**本文として**保存する
// （見た目は絵文字のまま出るので、投稿者にも押した人にも分からない）。
// `mediaHosts` / `cdnInvalidate` と同じ手で、値そのものを突き合わせる。
const root = join(__dirname, "..", "..");
const server = readFileSync(join(root, "api-user/src/storyReplies.ts"), "utf8");

describe("ストーリーのリアクション: サーバーと画面で同じ一覧", () => {
    it("サーバーの REACTIONS と一致する", () => {
        const m = server.match(/export const REACTIONS = \[([^\]]*)\] as const;/);
        expect(m, "サーバー側の一覧を読み取れない（形が変わった？）").toBeTruthy();
        const serverList = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        expect(serverList.length, "サーバー側が空").toBeGreaterThan(0);
        expect(serverList, "画面とサーバーで一覧がずれている").toEqual([...STORY_REACTIONS]);
    });
});
