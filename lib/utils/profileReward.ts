import { userFetch } from "./api";
import { log } from "./log";

/**
 * アイコン・カバーを初めて設定したお礼（`POST /user/trunk/reward`・#304・2026-10-18）。
 * サーバーが実体を確かめてから、それぞれ一度だけ硬貨3枚を足す。
 *
 * **置いた直後は「まだ無い」と答えることがある。** サーバーは公開の CDN に HEAD で確かめるが、CDN は無いキーの
 * 404 を約10秒覚える（問いを鍵に入れない配り方・`scripts/verify-origin-failover.js`）。だから足せず（`added == 0`）
 * 印も無い（`rewarded == false`）ときは、約12秒おいて**1回だけ**頼み直す（2026-10-18 見直し）。
 * それでも渡せなかった回は印が立たないので、次に設定し直したとき・アプリを開いたとき（iOS は起動のたびに
 * `rewarded` が true になるまで確かめ直す）に渡せる。
 *
 * **黙って失敗する**（お礼はおまけ。アイコン・カバーの保存は済んでいる）
 */
export type ProfileRewardResult = { granted: boolean; added: number; coins: number; rewarded: boolean };

/** 頼み直すまでの間（CDN が 404 を覚える約10秒より少し長く） */
export const REWARD_RETRY_MS = 12_000;

export async function claimProfileReward(
    kind: "avatar" | "cover",
    wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ProfileRewardResult | null> {
    const first = await requestReward(kind);
    if (!first || first.added > 0 || first.rewarded) return first;
    await wait(REWARD_RETRY_MS);
    return (await requestReward(kind)) ?? first;
}

async function requestReward(kind: "avatar" | "cover"): Promise<ProfileRewardResult | null> {
    try {
        const res = await userFetch("/user/trunk/reward", { method: "POST", body: JSON.stringify({ kind }) });
        if (!res.ok) return null;
        const v = await res.json() as Partial<ProfileRewardResult> | null;
        if (!v || typeof v.added !== "number" || typeof v.coins !== "number") return null;
        return { granted: v.granted === true, added: v.added, coins: v.coins, rewarded: v.rewarded === true };
    } catch (e) {
        log.warn("profile reward failed:", e);
        return null;
    }
}

/** 知らせの文（足せた枚数が 0 なら出さない＝呼び出し側が null を見る） */
export function rewardToast(r: ProfileRewardResult | null, kind: "avatar" | "cover", locale: string): string | null {
    if (!r || r.added <= 0) return null;
    const en = locale === "en";
    const what = kind === "avatar" ? (en ? "setting your avatar" : "アイコンを設定した") : (en ? "setting your cover" : "カバーを設定した");
    return en
        ? `Thanks for ${what} — ${r.added} trunk coin${r.added === 1 ? "" : "s"} added`
        : `${what}お礼に、トランクの硬貨を ${r.added} 枚`;
}
