import { MEDIA_FIELDS } from "./mediaKeys";

/**
 * **絞った写真の実体を、別のプレフィックスへ移す**（設計書 案A）。
 *
 * ## なぜ移すのか
 *
 * CloudFront の「ビューワーアクセスを制限する」は**振る舞い単位**で効く。
 * `/uploads/*` 全体に付けると、**公開写真にも署名が要る**——公開写真の
 * URL を書いているのは静的サイトで、静的なので期限を持てない＝
 * **サイト全体の画像が割れる**。
 *
 * だから**絞った写真だけ別の場所へ動かし**、そちらの振る舞いにだけ
 * 署名必須を付ける（`docs/restricted-image-delivery.md` の案A）。
 *
 *     uploads/<uid>/…    公開    署名なしで配る（今までどおり）
 *     private/<uid>/…    絞った  署名必須の振る舞い
 *
 * ## ⚠️ 既に配られた URL は 404 になる
 *
 * 移した瞬間、古い `uploads/…` の URL は消える。**それが狙い**
 * ——「一度 URL を手にした人が取り続けられる」を止める唯一の方法で、
 * owner の承認事項として確認済み（2026-09-23）。絞る前に開いていた
 * 人の画面はその場で割れる。
 *
 * ## 順番に意味がある
 *
 * **コピー → 行の書き換え → 最後に元を消す。** 逆だと、途中で落ちた
 * ときに**行が存在しない実体を指す**（写真が割れる）。この順なら最悪でも
 * S3 に孤児が残るだけで、画面は正しく出る——`photoUpdate.ts` の差し替えが
 * 同じ理由で同じ順序を採っている。
 *
 * ## 派生も全部
 *
 * `MEDIA_FIELDS`（本体・サムネ・AVIF・小サイズ・**原本**）と
 * `extraImages` を通す。`src` だけ動かすと**派生だけ素のまま取れる**
 * ——鍵をかけた玄関の横に窓が開いている形。列挙は `mediaKeys` と
 * 同じ表を使う（**二度書かない**）。
 */

export const PUBLIC_PREFIX = "uploads/";
export const PRIVATE_PREFIX = "private/";

export type Move = { from: string; to: string };
export type MovePlan = {
    /** S3 で動かすもの（重複なし） */
    moves: Move[];
    /** 行に書き戻す項目（URL を書き換えたものだけ） */
    rewritten: Record<string, unknown>;
};

/** URL か生キーから、その接頭辞配下のキーを取り出す（それ以外は空文字） */
function keyUnder(value: unknown, prefix: string): string {
    if (typeof value !== "string" || !value) return "";
    const decodeOnce = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
    let path: string;
    if (value.startsWith(prefix)) {
        path = decodeOnce(value);
    } else {
        try {
            path = decodeOnce(new URL(value).pathname).replace(/^\//, "");
        } catch {
            return "";
        }
    }
    // `..` を含むキーは扱わない（`mediaKeys` と同じ線）
    if (path.includes("..")) return "";
    return path.startsWith(prefix) ? path : "";
}

/** URL（または生キー）の接頭辞を差し替える。**ホストと問い合わせは触らない** */
function swap(value: unknown, from: string, to: string): string | undefined {
    const key = keyUnder(value, from);
    if (!key) return undefined;
    const next = to + key.slice(from.length);
    const raw = value as string;
    if (raw.startsWith(from)) return next;
    try {
        const u = new URL(raw);
        u.pathname = "/" + next;
        return u.toString();
    } catch {
        return undefined;
    }
}

/**
 * 移動の計画を立てる。**S3 も DynamoDB も触らない**（ここは純粋）。
 *
 * @param item   写真の行
 * @param toPrivate true なら 公開→絞った、false なら 絞った→公開
 */
export function planMove(item: Record<string, unknown>, toPrivate: boolean): MovePlan {
    const from = toPrivate ? PUBLIC_PREFIX : PRIVATE_PREFIX;
    const to = toPrivate ? PRIVATE_PREFIX : PUBLIC_PREFIX;
    const seen = new Set<string>();
    const moves: Move[] = [];
    const rewritten: Record<string, unknown> = {};

    for (const field of MEDIA_FIELDS) {
        const key = keyUnder(item[field], from);
        if (!key) continue;
        const nextKey = to + key.slice(from.length);
        if (!seen.has(key)) { seen.add(key); moves.push({ from: key, to: nextKey }); }
        const nextValue = swap(item[field], from, to);
        if (nextValue !== undefined) rewritten[field] = nextValue;
    }

    // **2枚目以降も動かす。** 表紙だけ動かすと、追加ぶんが素のまま残る。
    //
    // 🔴 **`extraImages` は文字列ではなく「オブジェクトの配列」**
    // （`{ src, srcAvif, thumbSrc, …, width, height }`）。平らな配列で
    // 書き戻すと**形が壊れて2枚目以降が全部消える**——最初そう書いて、
    // テストが捕まえた。**要素ごとに、URL の項目だけ**差し替える。
    if (Array.isArray(item.extraImages)) {
        let changed = false;
        const nextExtras = item.extraImages.map((entry) => {
            if (!entry || typeof entry !== "object") return entry;
            const row = entry as Record<string, unknown>;
            const nextRow: Record<string, unknown> = { ...row };
            for (const [field, value] of Object.entries(row)) {
                const next = swap(value, from, to);
                if (next === undefined) continue;   // URL でない項目（width など）は触らない
                const key = keyUnder(value, from);
                if (key && !seen.has(key)) {
                    seen.add(key);
                    moves.push({ from: key, to: to + key.slice(from.length) });
                }
                nextRow[field] = next;
                changed = true;
            }
            return nextRow;
        });
        if (changed) rewritten.extraImages = nextExtras;
    }

    return { moves, rewritten };
}

/** 動かすものが1つも無い（もう向こう側に在る／実体が無い）か */
export function isNoop(plan: MovePlan): boolean {
    return plan.moves.length === 0;
}
