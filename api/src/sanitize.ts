// api/src/sanitize.ts
// 保存/更新時の入力サニタイズ。
//
// **api-user/src/sanitize.ts と対**。2つのパッケージは別々にデプロイされ、
// ビルドを共有しないので、小さく複製している（MIME 許可リストと同じ扱い）。
// 片方だけ直すと、同じ `PUT /photos/{id}` でも通るAPIによって
// 保存されるものが変わってしまう——実際にそうなっていた。
// 片方を直したらもう片方も直すこと。

import type { Photo } from "./types";

/**
 * 長さを切る。**サロゲートペアの途中では切らない。**
 *
 * `slice(0, max)` は UTF-16 のコードユニットで切るので、末尾が絵文字だと
 * その半分（上位サロゲート）だけが残る。UTF-8 に落とした時点で **U+FFFD
 * （`�`）** に確定するので、静的HTMLにもAPIの応答にも `あああ�` が出る。
 * 一度保存すると、本人が末尾を消すまで直らない（保存し直しても同じ位置で
 * 切られる）。
 *
 * さらに悪いことに、孤立サロゲートは `encodeURIComponent` が
 * `URIError: URI malformed` で投げる。タグや撮影地でそれが起きると、
 * 集約ページの `generateMetadata` が落ちて**静的ビルドが丸ごと止まる**
 * （`lib/utils/collections.ts` の `slugify` が `..` について書いている事故と
 * 同じ型）。
 *
 * **数えるのは今までどおりコードユニット。** 見た目の文字（書記素）で
 * 数え直すと、画面の `maxLength`（HTML はコードユニットで数える仕様）と
 * 食い違って「入力できるのに保存で切られる」が新しく生まれる。ここで直すのは
 * 「壊れた半分を残さない」ことだけ。ZWJ の家族（👨‍👩‍👧）や肌色つきが
 * 別の絵文字に化けるのは残る——文字としては壊れていないので、別の話として扱う。
 */
export function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const last = cut.charCodeAt(cut.length - 1);
    // 上位サロゲート（下位が続かないと壊れる）で終わっていたら1つ削る
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

// 撮影情報のサニタイズ: 既知のキーだけを通し、文字列は100文字に制限。
// GPS など想定外のフィールドは保存しない
export function sanitizeExif(exif: unknown): Photo["exif"] {
    if (!exif || typeof exif !== "object") return undefined;
    const src = exif as Record<string, unknown>;
    const out: Record<string, string | number> = {};
    for (const k of ["camera", "lens", "aperture", "exposure", "focalLength", "whiteBalance", "imageSize", "dateTimeOriginal"]) {
        const v = src[k];
        if (typeof v === "string" && v.trim()) out[k] = truncate(v.trim(), 100);
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
    return typeof v === "string" && v.trim() ? truncate(v.trim(), max) : undefined;
}

/**
 * 撮影日。ISO 文字列（または解釈可能な日付）を ISO に正規化する。
 * 未来すぎる / 古すぎる値は誤検出とみなして捨てる（EXIF が壊れている写真がある）。
 */
export function sanitizeDate(v: unknown): string | undefined {
    if (typeof v !== "string" || !v.trim()) return undefined;
    const s = v.trim();
    const t = Date.parse(s);
    if (Number.isNaN(t)) return undefined;
    const year = new Date(t).getUTCFullYear();
    // 写真が存在しうる範囲。カメラの日付未設定（1970/1980）や未来日を弾く
    if (year < 1990 || t > Date.now() + 24 * 60 * 60 * 1000) return undefined;
    // **日付だけの入力は日付のまま保つ。** toISOString に通すと
    // "2024-10-12" が "2024-10-12T00:00:00.000Z" になり、表示側の
    // 「時刻は書かれていれば出す」（photoDate.ts の splitStoredDate）が
    // 0時ちょうどという**存在しない時刻**を描いてしまう。
    // /user/edit の撮影日入力は日付だけを送ってくる。
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // **ゾーンを書いていない日時も、書かれたまま保つ。** 同じ理由。
    // EXIF の撮影日時にはゾーンが無く「その土地の壁時計」なので、
    // lib/utils/exif.ts は `2024-11-01T07:30:00` の形で送ってくる。
    // ここで toISOString に通すと、**この Lambda のゾーン**（既定 UTC）で
    // 解釈し直した値になる——環境に依存する保存はしない。
    // 表示側は保存されている数字をそのまま出す（photoDate.ts）。
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return s;
    return new Date(t).toISOString();
}

// タグ配列: 文字列のみ・trim・各50文字・重複排除・最大30件（空配列も返しうる＝全消し）
export function sanitizeTags(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const cleaned = v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => truncate(x.trim(), 50));
    return Array.from(new Set(cleaned)).slice(0, 30);
}

// タイトル: string か {ja,en}。空なら undefined
export function sanitizeTitle(v: unknown): Photo["title"] | undefined {
    if (typeof v === "string") return truncate(v.trim(), 200) || undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const ja = typeof o.ja === "string" ? truncate(o.ja.trim(), 200) : "";
        const en = typeof o.en === "string" ? truncate(o.en.trim(), 200) : "";
        if (ja || en) return { ...(ja ? { ja } : {}), ...(en ? { en } : {}) };
    }
    return undefined;
}

// 説明: string か {ja:[],en:[]}。空なら undefined
export function sanitizeDescription(v: unknown): Photo["description"] | undefined {
    if (typeof v === "string") return truncate(v.trim(), 2000) || undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const arr = (x: unknown): string[] | undefined => {
            if (!Array.isArray(x)) return undefined;
            const lines = x
                .filter((p): p is string => typeof p === "string")
                .map((p) => truncate(p.trim(), 2000))
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
 * だけを見ていたが、当時の /user/edit も /admin/edit も保存のたびに全項目を
 * 送っていたので、何も変えずに保存しただけで毎回ビルドを頼んでいた。
 * ビルドは1回8分で、Actions の枠は月2,000分しかない。
 *
 * **画面は今、変えた項目だけ送る**（7232340 / 9df0ec2）。それでもこの
 * 突き合わせは要る——`published` は両画面が毎回同梱するし、古いタブが
 * 読み込んだままの JS は今も全項目を送ってくる。送り手を信用しない。
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
