/**
 * **どちらの Lambda スタックを配るか**を決める（`deploy-api.yml`）。
 *
 * ## なぜ要るのか
 *
 * このワークフローは `api/**` か `api-user/**` のどちらかが変われば起きるが、
 * **中では必ず両方を配っていた**。GitHub は**ジョブごとに分単位で切り上げて
 * 課金する**ので、変わっていない側のデプロイも毎回1〜2分ぶん請求される。
 *
 * 実測（2026-09-24・run 303）:
 *
 *     Run API tests        83秒 → 2分
 *     Resolve environment   5秒 → 1分
 *     Deploy user API     252秒 → 5分
 *     Deploy admin API     73秒 → 2分   ← api/ が変わっていなくても毎回
 *     ────────────────────────────────
 *     壁時計 約5.7分に対して、課金は 10分
 *
 * 9月に入ったコミットを数えると、**216/288 が `api-user/` だけ**の変更だった。
 *
 * ## 🔴 疑わしければ両方配る（fail open）
 *
 * 「API を直して push したのに、どこにも反映されないまま『デプロイ済み』と
 * 思い込む」——`CLAUDE.md` が**実際に踏んだ**事故で、静かに壊れるのが
 * いちばん悪い。だから**分からない回は両方配る**:
 *
 *  - 手動実行（`workflow_dispatch`）……… 選ばれた `target` に従う（今までどおり）
 *  - 直前のコミットが辿れない ……………… 両方（枝の作り直し・force push・浅い履歴）
 *  - 変更ファイルが1つも取れない ………… 両方
 *  - **ワークフロー自身が変わった** ……… 両方（パラメータが変わったかもしれない）
 *  - 共有のファイルが変わった …………… 両方（下の `SHARED`）
 *
 * 節約は「確実に要らないと言える回」だけ。
 */

/**
 * **どちらのスタックにも効きうるファイル。** 変わったら両方配る。
 *
 * `api/` `api-user/` の外にあって、デプロイの中身を左右しうるもの。
 * 迷ったら**ここに入れる**（入れ過ぎても損は1〜2分、抜けると反映されない）。
 */
export const SHARED = [
    ".github/workflows/deploy-api.yml",
    "scripts/lib/deployTargets.mjs",
];

/**
 * @param {object} input
 * @param {string} input.eventName        `push` / `workflow_dispatch` …
 * @param {string} [input.dispatchTarget] 手動実行で選ばれた対象
 * @param {string[]|null} input.changed   変わったファイル（辿れなければ null）
 * @returns {{admin: boolean, user: boolean, reason: string}}
 */
export function pickDeployTargets({ eventName, dispatchTarget, changed }) {
    if (eventName !== "push") {
        const t = dispatchTarget || "both";
        if (t === "admin-api") return { admin: true, user: false, reason: "手動実行（admin-api）" };
        if (t === "user-api") return { admin: false, user: true, reason: "手動実行（user-api）" };
        return { admin: true, user: true, reason: `手動実行（${t}）` };
    }
    if (!Array.isArray(changed) || changed.length === 0) {
        return { admin: true, user: true, reason: "変更ファイルを取れなかったので両方配ります" };
    }
    const shared = changed.find((f) => SHARED.includes(f));
    if (shared) {
        return { admin: true, user: true, reason: `共有ファイル（${shared}）が変わったので両方配ります` };
    }
    const admin = changed.some((f) => f.startsWith("api/"));
    const user = changed.some((f) => f.startsWith("api-user/"));
    if (!admin && !user) {
        // 起動条件を満たしているのにどちらも当たらない＝読み違えている。
        // **黙って何も配らないのがいちばん悪い**ので両方配る
        return { admin: true, user: true, reason: "どちらの領域にも当たらなかったので両方配ります" };
    }
    const only = admin && user ? "両方" : admin ? "api/ だけ" : "api-user/ だけ";
    return { admin, user, reason: `変わったのは ${only}` };
}
