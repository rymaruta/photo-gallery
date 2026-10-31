// lib/utils/searchShelves.ts
//
// 「さがす」の「機材から探す」「色から探す」の棚（2026-10-31 束 1 S7・S8）。
// **iOS の `GearGroups`・`ColorFamilies`（origin/main 47440534）の写し。** 分け方・名前・数え方を同じにする
// （片方だけ直すと、同じ写真が Web とアプリで別の棚に並ぶ）。
import type { Photo } from "@/lib/data/photos";
import { slugify } from "./collections";

/** 並べ方（iOS の `GallerySort.popular`）: いいねの多い順、同じなら新しい順 */
function popular(photos: Photo[]): Photo[] {
    const t = (p: Photo) => Date.parse(String(p.date ?? p.createdAt ?? "")) || 0;
    return [...photos].sort((a, b) => ((Number(b.likes) || 0) - (Number(a.likes) || 0)) || (t(b) - t(a)));
}

// ── 機材 ───────────────────────────────────────────────

export type GearGroup = "wide" | "standard" | "telephoto";
export const GEAR_GROUPS: readonly GearGroup[] = ["wide", "standard", "telephoto"];

/**
 * 札の名前と範囲。**焦点距離は実焦点距離**（35mm 換算ではない）——スマホの「7mm」は広角に入る。
 * センサーの大きさを見ずに分けている限界は iOS と同じ（`GearGroups` の注記）。範囲は札に出して隠さない
 */
export const GEAR_TEXT: Record<GearGroup, { label: { ja: string; en: string }; range: { ja: string; en: string } }> = {
    wide: { label: { ja: "広角で撮る", en: "Wide" }, range: { ja: "〜35mm", en: "up to 35mm" } },
    standard: { label: { ja: "標準で撮る", en: "Standard" }, range: { ja: "36〜70mm", en: "36–70mm" } },
    telephoto: { label: { ja: "望遠で撮る", en: "Telephoto" }, range: { ja: "71mm〜", en: "71mm+" } },
};

/** 「35mm」「f=35 mm」から数を取り出す。読めなければ null（iOS の `millimeters`） */
export function focalMillimeters(text: unknown): number | null {
    if (typeof text !== "string") return null;
    const m = text.match(/[0-9.]+/);
    if (!m) return null;
    const v = Number(m[0]);
    return Number.isFinite(v) && v > 0 ? v : null;
}

export function gearGroupOf(photo: Pick<Photo, "exif">): GearGroup | null {
    const mm = focalMillimeters(photo.exif?.focalLength);
    if (mm === null) return null;
    if (mm <= 35) return "wide";
    if (mm <= 70) return "standard";
    return "telephoto";
}

/** 棚。**写真が1枚も無い群は出さない** */
export function gearShelves(photos: Photo[], limit = Infinity): { group: GearGroup; photos: Photo[] }[] {
    return GEAR_GROUPS
        .map((group) => ({ group, photos: popular(photos.filter((p) => gearGroupOf(p) === group)).slice(0, limit) }))
        .filter((s) => s.photos.length > 0);
}

// ── 色 ─────────────────────────────────────────────────

export type ColorFamily = "blue" | "green" | "orange" | "pink" | "white";
export const COLOR_FAMILIES: readonly ColorFamily[] = ["blue", "green", "orange", "pink", "white"];

/** 色味の名前と、丸の下に出す括弧の中（「空・海」） */
export const COLOR_TEXT: Record<ColorFamily, { label: { ja: string; en: string }; note: { ja: string; en: string } }> = {
    blue: { label: { ja: "青", en: "Blue" }, note: { ja: "空・海", en: "Sky & sea" } },
    green: { label: { ja: "緑", en: "Green" }, note: { ja: "森・自然", en: "Forest & nature" } },
    orange: { label: { ja: "オレンジ", en: "Orange" }, note: { ja: "夕日", en: "Sunset" } },
    pink: { label: { ja: "ピンク", en: "Pink" }, note: { ja: "桜・花", en: "Blossom" } },
    white: { label: { ja: "白", en: "White" }, note: { ja: "雪・冬景色", en: "Snow & winter" } },
};

/** `#rrggbb` の色味。**決められなければ null**（暗すぎる・彩度の低い暗い色は振らない）。iOS の `family(ofHex:)` */
export function colorFamilyOf(hex: unknown): ColorFamily | null {
    if (typeof hex !== "string") return null;
    const t = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(t)) return null;
    const v = parseInt(t, 16);
    const r = ((v >> 16) & 0xff) / 255, g = ((v >> 8) & 0xff) / 255, b = (v & 0xff) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (l < 0.12) return null;
    if (sat < 0.18) return l >= 0.62 ? "white" : null;
    let h: number;
    if (d === 0) h = 0;
    else if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (h >= 20 && h < 75) return "orange";
    if (h >= 75 && h < 170) return "green";
    if (h >= 170 && h < 265) return "blue";
    return "pink";
}

const OUTDOOR = new Set(["landscape", "nature", "architecture", "street"]);
const NATURAL = new Set(["landscape", "nature"]);

/**
 * その写真をこの色味の棚に入れてよいか（iOS の `allows`・2026-10-07 判断）。**棚は景色を約束している**
 * （白い器の料理を「雪・冬景色」に並べない）ので、外の景色の分類だけ。白は風景・自然だけ
 */
export function colorAllows(photo: Pick<Photo, "category">, family: ColorFamily): boolean {
    const raw = typeof photo.category === "string" ? photo.category.trim() : "";
    if (!raw) return false;
    const key = slugify(raw, "category");
    return family === "white" ? NATURAL.has(key) : OUTDOOR.has(key);
}

/** 棚。**1枚も無い色味は出さない** */
export function colorShelves(photos: Photo[], limit = Infinity): { family: ColorFamily; photos: Photo[]; count: number }[] {
    return COLOR_FAMILIES.map((family) => {
        const all = popular(photos.filter((p) => colorFamilyOf(p.dominantColor) === family && colorAllows(p, family)));
        return { family, photos: all.slice(0, limit), count: all.length };
    }).filter((s) => s.count > 0);
}
