// api-user/src/sanitize.ts
// 保存/更新時の入力サニタイズ。upload.ts と photoUpdate.ts で共有する。

import type { Photo } from "./types";

// 撮影情報のサニタイズ: 既知のキーだけを通し、文字列は100文字に制限。
// GPS など想定外のフィールドは保存しない
export function sanitizeExif(exif: unknown): Photo["exif"] {
    if (!exif || typeof exif !== "object") return undefined;
    const src = exif as Record<string, unknown>;
    const out: Record<string, string | number> = {};
    for (const k of ["camera", "lens", "aperture", "exposure", "focalLength", "whiteBalance", "imageSize", "dateTimeOriginal"]) {
        const v = src[k];
        if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 100);
    }
    if (typeof src.iso === "number" && Number.isFinite(src.iso) && src.iso > 0) out.iso = Math.round(src.iso);
    return Object.keys(out).length > 0 ? (out as Photo["exif"]) : undefined;
}

// 撮影地座標の検証と丸め。プライバシーのため約1km精度（小数第2位）に丸めて保存する
export function sanitizeCoords(coords: unknown): { lat: number; lng: number } | null {
    if (!coords || typeof coords !== "object") return null;
    const { lat, lng } = coords as { lat?: unknown; lng?: unknown };
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

// 単一テキスト。空/非文字列は undefined
export function sanitizeText(v: unknown, max: number): string | undefined {
    return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

/**
 * 撮影日。ISO 文字列（または解釈可能な日付）を ISO に正規化する。
 * 未来すぎる / 古すぎる値は誤検出とみなして捨てる（EXIF が壊れている写真がある）。
 */
export function sanitizeDate(v: unknown): string | undefined {
    if (typeof v !== "string" || !v.trim()) return undefined;
    const t = Date.parse(v.trim());
    if (Number.isNaN(t)) return undefined;
    const year = new Date(t).getUTCFullYear();
    // 写真が存在しうる範囲。カメラの日付未設定（1970/1980）や未来日を弾く
    if (year < 1990 || t > Date.now() + 24 * 60 * 60 * 1000) return undefined;
    return new Date(t).toISOString();
}

// ぼかしプレビュー: 画像の data URI（webp/jpeg/png の base64）のみ許可。長すぎるものは破棄。
// 極小画像想定のため上限は 4000 文字（~3KB）。
export function sanitizeBlurDataURL(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    if (s.length > 4000) return undefined;
    return /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : undefined;
}

// タグ配列: 文字列のみ・trim・各50文字・重複排除・最大30件（空配列も返しうる＝全消し）
export function sanitizeTags(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const cleaned = v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 50));
    return Array.from(new Set(cleaned)).slice(0, 30);
}

// タイトル: string か {ja,en}。空なら undefined
export function sanitizeTitle(v: unknown): Photo["title"] | undefined {
    if (typeof v === "string") return v.trim().slice(0, 200) || undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const ja = typeof o.ja === "string" ? o.ja.trim().slice(0, 200) : "";
        const en = typeof o.en === "string" ? o.en.trim().slice(0, 200) : "";
        if (ja || en) return { ...(ja ? { ja } : {}), ...(en ? { en } : {}) };
    }
    return undefined;
}

// 説明: string か {ja:[],en:[]}。空なら undefined
export function sanitizeDescription(v: unknown): Photo["description"] | undefined {
    if (typeof v === "string") return v.trim().slice(0, 2000) || undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const arr = (x: unknown): string[] | undefined => {
            if (!Array.isArray(x)) return undefined;
            const lines = x
                .filter((p): p is string => typeof p === "string")
                .map((p) => p.trim().slice(0, 2000))
                .filter(Boolean)
                .slice(0, 50);
            return lines.length ? lines : undefined;
        };
        const ja = arr(o.ja);
        const en = arr(o.en);
        if (ja || en) return { ...(ja ? { ja } : {}), ...(en ? { en } : {}) };
    }
    return undefined;
}


/**
 * 保存済みの値と、これから書く値が同じか。
 *
 * 「静的ページを作り直すか」の判定に使う。以前は「キーが body にあるか」
 * だけを見ていたが、/user/edit も /admin/edit も**保存のたびに全項目を
 * 送る**ので、何も変えずに保存しただけで毎回ビルドを頼んでいた。
 * ビルドは1回8分で、Actions の枠は月2,000分しかない。
 *
 * キーの順番は DynamoDB を通ると変わり得るので JSON 文字列の比較では
 * 足りない。配列は順番が意味を持つ（タグの並び）ので順番も見る。
 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    // undefined と null は「無い」として同じ扱い（クリアは REMOVE になる）
    if (a === undefined || a === null) return b === undefined || b === null;
    if (b === undefined || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((v, i) => sameStoredValue(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
        const ao = a as Record<string, unknown>;
        const bo = b as Record<string, unknown>;
        const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
        const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
        if (ak.length !== bk.length) return false;
        return ak.every((k) => k in bo && sameStoredValue(ao[k], bo[k]));
    }
    return false;
}
