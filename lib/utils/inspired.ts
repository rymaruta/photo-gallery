import type { LocalizedText, Photo } from "@/lib/data/photos";

/**
 * 写真ページの「この写真を見て撮影」の行に出す、元の写真の要約。
 *
 * **写真1枚ぶんを丸ごと渡さない**（RSC ペイロードに載るので、要る項目だけ）。
 */
export type InspiredLink = {
    id: string;
    title?: string | LocalizedText;
    /** 小さい画像（256px → 512px → 原寸の順で、あるもの） */
    thumb: string;
    userId?: string;
    displayName?: string;
};

/**
 * `photo.inspiredBy` が指す元の写真を、**公開の一覧 `all` の中から**探す。
 *
 * Web は追加の読み取りをしない——写真ページは公開の一覧（静的な `photos.json` と
 * `GET /photos`）を既に持っていて、そこに居るのは**公開中・公開範囲を絞っていない・
 * ストーリーでない**写真だけ。居なければ（非公開になった・削除された・絞った）出さない。
 * 一覧が古い行を含んでいても困らないよう、ここでも同じ線をもう一度見る
 * （`api-user/src/feed.ts` の `isPublicListPhoto` と同じ考え方。隠す側に倒す）。
 *
 * **付けた人と元の作者のブロックは、静的な `photos.json` を作るときに落としてある**
 * （`scripts/sync-photos-from-ddb.js` の `pruneInspiredBy`。読み取りは増やさない）。
 * ここでは見ない（印は画面に来ない）——だから写真ページは**ビルド時に解いたものだけ**を
 * 出し、API の一覧（ブロックを見られない）は減らす側にだけ使う（`PhotoPageClient`）。
 * 閲覧者本人とのブロックは見ない（静的なページには閲覧者が居ない。Web の他の公開ページと同じ）。
 * 閲覧者まで見る口はアプリ向けの `GET /user/inspired/{id}`（`api-user/src/inspired.ts`）。
 */
export function inspiredSourceFor(photo: Photo | null | undefined, all: readonly Photo[]): Photo | null {
    const id = photo?.inspiredBy;
    if (!photo || typeof id !== "string" || !id || id === photo.id) return null;
    const source = all.find((p) => p?.id === id);
    if (!source || !source.src) return null;
    const extra = source as Photo & { audience?: unknown; story?: unknown };
    if (source.published === false || extra.story === true) return null;
    if (extra.audience != null && extra.audience !== "") return null;
    return source;
}

/** 行に出す要約へ縮める */
export function toInspiredLink(source: Photo): InspiredLink {
    const name = source.displayName || source.uploaderDisplayName;
    return {
        id: source.id,
        ...(source.title !== undefined ? { title: source.title } : {}),
        thumb: source.thumbSm || source.thumbSrc || source.src,
        ...(source.userId ? { userId: source.userId } : {}),
        ...(name ? { displayName: name } : {}),
    };
}

// ─────────────────────────────────────────────────────────────
// 投稿画面の受け側（`/user/upload?inspiredBy=<写真ID>`・2026-10-15）
//
// 写真の詳細の「この写真を見て撮りに行く」から来たとき、元の写真を投稿に付ける。
// アプリの `InspiredBy`（journey.photo-ios の `Core/Text/InspiredBy.swift`）と同じ決まり。
// ─────────────────────────────────────────────────────────────

/** サーバーが受ける形（英数とハイフン・1〜64文字・`api-user/src/inspired.ts` の `sanitizeInspiredBy`）。
 *  合わない値は送らない（送ると 400 で投稿ごと止まる） */
