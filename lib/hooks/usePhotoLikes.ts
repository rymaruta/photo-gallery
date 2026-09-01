import { useCallback, useEffect, useRef, useState } from "react";
import { useFavorites } from "./useFavorites";
import { userPublicFetch, userFetch, isGoneResponse } from "../utils/api";
import { log } from "../utils/log";

// 写真の「いいね」。ハート1つで2つの役割を担う:
//   - liked（塗りつぶし状態）と /favorites への収集 … 端末ローカル（useFavorites）
//   - likes（全員に見える数）… サーバー（ユーザーAPI）
//
// 未ログインでもローカルのお気に入りは動くが、サーバーカウントは
// 認証済みのときだけ増減する（userFetch が失敗しても UI は壊さない）。
//
// authLoading は「まだログイン状態が分からない」期間。ここを見ないと、
// 共有リンクを開いた直後（セッション復元の往復中）に押したいいねが
// 「未ログイン」と判定されてローカル保存だけで終わり、サーバーには
// 何も送られない。リロードすると数が戻り、通知も飛ばない。
export function usePhotoLikes(
    photoId: string,
    initialLikes: number,
    isAuthenticated: boolean,
    authLoading = false,
) {
    const { isFavorite, toggleFavorite } = useFavorites();
    // サーバー側の「いいね済みか」。ログイン中だけ引く（未ログインは端末のみ）。
    //
    // 以前は端末のお気に入り（localStorage）だけで判断していた。
    // 未ログインでハートを押した状態のままログインすると、次の一押しが
    // DELETE になり「取り消し」として扱われる——投稿者にいいねも通知も
    // 届かないまま、押した本人は「押せた」と思っている。
    // 別の端末では逆に、いいね済みの写真が未いいねに見える。
    const [serverLiked, setServerLiked] = useState<boolean | null>(null);
    // 本人がもう押したあとかどうか。サーバーの初期値の到着が遅れると、
    // せっかく押したハートを古い値で上書きしてしまう。
    const touchedRef = useRef(false);
    // 今どの写真を扱っているか。await の後に「まだ同じ写真か」を確かめるのに使う。
    const photoIdRef = useRef(photoId);
    const liked = serverLiked ?? isFavorite(photoId);
    const [count, setCount] = useState(initialLikes);
    // 写真が変わったときに戻す先。props をそのまま effect の依存に入れると
    // 親の再レンダーごとに件数が巻き戻るので、ref で持つ。
    const initialLikesRef = useRef(initialLikes);
    initialLikesRef.current = initialLikes;
    const [pending, setPending] = useState(false);
    const busyRef = useRef(false);

    // 最新のサーバーカウントを取得（表示のため）
    useEffect(() => {
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userPublicFetch(`/photos/${encodeURIComponent(photoId)}/like`, { signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json() as { likes?: number };
                // **押したあとなら書かない。** この取得はマウント時に投げた
                // もので、運ぶのは「押す前の数」。遅れて着地すると、
                // POST/DELETE がサーバーの真値で確定させた数を**古い値で
                // 巻き戻す**（ハートは付いたまま数字だけ42に戻る、の形）。
                // 同じ番人を `serverLiked` にだけ入れて、数字に入れ忘れていた
                // ——このファイルの冒頭コメントが警告しているのは、まさに
                // この上書き。
                if (!aborted && !touchedRef.current && typeof data.likes === "number") setCount(data.likes);
            } catch { /* 初期値のまま */ }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId]);

    // 写真が変わったら状態を捨てる。
    // モーダルは同じフックのまま次の写真へ進む（コンポーネントを作り直さない）ので、
    // これが無いと1枚目に付けたいいねが2枚目以降にも付いて見え、
    // しかも touchedRef が立ったままなので本当の状態を聞き直しても捨ててしまう。
    // 結果、2枚目のハートを押すと DELETE が飛んで「いいねが付かない」。
    useEffect(() => {
        photoIdRef.current = photoId;
        touchedRef.current = false;
        setServerLiked(null);
        // 件数も写真ごとに戻す。戻さないと、次の写真の件数取得が失敗したときに
        // 前の写真の数がそのまま表示され続ける（42いいねの写真から送ると、
        // 次の写真も42と出たまま直らない）。
        setCount(initialLikesRef.current);
    }, [photoId]);

    // ログイン中は自分のいいね状態をサーバーに聞く
    useEffect(() => {
        if (!isAuthenticated || authLoading || !photoId) { setServerLiked(null); return; }
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userFetch(`/user/likes/${encodeURIComponent(photoId)}`, { signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json() as { liked?: boolean };
                if (!aborted && !touchedRef.current && typeof data.liked === "boolean") setServerLiked(data.liked);
            } catch { /* 端末のお気に入りのまま */ }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId, isAuthenticated, authLoading]);

    /**
     * ハートを押す。**失敗したら false を返す**（呼び出し元が伝える）。
     * 以前は log.warn だけで黙ってロールバックしていたので、押した人には
     * 「付いたハートが黙って戻る」だけに見えた——フォローは文言を出すのに
     * いいねだけ無言、という非対称でもあった（SW-b4）。
     */
    const toggle = useCallback(async (): Promise<boolean> => {
        if (busyRef.current) return true;
        // ログイン状態が確定するまで待つ。確定前に処理すると、ログイン済みでも
        // 「未ログイン」扱いになってサーバーへ届かない。
        if (authLoading) return true;
        let failed = false;
        busyRef.current = true;
        setPending(true);

        const wasLiked = liked;
        // 楽観更新: ローカルのお気に入りとカウントを即時反映。
        //
        // お気に入り（/favorites への収集）はサーバーの状態とずれていることが
        // ある（未ログインで押した分・別端末で押した分）。押したあとの姿に
        // 合わせるので、既にその状態ならトグルしない。巻き戻しのために
        // 「実際に動かしたか」を覚えておく——巻き戻し時に現在値を読み直すと、
        // この関数が閉じ込めている古い値を見てしまい戻せない。
        const didToggleFavorite = isFavorite(photoId) !== !wasLiked;
        if (didToggleFavorite) toggleFavorite(photoId);
        setServerLiked(!wasLiked);

        if (!isAuthenticated) {
            // 未ログインはローカルのお気に入りだけ。**表示中の件数も動かさない**。
            // 動かしていた頃は、42いいねの写真でハートを押すと「43」に見え、
            // もう一度押すと「42」に戻った——サーバーには何も送っていないので、
            // 公開の数字を勝手に上下させているだけだった。
            busyRef.current = false;
            setPending(false);
            return true;   // 未ログインはローカル保存だけ＝失敗ではない
        }
        // **番人はサーバーに書きに行くと決まってから立てる。**
        //
        // 入口で立てていたので、**未ログインで押しただけ**でも立っていた
        // ——未ログインはサーバーに何も送らないのに、マウント時の件数取得
        // （唯一の是正経路）が永久に殺され、ビルド時の古い数字が出たまま
        // 固定される。番人が下りるのは写真を切り替えたときだけで、
        // 写真ページでは切り替わらない。
        touchedRef.current = true;
        setCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));

        // 応答が返る頃には別の写真に送られているかもしれない。
        // serverLiked と count は写真ごとの表示なので、
        // 「まだ同じ写真か」を確かめてから書く。確かめずに書いていた頃は、
        // Aで押した結果がBのハートと件数に反映されていた
        // （Bがいいね済みでも空になり、次の一押しが POST になる）。
        const stillSamePhoto = () => photoIdRef.current === photoId;

        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/like`, {
                method: wasLiked ? "DELETE" : "POST",
            });
            if (res.ok) {
                const data = await res.json() as { likes?: number };
                if (typeof data.likes === "number" && stillSamePhoto()) setCount(data.likes); // サーバーの真値で確定
            } else if (!wasLiked && await isGoneResponse(res)
                && (await res.clone().json().catch(() => null) as { liked?: unknown } | null)?.liked === true) {
                // **「もう見えない」けれど「あなたのいいねは残っている」。**
                //
                // マーカーが既にある写真が非公開に戻された／削除された場合、
                // サーバーは数字を出さずに 404 を返すが `liked: true` を
                // 添えてくる（`likePhoto` の冪等経路。マーカーは写真とは別の
                // item なので、写真が消えても残る）。これを「付かなかった」と
                // 読んで未いいねに戻すと、**そのモーダルを開いている間、
                // 解除の導線が出ない**——解除の DELETE 自体は通るのに、
                // 未いいね表示では押しようがない。開き直せば
                // `/user/likes/` が `true` を返して回復するので、
                // 「永久に」ではない（最初そう書いたのは言い過ぎだった）。
                //
                // **お気に入りはここで触らない。** 上の楽観トグルが既に
                // 「いいね済み」の姿に揃えている。`isFavorite` はこの関数が
                // 閉じ込めている**押す前の値**なので、ここで見て触ると
                // 同じ id を2回トグルする＝追加して即削除になる
                // （押したのに `/favorites` から消える）。
                //
                // 番人（`touchedRef`）も下ろさない。巻き戻しの経路と違って、
                // ここは「押す前の姿」に戻していない（いいね済みを出したまま）。
                // 下ろすと、遅れて着地する取得がその表示を上書きできてしまう。
                if (stillSamePhoto()) {
                    setServerLiked(true);
                    // 数字は増えていない（マーカーは前からある）ので楽観の +1 を戻す
                    setCount((c) => Math.max(0, c - 1));
                }
            } else if (wasLiked && await isGoneResponse(res)) {
                // **解除は「もう見えない写真」でも通っている。**
                //
                // サーバーはマーカーを消してカウンタも減らしたうえで、
                // 非公開・削除済みなら数字を返さずに 404 を返す
                // （`api-user/src/likes.ts` の DELETE。減算に公開判定を
                // 足すと「非公開になった写真のいいねを本人が永久に取り消せ
                // ない」ため、意図してそうしてある）。
                // ここで巻き戻すと、**サーバーは解除済みなのに画面はいいね済み**
                // に戻り、押し直しても同じ 404 で永久に直らない。
                // コメントの削除は既に `isGoneResponse` で同じ扱いにしている。
                //
                // 付ける側（POST）はここに入れない。**ただし「何も起きて
                // いない」とは限らない**——サーバーがマーカーを戻すのは
                // カウンタ更新に失敗した分岐だけで、「既にマーカーがある
                // ＋非公開」の 404 では**マーカーは残る**（`likePhoto` の
                // 冪等経路）。その場合こちらは巻き戻すので、サーバー＝
                // いいね済み／画面＝未いいね で固定される。踏むには
                // 「別端末でいいね → 非公開化 → `/user/likes/` が着地する
                // 前に押す」が要る。直すならサーバーが 404 に `liked: true`
                // を載せる必要があるので、ここでは**直していない**。
                if (stillSamePhoto()) setServerLiked(false);
            } else {
                // 失敗 → 楽観更新を巻き戻す
                if (didToggleFavorite) toggleFavorite(photoId);
                if (stillSamePhoto()) {
                    setServerLiked(wasLiked);
                    setCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
                    // 巻き戻した＝「押す前」の姿に戻ったので、番人も下ろす。
                    // 立てたままだと、遅れて届くサーバーの真値まで弾く
                    touchedRef.current = false;
                }
                failed = true;
            }
        } catch (e) {
            log.warn("like toggle error:", e);
            if (didToggleFavorite) toggleFavorite(photoId);
            if (stillSamePhoto()) {
                setServerLiked(wasLiked);
                setCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
                touchedRef.current = false;   // 上と同じ
            }
            failed = true;
        } finally {
            busyRef.current = false;
            setPending(false);
        }
        return !failed;
    }, [liked, photoId, isAuthenticated, authLoading, isFavorite, toggleFavorite]);

    return { liked, count, pending: pending || authLoading, toggle };
}
