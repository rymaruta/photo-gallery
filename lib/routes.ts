import PHOTO_INDEX from "@/app/data/photo-index.json";

// **`photos.json` を丸ごと読まない。** ここで要るのは id が2組だけなのに、
// 以前は写真データを全部 import していた——JSON のモジュールは項目単位で
// 落とせない（バンドラは使っていない属性を捨てられない）ので、説明文も
// EXIF もぼかしも一緒にクライアントへ載る。
//
// **このファイルを読むのはヘッダーとフッター＝全ページ。**
// 実測（`npx next build` の出力）: 写真の中身を含む **36.2KB** のチャンクを
// **生成された140ページ中138ページ**が読み込んでいた。索引だけなら 1.4KB。
//
// 索引は `scripts/sync-photos-from-ddb.js` が `photos.json` と**同じ
// 書き込み**で作る（別のタイミングにすると、写真だけ増えて索引が古いまま
// ＝個別ページは在るのにリンクが `/?photo=<id>` に落ちる）。
// 2つがずれていないことは `scripts/__tests__/photoIndexParity.test.ts` が見る。

// ビルド時に静的生成された写真詳細ページの ID 一覧。
// 静的エクスポート（output: "export"）では /photo/[id] のページは
// ビルド時点の photos.json に存在する写真しか生成されない。
// ビルド後にアップロードされた写真の /photo/<id> は S3 に存在せず 404 になるため、
// その場合はトップページのモーダル表示（/?photo=<id>）へフォールバックする。
// 翌日の定期再ビルドで静的ページが生成されると、自動的に /photo/<id> に切り替わる。
// **型は明示する。** `new Set(PHOTO_INDEX.photoIds)` だけだと、索引が
// **空配列のとき** TypeScript が `Set<never>` と推論し、`.has(id: string)` が
// 型エラーになる——**写真が1枚も無い環境ではサイトがビルドできない**。
// staging の DynamoDB は空（本番の写真はコピーしない方針）なので、
// ビルド時の同期で索引が空になり、**staging のデプロイが必ず落ちていた**
// （実測: run 375 の Build が `Argument of type 'string' is not assignable
// to parameter of type 'never'` で停止）。
// 手元の `photos.json` は写真を持っているので、**コミット済みの断面では
// 再現しない**。空の索引を置いて初めて出る。
const BUILT_PHOTO_IDS: ReadonlySet<string> = new Set<string>(PHOTO_INDEX.photoIds);

// ビルド時に投稿があるユーザーは /users/<id> が静的生成されている
// （ユーザー個別の OGP カード付き）。それ以外はクエリ版にフォールバック。
const BUILT_USER_IDS: ReadonlySet<string> = new Set<string>(PHOTO_INDEX.userIds);

/**
 * その写真の**個別ページが実在する**か。
 *
 * `ROUTES.PHOTO` は無ければ `/?photo=<id>` に落とすので、どこから押しても
 * 行き止まりにはならない——**モーダルの中を除いて**。あそこは既に
 * `/?photo=<id>` が開いている画面なので、「個別ページを見る」を押しても
 * **何も起きない**（同じ URL へ飛んで同じモーダルが開き直るだけ）。
 * しかも文言は個別ページを約束している。
 *
 * 落ちるのは「公開してから再ビルドが終わるまで」の数分だけ
 * （実データ30枚は全部 `/photo/<id>` を持つ）。短い窓だが、**その窓は
 * 投稿した本人が自分の写真を見に来る時間そのもの**。
 */
export function hasPhotoPage(id: string): boolean {
    return BUILT_PHOTO_IDS.has(id);
}

