import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * `add-story-index.js` の埋め戻しが、**アーカイブを一覧へ戻さない**こと。
 *
 * 掃除（`cleanupExpiredStories`）はアーカイブへ移すときに**わざと**
 * `storyFeed` を外す。埋め戻しは「`storyFeed` の無いストーリー」を全部
 * 対象にするので、そのままだとアーカイブが丸ごと GSI に戻り、次の掃除が
 * それを「期限切れ」として拾う（件数ぶん返信の削除と条件付き更新を撃ち、
 * 溜まるほど毎回先頭に来て後ろの本物に届かない）。
 *
 * 保守タスクは「既にあれば何もしない」と案内している冪等なものなので、
 * 走らせ直しても壊れてはいけない。`highlightParity` と同じ手で、
 * スクリプトの絞り込みそのものを突き合わせる。
 */
const root = join(__dirname, "..", "..");
const script = readFileSync(join(root, "scripts/add-story-index.js"), "utf8");

describe("add-story-index: アーカイブを一覧へ戻さない", () => {
    it("埋め戻しの絞り込みが archivedAt の在る行を除いている", () => {
        const m = script.match(/FilterExpression:\s*"([^"]*attribute_not_exists\(storyFeed\)[^"]*)"/);
        expect(m, "埋め戻しの絞り込みを読み取れない（形が変わった？）").toBeTruthy();
        expect(m![1], "アーカイブ（storyFeed を外した行）まで一覧へ戻す")
            .toContain("attribute_not_exists(archivedAt)");
    });
});
