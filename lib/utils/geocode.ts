// 場所名 → おおよその座標（ジオコーディング）。
// GPSなしで「パリ」「北海道」等の場所テキストだけ付いた写真を
// 足あとマップに出すために使う。OpenStreetMap の Nominatim（無料・CORS対応）。
//
// マナー: Nominatim は 1リクエスト/秒 の利用ポリシーがあるため、
// 逐次キュー + 最小間隔で叩き、結果は localStorage に30日キャッシュする。

export type GeoPoint = { lat: number; lng: number };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CACHE_KEY = "jp_geocache_v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let minIntervalMs = 1100;
/** テスト用: リクエスト間隔を変更する */
export function setGeocodeMinInterval(ms: number) {
    minIntervalMs = ms;
}

type CacheEntry = { v: GeoPoint | null; t: number };

function loadCache(): Record<string, CacheEntry> {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, CacheEntry>) : {};
    } catch {
        return {};
    }
}

function saveCache(c: Record<string, CacheEntry>) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch { /* 容量超過等は無視 */ }
}

/**
 * 検索語のバリエーション。フルネームでヒットしなければ順に試す。
 * 例: 「オペラ・ガルニエ（パリ）」→ ["オペラ・ガルニエ（パリ）", "オペラ・ガルニエ", "パリ"]
 *     「香川県 観音寺市 高屋神社」→ [full, "香川県 観音寺市", "香川県"]
 */
export function placeQueryVariants(name: string): string[] {
    const out: string[] = [];
    const push = (s: string) => {
        const t = s.trim();
        if (t && !out.includes(t)) out.push(t);
    };
    const base = name.trim();
    push(base);
    // 括弧を除いた本体と、括弧の中身
    const paren = base.match(/[（(]([^）)]+)[）)]/);
    push(base.replace(/[（(][^）)]*[）)]/g, " "));
    if (paren) push(paren[1]);
    // 区切りで分割して先頭2語 → 先頭1語 → 末尾1語
    const parts = base.replace(/[（()）]/g, " ").split(/[,、\s]+/).filter(Boolean);
    if (parts.length > 1) {
        push(parts.slice(0, 2).join(" "));
        push(parts[0]);
        push(parts[parts.length - 1]);
    }
    return out;
}

async function fetchGeocode(q: string): Promise<GeoPoint | null> {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = Array.isArray(arr) ? arr[0] : undefined;
    if (hit?.lat && hit?.lon) {
        const lat = Number(hit.lat);
        const lng = Number(hit.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    return null;
}

// レート制限つき逐次キュー
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/**
 * 場所名をおおよその座標に変換する。見つからなければ null。
 * 成否ともにキャッシュされる（ネットワークエラー時はキャッシュしない）。
 */
export async function geocodePlace(name: string): Promise<GeoPoint | null> {
    const key = name.trim().toLowerCase();
    if (!key) return null;

    const cache = loadCache();
    const hit = cache[key];
    if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.v;

    const run = async (): Promise<{ v: GeoPoint | null; cacheable: boolean }> => {
        let networkOk = false;
        for (const q of placeQueryVariants(name)) {
            const wait = lastRequestAt + minIntervalMs - Date.now();
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            lastRequestAt = Date.now();
            try {
                const p = await fetchGeocode(q);
                networkOk = true;
                if (p) return { v: p, cacheable: true };
            } catch {
                // ネットワークエラー: このバリエーションは諦めて次へ
            }
        }
        return { v: null, cacheable: networkOk };
    };

    const task = chain.then(run, run);
    chain = task;
    const { v, cacheable } = await task;
    if (cacheable) {
        const c = loadCache();
        c[key] = { v, t: Date.now() };
        saveCache(c);
    }
    return v;
}
