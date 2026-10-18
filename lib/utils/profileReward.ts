import { userFetch } from "./api";
import { log } from "./log";

/**
 * アイコン・カバーを初めて設定したお礼（`POST /user/trunk/reward`・#304・2026-10-18）。
 * サーバーが実体を確かめてから、それぞれ一度だけ硬貨3枚を足す。
 *
 * **黙って失敗する**（お礼はおまけ。アイコン・カバーの保存は済んでいる）。印が立たないので、
 * 次に設定したとき・アプリを開いたときにもう一度確かめられる
 */
export type ProfileRewardResult = { granted: boolean; added: number; coins: number };

export async function claimProfileReward(kind: "avatar" | "cover"): Promise<ProfileRewardResult | null> {
    try {
        const res = await userFetch("/user/trunk/reward", { method: "POST", body: JSON.stringify({ kind }) });
        if (!res.ok) return null;
        const v = await res.json() as Partial<ProfileRewardResult> | null;
        if (!v || typeof v.added !== "number" || typeof v.coins !== "number") return null;
        return { granted: v.granted === true, added: v.added, coins: v.coins };
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
