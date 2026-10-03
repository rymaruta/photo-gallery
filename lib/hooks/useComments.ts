import { usableRows } from "../utils/apiRows";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    userPublicFetch, userFetch, isGoneResponse, isMissingRouteResponse,
    AUTH_REQUIRED_MESSAGE, NETWORK_UNREACHABLE_MESSAGE,
} from "../utils/api";
import { log } from "../utils/log";

// 写真コメント。読み取り（ログイン中は認証つき）+ 認証投稿/削除。楽観更新は最小限（投稿は成功後に反映）。

export type CommentItem = {
    id: string;
    uid: string;
    name: string;
    text: string;
    t: string;
    /**
     * 投稿者が退会しているか。サーバー（api-user/src/comments.ts）が
     * 名前を「退会したユーザー」に伏せたときだけ立つ。
     * 画面はこれを見て、もう無いプロフィールへの導線を出さない。
     */
    deleted?: boolean;
};

/**
 * @param authLoading ログイン状態がまだ分からない期間（`useAuth().loading`）。
 *   この間は読みに行かない——未認証の口で先に読むと、ログイン中の人が
 *   限定写真を開いたとき 404 で「読み込めませんでした」が一瞬出て、
 *   確定後にもう一度読む（`usePhotoLikes` と同じ番人）
 */
