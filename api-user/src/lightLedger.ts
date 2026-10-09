/**
 * 「行きたい場所」の鍵（`SPOT-<スラッグ>`）から、撮影スポットの**名前・座標・時刻帯**を引く。
 *
 * 写しは `scripts/gen-light-ledger.ts` が台帳（`content/spots.json`）から作る
 * （画面に出ているスポットだけ・約140KB）。
 *
 * **撮影地のスラッグ（接頭辞の無い鍵・`/location/<スラッグ>`）は引かない。** あちらは写真の
 * 自由入力から作った集約で、決まった座標を持たない（`lib/utils/savedSpotKey.ts`）。
 */
import LEDGER from "./data/lightLedger.json";

/**
 * 公式スポットの鍵の頭（`lib/utils/savedSpotKey.ts` の `SPOT_KEY_PREFIX`・`badges.ts` にも同じ値）。
 * `badges.ts` から import しない——あちらはメダルの写し（約170KB）を読み込むので、
 * この関数のバンドルに余計に乗る。値の一致は `lightParity.test.ts` が見る
 */
export const SPOT_KEY_PREFIX = "SPOT-";

export type LightSpot = {
    /** 「行きたい場所」に入っている鍵（`SPOT-<slug>`） */
    key: string;
    slug: string;
    name: string;
    /** 英語の名前。台帳に無ければ undefined */
    nameEn?: string;
    lat: number;
    lng: number;
    /** IANA の時刻帯（"Asia/Tokyo"） */
    timeZone: string;
};

type Ledger = { timeZones: string[]; spots: [string, string, string, number, number, number][] };
const L = LEDGER as unknown as Ledger;

const BY_SLUG = new Map(L.spots.map(([slug, name, nameEn, lat, lng, tz]) => [slug, { name, nameEn, lat, lng, tz }]));

/** 鍵からスポットを引く。公式スポットの鍵でない・写しに無いなら null */
export function lightSpotOf(key: string): LightSpot | null {
    if (typeof key !== "string" || !key.startsWith(SPOT_KEY_PREFIX)) return null;
    const slug = key.slice(SPOT_KEY_PREFIX.length);
    const row = BY_SLUG.get(slug);
    const timeZone = row ? L.timeZones[row.tz] : undefined;
    if (!row || !timeZone) return null;
    return { key, slug, name: row.name, ...(row.nameEn ? { nameEn: row.nameEn } : {}), lat: row.lat, lng: row.lng, timeZone };
}

/** 写しのスポット数（テストの自己確認用） */
export const LIGHT_LEDGER_SIZE = L.spots.length;