export const ROUTES = {
    HOME: "/",
    FAVORITES: "/favorites",
    /** 保存した写真（ブックマーク）。**`FAVORITES`（いいね）とも `SAVED_SPOTS` とも別のページ** */
    SAVES: "/saves",
    /**
     * 行きたい場所（保存した撮影スポット）。**写真の「保存」とは別物**。
     * **検索結果に出さない**——本人だけが見られる中身なので、
     * `/favorites` と同じ扱い（`noindexMetadata`）。
     */
    SAVED_SPOTS: "/saved-spots",
    MAP: "/map",
    /**
     * 公式撮影地ガイドの索引。**`/location`（写真から作る撮影地の索引）とは
     * 別の面**——あちらは写真の集約、こちらは運営が書いたガイド。
     * 写真が0枚の場所も載る。
     */
    SPOTS: "/spots",
    /**
     * 都道府県ごとの撮影スポット一覧。`/spots` を県の一覧に分けたときの行き先
     * （`app/spots/area/[area]/page.tsx`）。**`area` という綴りのスポットを
     * 台帳に入れるとここと衝突する**——見張りは `spotsLedger.test.ts`。
     */
    SPOT_AREA: (area: string) => `/spots/area/${encodeURIComponent(area)}`,
    /** 写真をさがす（絞り込みと一覧）。**検索結果に出さない**——トップと中身が重なる */
    SEARCH: "/search",
    PRIVACY: "/privacy",
    TERMS: "/terms",
    ADMIN: "/admin",
    LOGIN: "/login",
    SIGNUP: "/signup",
    UPLOAD: "/user/upload",
    DRAFTS: "/user/drafts",
    ALBUMS: "/user/albums",
    /** 自分のストーリーのアーカイブ（24時間で消えたあと、本人だけが見る） */
    STORY_ARCHIVE: "/user/archive",
    /**
     * ハイライトを作る・直す（アーカイブから束ねてマイページの輪にする）。
     * `id` を渡すと既存のものを直す画面（`/user/edit?id=` と同じ形）
     */
    HIGHLIGHT_EDITOR: (id?: string) =>
        id ? `/user/highlights?id=${encodeURIComponent(id)}` : "/user/highlights",
    EDIT: (id: string) => `/user/edit?id=${encodeURIComponent(id)}`,
    PROFILE_EDIT: "/user/profile",
    /**
     * 設定（アカウント・プライバシー・サポート）。**本人だけの画面**なので
     * `appPageMetadata` で noindex（`robots.txt` は `/user/` を丸ごと
     * 拒否しているので追記不要）。
     *
     * プロフィール編集（`PROFILE_EDIT`）とは別物。あちらは「他人に見える
     * 自分」を作る画面で、こちらは**アカウントそのもの**の設定。
     */
    SETTINGS: "/user/settings",
    USER_SEARCH: "/users/search",
    PHOTO: (id: string) =>
        BUILT_PHOTO_IDS.has(id)
            ? `/photo/${id}`
            : `/?photo=${encodeURIComponent(id)}`,
    USER_PROFILE: (id: string) =>
        BUILT_USER_IDS.has(id)
            ? `/users/${encodeURIComponent(id)}`
            : `/users?id=${encodeURIComponent(id)}`,
} as const;

/** 同一オリジン判定のためだけの土台。実在しない TLD を使う（誤って外へ出さない） */
const SAME_ORIGIN_SENTINEL = "https://same-origin.invalid";

/**
 * ログイン後の戻り先として受け取ってよいパスか。
 *
 * **サイト内の絶対パスだけを通す。** ここを緩めるとオープンリダイレクト
 * （`/login?next=https://evil.example` で外部へ飛ばす踏み台）になる。
 *  - `/` 始まりでないもの（`https://…`・`javascript:` など）を弾く
 *  - `//host` はスキーム相対で外部へ出るので弾く
 *  - `/\` はブラウザによっては `//` と同じに解釈されるので弾く
 * 通らなければ null を返し、呼び出し側が既定の行き先に落とす。
 */
export function safeNextPath(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw) return null;
    // 相対パス（"photo/abc"）や別スキーム（"javascript:"）を先に落とす
    if (!raw.startsWith("/")) return null;
    // **前方一致で "//" を弾くだけでは足りなかった。** URL のパーサは
    // タブ・改行・CR を**解釈の前に取り除く**ので、`/<TAB>/evil.com` は
    // `//evil.com` と同じ意味になる。前方一致は素通りするので、
    //   https://journey-photo.com/login?next=%2F%09%2Fevil.com
    // を踏ませるだけで外部へ飛ばせた（ログイン済みなら無操作で発火する）。
    // 列挙をやめて**パーサに判定させる**。制御文字もバックスラッシュも、
    // 将来の解釈差も、これで一括で塞がる。
    let u: URL;
    try {
        u = new URL(raw, SAME_ORIGIN_SENTINEL);
    } catch {
        return null;
    }
    if (u.origin !== SAME_ORIGIN_SENTINEL) return null;
    // 解釈しなおした形を返す（紛れ込んだ制御文字はここで落ちる）
    const out = u.pathname + u.search + u.hash;
    // **返す値そのものを、もう一度確かめる。**
    //
    // 判定は `raw` に対して行ったが、URL のパーサは**オリジンを決めたあとに
    // パスを正規化する**——`..` で先頭のセグメントを潰すと `//evil.example`
    // が残る:
    //     new URL("/..//evil.example", base).origin   → base（同一オリジンに見える）
    //     new URL("/..//evil.example", base).pathname → "//evil.example"
    // つまり**「同一オリジンだと確かめた値」ではなく「外部を指す値」を
    // 返していた**。`/login?next=%2F..%2F%2Fevil.example` を踏ませるだけで
    // 外部へ飛ぶ（ログイン済みなら無操作、未ログインでもパスワードを
    // 入れた直後）。正規ドメインのリンクなのでフィッシングの踏み台になる。
    //
    // 「`//` で始まるものを弾く」でも今の形は塞がるが、それは**また列挙**
    // ——前回タブ文字で抜かれたのと同じ形に戻る。判定と返却の対象を
    // 一致させる方が、次の言い回しにも耐える。
    try {
        if (new URL(out, SAME_ORIGIN_SENTINEL).origin !== SAME_ORIGIN_SENTINEL) return null;
    } catch {
        return null;
    }
    return out;
}

/** ログイン画面へ。戻り先を添える（省略時は既定＝自分のプロフィール） */
export function loginWithNext(next?: string | null): string {
    const safe = safeNextPath(next);
    return safe ? `${ROUTES.LOGIN}?next=${encodeURIComponent(safe)}` : ROUTES.LOGIN;
}