export function useComments(photoId: string, isAuthenticated: boolean, initialCount = 0, authLoading = false) {
    const [items, setItems] = useState<CommentItem[]>([]);
    const [count, setCount] = useState(initialCount);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    // 取得の失敗を「0件」と混ぜない。混ぜると、付いているコメントが
    // 「まだコメントがありません」に化けて消えたように見える
    // （admin 一覧・下書き一覧で直したのと同じ型）。再試行で立て直す。
    const [loadError, setLoadError] = useState(false);
    // 再試行のたびに増やして effect を回し直す
    const [reloadKey, setReloadKey] = useState(0);
    const busyRef = useRef(false);
    // 一覧をサーバーの真値で置き換えた回数。削除の巻き戻しは、
    // **この間に取り直しが挟まっていたら行わない**（サーバーの方が正しい）。
    const listSeqRef = useRef(0);

    useEffect(() => {
        // ログインが確定するまで読まない（読み込み中の表示のまま待つ）
        if (authLoading) return;
        let aborted = false;
        const controller = new AbortController();
        setLoadError(false);
        // 写真・ログイン状態が変わって読み直す回も「読み込み中」に戻す
        // （前の回の失敗表示や一覧を、新しい答えが来るまで見せ続けない）
        setLoading(true);
        void (async () => {
            try {
                const id = encodeURIComponent(photoId);
                const readPublic = () => userPublicFetch(`/photos/${id}/comments`, { signal: controller.signal });
                // **ログイン中は認証つきの口で読む**（S-1）。公開範囲を絞った写真
                // （フォロワーのみ・親しい友達）は、未認証の口では閲覧者が分からず
                // 404 になる——フォロワーにもコメントが「読み込めません」と出る。
                // `usePhotoLikes` の `/user/likes/{id}` と同じく `userFetch` で呼ぶ。
                //
                // **戻るのは「道が無い」404 のときだけ**（API より Web が先に出た回）。
                // サーバーが断った 404（見せない相手）で未認証の口に戻っても同じ 404 で、
                // 往復が1回増えるだけ
                //
                // **トークンが取れない（セッション切れ・Cognito に届かない）・401 でも戻る。**
                // 公開の写真のコメントまで「読み込めませんでした」になるより、
                // 未認証の口で読める分を見せる方がよい（限定写真はそちらで 404 になるだけ）
                const readAuthed = async (): Promise<Response | null> => {
                    try {
                        return await userFetch(`/user/comments/${id}`, { signal: controller.signal });
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : "";
                        if (msg === AUTH_REQUIRED_MESSAGE || msg === NETWORK_UNREACHABLE_MESSAGE) return null;
                        throw e;
                    }
                };
                let res = isAuthenticated ? await readAuthed() : await readPublic();
                if (aborted) return;
                if (isAuthenticated && (res === null || res.status === 401 || await isMissingRouteResponse(res))) {
                    res = await readPublic();
                }
                if (!res) return;   // 型のため（上で必ず読み直している）
                if (res.ok) {
                    const data = await res.json() as { items?: CommentItem[]; count?: number };
                    if (!aborted) {
                        const rows = usableRows<CommentItem>(data.items, "GET /photos/{id}/comments");
                        if (!rows) {
                            // **配列でない応答を「まだコメントがありません」に
                            // しない。** `count` はサーバー値がそのまま入るので、
                            // 見出し「コメント 3」＋本文「まだコメントがありません」
                            // という矛盾した画面になっていた
                            setLoadError(true);
                            return;
                        }
                        listSeqRef.current++;
                        setItems(rows);
                        if (typeof data.count === "number") setCount(data.count);
                    }
                } else if (!aborted) {
                    setLoadError(true);
                }
            } catch {
                if (!aborted) setLoadError(true);
            } finally {
                if (!aborted) setLoading(false);
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId, reloadKey, isAuthenticated, authLoading]);

    const reload = useCallback(() => {
        setLoading(true);
        setReloadKey((k) => k + 1);
    }, []);

    /**
 * 投稿の結果。`error` のときは `message` に理由が入る。
 *
 * サーバーは断る理由を日本語で返している（「同じ写真へのコメントは
 * 10件までです」など）が、本文を捨てて「投稿に失敗しました」とだけ
 * 出していたので、利用者は障害だと思って何度も送り直していた
 * （そのたびに写真と200件のコメント文書を読み直す）。
 *
 * 理由を state で渡してはいけない。呼び出し側は
 * `const r = await add(text)` の直後に読むので、その関数が作られた
 * 描画時点の値——つまり**1回前の理由**——を見てしまう。
 * 初回の 429 では null のまま「投稿に失敗しました」が出て、
 * 2回目にようやく1回目の文言が出る、という形で踏んでいた。
 * だから理由は戻り値だけで渡す。
 */
    type AddResult = { status: "ok" | "auth-required" | "empty" | "error"; message?: string };
    const add = useCallback(async (text: string): Promise<AddResult> => {
        const trimmed = text.trim().slice(0, 500);
        if (!trimmed) return { status: "empty" };
        if (!isAuthenticated) return { status: "auth-required" };
        if (busyRef.current) return { status: "error" };
        busyRef.current = true;
        setPending(true);
        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/comments`, {
                method: "POST",
                body: JSON.stringify({ text: trimmed }),
            });
            if (!res.ok) {
                const { readApiError } = await import("../utils/api");
                return { status: "error", message: await readApiError(res, "投稿に失敗しました") };
            }
            const data = await res.json() as { comment?: CommentItem };
            if (data.comment) {
                setItems((prev) => [data.comment as CommentItem, ...prev]);
                setCount((c) => c + 1);
                // 一覧の取得失敗の表示が残っていると、投稿は成功したのに
                // 自分のコメントが画面に出ない（件数だけ増えて不審）。
                // 投稿できた＝疎通は生きているので、表示を一覧に戻す
                setLoadError(false);
            }
            return { status: "ok" };
        } catch (e) {
            log.error("comment add error:", e);
            // 通信そのものが落ちた場合も、前回の理由を残さない
            // （無関係な失敗に「10件までです」が出ていた）。
            // **ただしセッション切れは塗り潰さない**——「通信に失敗しました」
            // だと回線の問題だと思って何度も押すことになる。押しても直らない。
            // `useFollow` は同じ場所で前からこう書いてある（対の乖離だった）
            const msg = e instanceof Error ? e.message : "";
            // **既にある導線に乗せる。** `auth-required` は「押す前に
            // 未ログインと分かった」場合のために用意されていて、画面側は
            // ロケール対応の案内（「コメントするにはログインしてください」）を
            // info で出す。**送ってから分かった場合も同じことなので同じ口へ**
            // ——`error` で返すと、その分岐を素通りして日本語固定の定数が
            // 赤いトーストで出る（`useFollow.ts:378` は前からこの形）
            if (msg === AUTH_REQUIRED_MESSAGE) return { status: "auth-required", message: msg };
            // 通信できないだけの回はログインの案内にしない（`useFollow` と同じ）
            if (msg === NETWORK_UNREACHABLE_MESSAGE) return { status: "error", message: msg };
            return { status: "error", message: "通信に失敗しました" };
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [photoId, isAuthenticated]);

    const remove = useCallback(async (commentId: string): Promise<boolean> => {
        // 楽観削除 + 失敗時ロールバック。
        // 件数は「元の件数」を覚えて戻す。items.length で戻していた頃は、
        // 表示件数（上限200）と実際の件数がずれている写真で、削除に失敗した
        // 瞬間にヘッダーの件数が 200 に書き換わり、再読込まで直らなかった。
        //
        // **戻すのは「この1件」だけ。** 配列まるごとの控えに戻していた頃は、
        // 2件続けて消して**先の1件が失敗**すると、後の1件（サーバーでは
        // 削除済み）が画面に戻り、件数も2つぶん戻った——このボタンは
        // disabled にならないので、通信が遅ければ普通に重ねられる。
        // 元の位置に差し戻すため、消す前の添字を控えておく。
        const removed = items.find((c) => c.id === commentId);
        const removedAt = items.findIndex((c) => c.id === commentId);
        const listAt = listSeqRef.current;
        setItems((prev) => prev.filter((c) => c.id !== commentId));
        setCount((c) => Math.max(0, c - 1));
        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/comments/${encodeURIComponent(commentId)}`, {
                method: "DELETE",
            });
            // **404 は成功として扱う。** 別のタブ（や写真オーナー）が先に
            // 消していると、サーバーは「コメントが見つかりません」を返す。
            // これを失敗と読んで巻き戻していたので、**消えたはずのコメントが
            // 一覧に戻り**、「削除できませんでした」と出て、何度押しても
            // 同じことが起きた（リロードするまで直らない）。
            // サーバー自身も、再試行の途中で消えた場合は成功扱いにしている
            // （api-user/src/comments.ts の gone）。入口だけ厳しかった。
            if (await isGoneResponse(res)) {
                // 手元の一覧が古い合図でもある。取り直して収束させる
                // （ストーリー側は loadStories() で同じことをしている）
                reload();
                return true;
            }
            if (!res.ok) throw new Error(String(res.status));
            return true;
        } catch (e) {
            log.error("comment delete error:", e);
            // 巻き戻しの前に、一覧が取り直されていないか見る。
            // 別の削除が 404（＝別タブが先に消した）で reload を起こしていると、
            // 手元は既にサーバーの真値になっている。そこへ戻すと
            // **1件しか無いのに「2件」**のような食い違いを作る（items にだけ
            // ガードを置いて count に置かなかった頃、実際にそうなっていた）。
            if (removed && listAt === listSeqRef.current) {
                setItems((prev) => {
                    if (prev.some((c) => c.id === commentId)) return prev;   // 既に戻っている
                    const next = [...prev];
                    next.splice(Math.max(0, Math.min(removedAt, next.length)), 0, removed);
                    return next;
                });
                setCount((c) => c + 1);
            }
            return false;
        }
    }, [photoId, items, reload]);

    return { items, count, loading, loadError, reload, pending, add, remove };
}
