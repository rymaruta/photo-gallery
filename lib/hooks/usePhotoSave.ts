import { useCallback, useEffect, useRef, useState } from "react";
import { userFetch, isGoneResponse, sessionErrorMessage, readApiError } from "../utils/api";
import { log } from "../utils/log";

/**
 * 写真の「保存」（ブックマーク）。あとで見返すための、自分だけの棚。
 *
 * ## いいね（`usePhotoLikes`）と違うところ
 *
 * - **公開の数が無い**ので、数字の楽観更新も巻き戻しも無い
 * - **端末の控え（localStorage）を持たない。** いいねの `useFavorites` は
 *   「未ログインでもハートが動く」ための仕組みだが、保存はログインしている
 *   人だけの機能。真値をサーバー1つに置く——2つ持つと、いいねが踏んだ
 *   「端末とサーバーで食い違う」をそのまま作り直すことになる
 *
 * ## いいねと同じにするところ（あちらが踏んだ穴）
 *
 * - **写真が変わったら状態を捨てる。** モーダルは同じフックのまま次の写真へ
 *   進む（コンポーネントを作り直さない）ので、これが無いと1枚目に付けた
 *   しおりが2枚目以降にも付いて見え、押すと解除が飛ぶ
 * - **押したあとなら、遅れて着地した取得で上書きしない**（`touchedRef`）
 * - **await の後に「まだ同じ写真か」を確かめてから書く**
 * - **失敗の理由を運ぶ。** `boolean` だと、押し直しても直らない失敗
 *   （セッション切れ・通信できない）に「もう一度お試しください」と
 *   言い続けることになる
 */
export type SaveResult = {
    ok: boolean;
    /** そのまま画面に出してよい理由（サーバーの文言・セッション切れ・通信できない） */
    message?: string;
    /** 未ログインだった。**失敗の文言ではなく、ログインへの案内を出す合図** */
    requiresAuth?: boolean;
};

