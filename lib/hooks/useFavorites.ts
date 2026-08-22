import { useCallback, useSyncExternalStore } from "react";
import { storageGet, storageSet, storageRemove } from "../utils/storage";

// 未ログイン（端末）用の従来キー。ログイン中はユーザーごとのキーに分ける。
// 共有キー1本だった頃は、A のハート一覧が同じ端末の B や未ログイン閲覧者に
// そのまま見え、いいね判定のフォールバック（usePhotoLikes の
// `serverLiked ?? isFavorite`）を通じて B の初回押下が DELETE に化けもした。
const SHARED_KEY = "photo-gallery-favorites";
const CHANGE_EVENT = "favorites-updated";

let activeUserId: string | null = null;
const keyFor = (uid: string | null) => (uid ? `${SHARED_KEY}:${uid}` : SHARED_KEY);
const currentKey = () => keyFor(activeUserId);

// キー分離を入れる前（共有キー1本）の時代のハートを引き継いだか。
// この印が無い頃は「user キーが無ければ引き継ぐ」で判定していて、
// (a) 一度もハートしない人は毎回「初回」と判定されてその時点の共有キーを吸う
// (b) 別の人が未ログインで付けたハートまで、次に初回ログインした
//     アカウントへ丸ごと吸い込まれる
// という誤帰属が残っていた（AS 系レビューの指摘）。引き継ぎは
// **この端末で1回だけ**にする。旧時代のハートは（実質1人サイトなので）
// 最初にログインした人の物とみなす。以後の共有キーは純粋に匿名用。
const MIGRATED_KEY = `${SHARED_KEY}:migrated`;

/**
 * いまのアカウントを教える。auth/context が checkAuth / ログイン成功 /
 * ログアウト / 退会で呼ぶ。ログイン中のハートはユーザーごとのキーに入る。
 *
 * キー分離前の共有キーに溜まったハートは、分離後**最初に**ログインした
 * アカウントへ1回だけ引き継いで共有キーを空にする（引き継がないと
 * 既存ユーザーの一覧が空に見える／残すと次の人に見える）。
 */
export function setFavoritesUser(userId: string | null): void {
    if (activeUserId === userId) return;
    activeUserId = userId;
    if (userId !== null && storageGet<string>(MIGRATED_KEY) === undefined) {
        storageSet(MIGRATED_KEY, "1");
        const shared = storageGet<string[]>(SHARED_KEY);
        if (shared && shared.length > 0 && storageGet<string[]>(keyFor(userId)) === undefined) {
            storageSet(keyFor(userId), shared);
            storageSet(SHARED_KEY, []);
        }
    }
    invalidate();
}

/**
 * 指定アカウントのハートを端末から消す。退会で呼ぶ（同じ userId では
 * 二度とログインできないので、読めない鍵付きデータを残さない）。
 */
export function removeFavoritesUserData(userId: string): void {
    storageRemove(keyFor(userId));
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
