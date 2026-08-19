import { useCallback, useSyncExternalStore } from "react";
import { storageGet, storageSet } from "../utils/storage";

const STORAGE_KEY = "photo-gallery-favorites";
const CHANGE_EVENT = "favorites-updated";

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
        snapshot = storageGet<string[]>(STORAGE_KEY) ?? EMPTY;
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
        storageSet(STORAGE_KEY, next);
        invalidate();
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }, []);

    const isFavorite = useCallback(
        (photoId: string) => favorites.includes(photoId),
        [favorites]
    );

    // Always reads from storage to avoid stale-closure issues.
    const toggleFavorite = useCallback((photoId: string) => {
        const current = storageGet<string[]>(STORAGE_KEY) ?? [];
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
}