export function usePhotoSave(photoId: string, isAuthenticated: boolean, authLoading = false) {
    const [saved, setSaved] = useState(false);
    const touchedRef = useRef(false);
    const photoIdRef = useRef(photoId);
    const [pending, setPending] = useState(false);
    const busyRef = useRef(false);

    // 写真が変わったら状態を捨てる（モーダルは同じフックのまま次へ進む）
    useEffect(() => {
        photoIdRef.current = photoId;
        touchedRef.current = false;
        setSaved(false);
        // **番人も下ろす。** 下ろさないと、前の写真で投げた要求が返って
        // いない間（回線が細いと最長20秒）、**次の写真の保存ボタンが黙って
        // 死ぬ**——`toggle` は入口で `{ ok: true }` を返して抜けるので、
        // 何も飛ばないのにトーストも出ない。
        // 前の要求が着地したときの `finally` で下ろされるのを待っていたが、
        // 待っている間がまさに押される時間だった。
        // 着地した側が状態を書くことは `stillSamePhoto()` が止める。
        busyRef.current = false;
        setPending(false);
    }, [photoId]);

    // ログイン中は自分の保存状態をサーバーに聞く。
    // **未ログインでは聞かない**（401 が返るだけ）。
    useEffect(() => {
        if (!isAuthenticated || authLoading || !photoId) {
            // **ログアウトしたら未保存に戻す。** 戻さないと、モーダルを
            // 開いたままログアウトした人に**塗られたしおりと「保存を
            // 取り消す」**が出たままになる（押しても未ログインの案内が出る
            // だけ）。`usePhotoLikes` が `setServerLiked(null)` で同じことを
            // している
            setSaved(false);
            return;
        }
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userFetch(`/user/saves/${encodeURIComponent(photoId)}`, { signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json() as { saved?: boolean };
                if (!aborted && !touchedRef.current && typeof data.saved === "boolean") setSaved(data.saved);
            } catch { /* 未保存のまま */ }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId, isAuthenticated, authLoading]);

    const toggle = useCallback(async (): Promise<SaveResult> => {
        if (busyRef.current) return { ok: true };
        // ログイン状態が確定するまで待つ。確定前に処理すると、ログイン済みでも
        // 「未ログイン」扱いになってサーバーへ届かない（`usePhotoLikes` と同じ）
        if (authLoading) return { ok: true };
        // **未ログインは案内を返す。** 楽観的にしおりを付けてはいけない
        // ——付けると「保存した」と見えるのに、どこにも残らない
        if (!isAuthenticated) return { ok: false, requiresAuth: true };

        const wasSaved = saved;
        busyRef.current = true;
        setPending(true);
        touchedRef.current = true;
        setSaved(!wasSaved);

        // 応答が返る頃には別の写真に送られているかもしれない
        const stillSamePhoto = () => photoIdRef.current === photoId;
        let result: SaveResult = { ok: true };

        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/save`, {
                method: wasSaved ? "DELETE" : "POST",
            });
            if (res.ok) {
                const data = await res.json().catch(() => null) as { saved?: unknown } | null;
                if (typeof data?.saved === "boolean" && stillSamePhoto()) setSaved(data.saved);
            } else if (!wasSaved && await isGoneResponse(res)
                && (await res.clone().json().catch(() => null) as { saved?: unknown } | null)?.saved === true) {
                // **「もう見えない」けれど「あなたの保存は残っている」。**
                // 非公開に戻された／消された写真でも、マーカーは別の item なので
                // 残る。これを「保存できなかった」と読んで未保存に戻すと、
                // **開いている間ずっと解除の導線が出ない**（解除の DELETE は
                // 通るのに、未保存表示では押しようがない）。`usePhotoLikes` が
                // 同じ形で `liked: true` を受けている
                if (stillSamePhoto()) setSaved(true);
            } else if (wasSaved && await isGoneResponse(res)) {
                // **解除は「もう見えない写真」でも通っている**
                // （サーバーは DELETE で公開状態を見ない——見ると、非公開に
                // 戻された写真を本人が棚から外せなくなるため）。
                // ここで巻き戻すと、サーバーは解除済みなのに画面は保存済みに
                // 戻り、押し直しても同じ 404 で直らない
                if (stillSamePhoto()) setSaved(false);
            } else {
                // **サーバーが言っている理由を捨てない。** `readApiError` は
                // 401 を「セッションの有効期限が切れています」に置き換える
                // ——いちばん多い失敗を「もう一度お試しください」にしない。
                // 既定文は呼び出し側が持つので、ここでは空にして落とす。
                //
                // **失敗を伝えるのは、まだその写真を見ているときだけ。**
                // 戻り値は呼び出し元がトーストにする＝「いま画面に出ている
                // 写真の話」として読まれるので、送ったあとに前の写真の失敗を
                // 返すと、**関係のない写真の上に「保存できませんでした」**が
                // 出る（`stillSamePhoto` を状態の書き込みにだけ掛けていた）
                const message = (await readApiError(res, "")) || undefined;
                if (stillSamePhoto()) {
                    result = { ok: false, message };
                    setSaved(wasSaved);
                    // 巻き戻した＝「押す前」の姿に戻ったので、番人も下ろす。
                    // 立てたままだと、遅れて届くサーバーの真値まで弾く
                    touchedRef.current = false;
                }
            }
        } catch (e) {
            log.warn("save toggle error:", e);
            // 失敗を伝えるのは、まだその写真を見ているときだけ（上と同じ理由）
            if (stillSamePhoto()) {
                result = { ok: false, message: sessionErrorMessage(e) ?? undefined };
                setSaved(wasSaved);
                touchedRef.current = false;
            }
        } finally {
            busyRef.current = false;
            setPending(false);
        }
        return result;
    }, [saved, photoId, isAuthenticated, authLoading]);

    return { saved, pending: pending || authLoading, toggle };
}
