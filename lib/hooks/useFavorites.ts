import { useCallback, useSyncExternalStore } from "react";
import { storageGet, storageSet } from "../utils/storage";

// 未ログイン（端末）用の従来キー。ログイン中はユーザーごとのキーに分ける。
// 共有キー1本だった頃は、A のハート一覧が同じ端末の B や未ログイン閲覧者に
// そのまま見え、いいね判定のフォールバック（usePhotoLikes の
// `serverLiked ?? isFavorite`）を通じて B の初回押下が DELETE に化けもした。
const SHARED_KEY = "photo-gallery-favorites";
const CHANGE_EVENT = "favorites-updated";

let activeUserId: string | null = null;
const keyFor = (uid: string | null) => (uid ? `${SHARED_KEY}:${uid}` : SHARED_KEY);
const currentKey = () => keyFor(activeUserId);

/**
 * いまのアカウントを教える。auth/context が checkAuth / ログイン成功 /
 * ログアウト / 退会で呼ぶ。ログイン中のハートはユーザーごとのキーに入る。
 *
 * 初回ログイン時は従来の共有キーから**引き継いで空にする**——
 * これまでログイン中に付けたハートは共有キーに溜まっているので、
 * 引き継がないと全員のお気に入り一覧が空に見える。共有キーを空にするのは、
 * 次にログインした別の人や未ログイン閲覧者に前の人のハートを見せないため。
 */
export function setFavoritesUser(userId: string | null): void {
    if (activeUserId === userId) return;
    activeUserId = userId;
    if (userId !== null && storageGet<string[]>(keyFor(userId)) === undefined) {
        const shared = storageGet<string[]>(SHARED_KEY);
        if (shared && shared.length > 0) {
            storageSet(keyFor(userId), shared);
            storageSet(SHARED_KEY, []);
        }
    }
    invalidate();
}

// お気に入りは端末ローカル（localStorage）にしか無い。
//
// これを useState の初期化子で読むと、サーバーで書き出した HTML（印なし）と
// クライアントの初回描画（印あり）が食い違い、React がハイドレーションの
// 不一致として木を捨てて描き直す。お気に入りがある人ほどトップがちらつく。
//
// useSyncExternalStore なら、ハイドレーション中はサーバー側スナップショット
// （空）を使い、その後クライアント側スナップショットに切り替わる。
// effect で setState する必要も無い。lib/hooks/useFollow.ts と同じ形。

const EMPTY: readonly string[] = [];

let snapshot: readonly string[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

/** 保存済みの値。参照を安定させないと useSyncExternalStore が無限に再描画する。 */
function getSnapshot(): readonly string[] {
    if (!loaded) {
        snapshot = storageGet<string[]>(currentKey()) ?? EMPTY;
        loaded = true;
    }
    return snapshot;
}

/** サーバー（と初回ハイドレーション）では常に空 */
function getServerSnapshot(): readonly string[] {
    return EMPTY;
}

function invalidate() {
    loaded = false;
    for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    // 同じタブの他のコンポーネントからの変更
    window.addEventListener(CHANGE_EVENT, invalidate);
    // 別タブでの変更
    window.addEventListener("storage", invalidate);
    return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
            window.removeEventListener(CHANGE_EVENT, invalidate);
            window.removeEventListener("storage", invalidate);
        }
    };
}

export function useFavorites() {
    const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const save = useCallback((next: string[]) => {
        storageSet(currentKey(), next);
        invalidate();
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }, []);

    const isFavorite = useCallback(
        (photoId: string) => favorites.includes(photoId),
        [favorites]
    );

    // Always reads from storage to avoid stale-closure issues.
    const toggleFavorite = useCallback((photoId: string) => {
        const current = storageGet<string[]>(currentKey()) ?? [];
        save(
            current.includes(photoId)
                ? current.filter((id) => id !== photoId)
                : [...current, photoId]
        );
    }, [save]);

    const clearFavorites = useCallback(() => save([]), [save]);

    return { favorites: favorites as string[], isFavorite, toggleFavorite, clearFavorites };
}

// テスト用: モジュール内キャッシュを捨てる
export function resetFavoritesCache(): void {
    loaded = false;
    snapshot = EMPTY;
    activeUserId = null;
}
