"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { userFetch, readApiError } from "../utils/api";
import { log } from "../utils/log";

/**
 * 旅行プラン（`GET/POST/PUT/DELETE /user/trips`）。
 *
 * ## 「まだ」「聞けなかった」「0件」を混ぜない
 *
 * 混ぜると、通信に失敗しただけの人に「まだプランはありません」と言い切る
 * ことになる（この台帳が何度も踏んでいる形）。`useSavedSpots` と同じ立場。
 *
 * ## ただし `useMyPhotoIdList` の包みにはしない
 *
 * あちらは**文字列のID一覧**を引く共通部で、プランは**オブジェクト**。
 * 中身の形が違うものを同じ共通部に押し込むと、`slugs`/`photoIds` の
 * ような「欄の名前だけ違う」包みでは済まなくなる。**サーバー側では
 * 同じ行の形を使い回している**（`userList.ts`）が、画面側は別。
 *
 * ## 書き込みの応答をそのまま映す
 *
 * サーバーは書いたあとの一覧を返す。自分で足し引きすると、失敗した回や
 * 上限で断られた回に嘘の状態が残る（`useSavedSpots` と同じ判断）。
 *
 * ## 端末に控えを持たない
 *
 * 旅行プランは**本人だけが見られる**もので、端末に残すと「同じ端末を使う
 * 別の人」に見える。`useSavedSpots` が同じ理由で控えを持っていない。
 */

export type TripItem =
    | { kind: "spot"; spotId: string; note?: string }
    | { kind: "location"; slug: string; note?: string };

export type TripDay = { date?: string; items: TripItem[] };

export type TripPlan = {
    planId: string;
    title: string;
    startDate?: string;
    endDate?: string;
    days: TripDay[];
    createdAt?: string;
    updatedAt?: string;
};

/** 応答の1件を、画面が描ける形に均す。読めなければ `null` */
export function usableTripPlan(x: unknown): TripPlan | null {
    if (typeof x !== "object" || x === null) return null;
    const p = x as Record<string, unknown>;
    if (typeof p.planId !== "string" || !p.planId) return null;
    const days = Array.isArray(p.days)
        ? p.days.map((d) => {
            const rd = (typeof d === "object" && d !== null ? d : {}) as Record<string, unknown>;
            const items = Array.isArray(rd.items)
                ? rd.items.filter((it): it is TripItem => {
                    if (typeof it !== "object" || it === null) return false;
                    const r = it as Record<string, unknown>;
                    return (r.kind === "spot" && typeof r.spotId === "string")
                        || (r.kind === "location" && typeof r.slug === "string");
                })
                : [];
            return typeof rd.date === "string" ? { date: rd.date, items } : { items };
        })
        : [];
    return {
        planId: p.planId,
        title: typeof p.title === "string" ? p.title : "",
        ...(typeof p.startDate === "string" ? { startDate: p.startDate } : {}),
        ...(typeof p.endDate === "string" ? { endDate: p.endDate } : {}),
        days,
        ...(typeof p.createdAt === "string" ? { createdAt: p.createdAt } : {}),
        ...(typeof p.updatedAt === "string" ? { updatedAt: p.updatedAt } : {}),
    };
}

/** 応答の本文から一覧を取り出す。**形が違えば `null`**（0件と混ぜない） */
export function readPlans(data: unknown): TripPlan[] | null {
    if (typeof data !== "object" || data === null) return null;
    const raw = (data as { plans?: unknown }).plans;
    if (!Array.isArray(raw)) return null;
    return raw.map(usableTripPlan).filter((p): p is TripPlan => p !== null);
}

export type TripPlans = {
    plans: readonly TripPlan[];
    /** まだ分からない（ログイン確認中・取得中） */
    pending: boolean;
    /** 聞きに行って失敗した。**0件と混ぜない** */
    failed: boolean;
    /** もう一度聞く */
    retry: () => void;
    /** いま書き込み中のプラン（新規は `"new"`）。連打を止める */
    busy: string | null;
    /** 作る。返るのは作れたプラン（作れなければ `null`） */
    create: (title: string) => Promise<TripPlan | null>;
    /** 直す。送った項目だけが差し替わる */
    update: (planId: string, patch: Partial<Pick<TripPlan, "title" | "startDate" | "endDate" | "days">>) => Promise<boolean>;
    /** 消す */
    remove: (planId: string) => Promise<boolean>;
    /** 直近の失敗の言い分（サーバーの文言）。成功すると消える */
    error: string | null;
};