export function normalizeInspiredId(raw: string | null | undefined): string | null {
    if (typeof raw !== "string") return null;
    const id = raw.trim();
    return /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

/** 投稿画面の欄に出す元の写真（表示に要る最小だけ） */
export type InspiredPick = {
    id: string;
    title?: string | LocalizedText;
    location?: string;
    /** 小さい画像（256px → 512px → 原寸の順で、あるもの） */
    thumb: string;
    displayName?: string;
};

/**
 * `GET /photos/{id}`（未認証の公開の口）の答えを、付けてよい元の写真に縮める。
 *
 * **付けられるのは公開で全員に見せている写真だけ**（アプリの `InspiredBy.canAttach`）——
 * それ以外はサーバーが黙って付けない（`readVisibleSource`）ので、欄に出さない。
 * 口は非公開・絞った写真に 404 を返すが、古い行・形の違う答えでも隠す側に倒す。
 * **自分の写真も付けない**（自分の写真を見て撮りに行く、は言い方として成り立たない。
 * 写真の詳細の `offersInspiredShoot` と同じ）。ID が頼んだものと違う答えも使わない。
 */
export function inspiredPickFrom(row: unknown, requestedId: string, viewerId: string | null | undefined): InspiredPick | null {
    if (!row || typeof row !== "object") return null;
    const p = row as Photo & { audience?: unknown; story?: unknown; uploadedBy?: unknown };
    if (normalizeInspiredId(p.id) !== requestedId) return null;
    if (typeof p.src !== "string" || !p.src.trim()) return null;
    if (p.published === false || p.story === true) return null;
    const audience = typeof p.audience === "string" ? p.audience.trim() : p.audience;
    if (audience != null && audience !== "" && audience !== "everyone") return null;
    const owner = p.userId || (typeof p.uploadedBy === "string" ? p.uploadedBy : undefined);
    if (viewerId && owner && viewerId === owner) return null;
    const name = p.displayName || p.uploaderDisplayName;
    return {
        id: requestedId,
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(typeof p.location === "string" && p.location.trim() ? { location: p.location.trim() } : {}),
        thumb: p.thumbSm || p.thumbSrc || p.src,
        ...(name ? { displayName: name } : {}),
    };
}

/**
 * **元の写真を載せる1枚**（アプリの `InspiredBy.Carrier` と同じ考え）。
 *
 * 🔴 サーバーは**付いた写真1枚ごとに**元の作者へ通知を1回送る（`notifyInspiredOnce`）。
 * 3枚の全部に付けると同じ人に3回届く。だから投稿のうち1枚だけに付ける:
 *
 *  - 載せる1枚は、最初に保存を送った写真に決める
 *  - その1枚が**届いたか分からない**（通信が切れた・5xx）間は、後ろの写真には載せない。
 *    押し直しもその1枚に載せる
 *  - 別の写真に引き継ぐのは、**確実に届いていない**とき（4xx で断られた）と、その1枚を外したときだけ
 */
export class InspiredCarrier {
    private photo: string | null = null;
    private attached = false;

    /** この写真の保存に載せる ID。まだ1枚に決めていなければ、この写真に決める */
    idToSend(item: string, pickId: string | null | undefined): string | null {
        const id = normalizeInspiredId(pickId);
        if (this.attached || !id) return null;
        if (this.photo === null) this.photo = item;
        return this.photo === item ? id : null;
    }

    /** 保存が通った（以後どの写真にも載せない） */
    saved(item: string): void {
        if (this.photo === item) this.attached = true;
    }

    /** 確実に届いていない（4xx で断られた）・帯から外した。次の写真に引き継ぐ */
    notDelivered(item: string): void {
        if (this.photo === item && !this.attached) this.photo = null;
    }
}

/** 送ったのに付かなかったか（元の写真が非公開・削除・ブロックになった）。
 *  応答に写真が無い回（形が違う）は分からないので「付かなかった」と言わない */
export function inspiredWasDropped(sent: string | null | undefined, saved: unknown): boolean {
    const id = normalizeInspiredId(sent);
    if (!id || !saved || typeof saved !== "object") return false;
    return normalizeInspiredId((saved as { inspiredBy?: string }).inspiredBy) !== id;
}
