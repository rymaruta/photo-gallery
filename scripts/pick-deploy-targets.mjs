#!/usr/bin/env node
/**
 * `deploy-api.yml` から呼ばれる薄い殻。
 *
 * **判断は持たない**——それは `lib/deployTargets.mjs`（純粋な関数・テストあり）。
 * ここがするのは、変更ファイルの一覧を読んで、答えを `GITHUB_OUTPUT` と
 * 実行のまとめに書くことだけ。
 *
 *     node scripts/pick-deploy-targets.mjs <変更ファイルを1行ずつ書いたファイル>
 *
 * **落ちない。** 何かおかしければ両方配る側に倒して 0 で終わる——
 * ここで実行ごと落とすと、デプロイそのものが止まる。
 */
import { appendFileSync, readFileSync } from "node:fs";
import { pickDeployTargets } from "./lib/deployTargets.mjs";

function report({ admin, user, reason }) {
    const line = `配る先: admin-api=${admin} / user-api=${user}（${reason}）`;
    console.log(line);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `admin=${admin}\nuser=${user}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n`);
    }
}

try {
    const path = process.argv[2];
    const raw = path ? readFileSync(path, "utf8").trim() : "";
    report(pickDeployTargets({
        eventName: process.env.EVENT_NAME ?? "",
        dispatchTarget: process.env.DISPATCH_TARGET,
        changed: raw ? raw.split("\n").filter(Boolean) : null,
    }));
} catch (e) {
    console.error("配る先を決められませんでした。両方配ります:", e);
    report({ admin: true, user: true, reason: "判断に失敗したので両方配ります" });
}