const EMPTY: readonly TripPlan[] = [];

export function useTripPlans(isAuthenticated: boolean, authLoading: boolean): TripPlans {
    const [fetched, setFetched] = useState<{ token: string; plans: TripPlan[]; failed: boolean } | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    /**
     * 🔴 **連打の鍵は `ref` で持つ。**
     *
     * `busy`（state）で見ると、`write` の閉包が持つのは**その描画時の値**
     * なので、同じフレームの2回押しはどちらも `busy === null` を見て
     * **2本とも飛ぶ**（`setBusy` が反映されるのは次の描画）。
     * `ref` なら同期的に立つ。state の方は**画面に出すため**に残す。
     *
     * `useSavedSpots` が同じことを書いている——**写すときは理由ごと写す**。
     * （テストが実際に捕まえた: 3回呼ばれて2回のはずが合わなかった）
     */
    const writing = useRef<string | null>(null);

    // **投げた条件を添えて持つ**（古い応答は描画のときに捨てる）。
    // `useMyPhotoIdList` と同じ判断——エフェクトの中で同期的に state を
    // 戻すと、条件が変わるたびに余分な描画が1回増える
    const token = `${authLoading ? "?" : isAuthenticated ? "in" : "out"}|${reloadKey}`;

    const retry = useCallback(() => { setReloadKey((k) => k + 1); }, []);

    useEffect(() => {
        if (authLoading || !isAuthenticated) return;
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userFetch("/user/trips", { signal: controller.signal });
                if (aborted) return;
                if (!res.ok) { setFetched({ token, plans: [], failed: true }); return; }
                const list = readPlans(await res.json());
                if (aborted) return;
                setFetched(list === null
                    ? { token, plans: [], failed: true }
                    : { token, plans: list, failed: false });
            } catch (e) {
                if (aborted) return;
                log.warn("旅行プランを取得できませんでした:", e);
                setFetched({ token, plans: [], failed: true });
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [isAuthenticated, authLoading, token]);

    const current = fetched && fetched.token === token ? fetched : null;
    const signedOut = !authLoading && !isAuthenticated;

    /**
     * 書き込みの共通部。**応答の一覧をそのまま映す**。
     * 失敗したらサーバーの言い分を `error` に置く（403 の上限・503 の混雑を
     * 「保存に失敗しました」に潰さない）。
     */
    const write = useCallback(async (
        key: string,
        path: string,
        init: RequestInit,
        fallback: string,
    ): Promise<TripPlan[] | null> => {
        if (writing.current) return null;
        writing.current = key;
        setBusy(key);
        setError(null);
        try {
            const res = await userFetch(path, init);
            if (!res.ok) {
                setError(await readApiError(res, fallback));
                return null;
            }
            const list = readPlans(await res.json());
            if (list === null) { setError(fallback); return null; }
            setFetched({ token, plans: list, failed: false });
            return list;
        } catch (e) {
            log.warn("旅行プランを更新できませんでした:", e);
            setError(e instanceof Error ? e.message : fallback);
            return null;
        } finally {
            writing.current = null;
            setBusy(null);
        }
    }, [token]);

    const create = useCallback(async (title: string): Promise<TripPlan | null> => {
        const before = new Set(current?.plans.map((p) => p.planId) ?? []);
        const list = await write("new", "/user/trips", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
        }, "作成に失敗しました");
        // **新しく増えた1件を返す**（応答の先頭とは限らない、とは考えない
        // ——サーバーは新しい順に積むが、増えた ID で見る方が壊れにくい）
        return list?.find((p) => !before.has(p.planId)) ?? null;
    }, [write, current]);

    const update = useCallback(async (
        planId: string,
        patch: Partial<Pick<TripPlan, "title" | "startDate" | "endDate" | "days">>,
    ) => {
        const list = await write(planId, `/user/trips/${encodeURIComponent(planId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
        }, "保存に失敗しました");
        return list !== null;
    }, [write]);

    const remove = useCallback(async (planId: string) => {
        const list = await write(planId, `/user/trips/${encodeURIComponent(planId)}`, { method: "DELETE" }, "削除に失敗しました");
        return list !== null;
    }, [write]);

    return {
        plans: current?.plans ?? EMPTY,
        pending: !signedOut && current === null,
        failed: current?.failed ?? false,
        retry,
        busy,
        create,
        update,
        remove,
        error,
    };
}
