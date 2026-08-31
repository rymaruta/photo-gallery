import { describe, it, expect, afterEach } from "vitest";
import { photoTimeKey, compareNewest, compareOldest, sortByNewest } from "../photoOrder";
import type { Photo } from "../../data/photos";

// **同じ集合が、見る場所で違う順に出ていた。**
//
// 集約ページ（`/tag/…`）は並べ替えておらず入力配列の順（`createdAt` 降順）、
// ホームは `date || createdAt` 降順。実データ30枚のうち28枚が別の位置に来る。
// どちらも「新しい順」を名乗るので、利用者には「さっき上にあった写真が
// 下にある」としか見えない。並びの規則をここ1本にまとめた。

const photo = (id: string, o: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: { ja: id, en: id }, tags: [], ...o,
} as Photo);

const ids = (list: Photo[]) => list.map((p) => p.id);

afterEach(() => { delete process.env.TZ; });

describe("photoTimeKey", () => {
    it("撮影日（date）を優先し、無ければ投稿日（createdAt）", () => {
        expect(photoTimeKey(photo("a", { date: "2024-01-01", createdAt: "2026-01-01T00:00:00.000Z" })))
            .toBe("2024-01-01");
        expect(photoTimeKey(photo("c"))).toBe("");
    });

    // **保存されている date は1種類ではない。** `sanitizeDate` は日付だけと
    // ゾーン無し T 形式をそのまま保つが、それ以外は `toISOString()` で
    // `...Z` にする。旧実装が付けた `T00:00:00.000Z` も残っている。
    // 指定子を落として「書かれている数字」に揃える——表示側
    // （splitStoredDate）が指定子を無視して成分を出すので、並びと表示が一致する。
    it("末尾のゾーン指定子は落とす（書かれている数字で比べる）", () => {
        expect(photoTimeKey(photo("z", { date: "2024-11-01T00:00:00.000Z" }))).toBe("2024-11-01T00:00:00.000");
        expect(photoTimeKey(photo("o", { date: "2024-11-01T09:00:00+09:00" }))).toBe("2024-11-01T09:00:00");
        expect(photoTimeKey(photo("c", { createdAt: "2026-01-01T00:00:00.000Z" }))).toBe("2026-01-01T00:00:00.000");
    });

    it("`Z` 付きと壁時計が混ざっても、表示と同じ順に並ぶ", () => {
        // 表示（splitStoredDate）はどちらも「11月1日 00:00」「11月1日 07:30」
        const zForm = photo("zForm", { date: "2024-11-01T00:00:00.000Z" });
        const wall = photo("wall", { date: "2024-11-01T07:30:00" });
        expect(ids(sortByNewest([zForm, wall])), "表示と並びが食い違っている")
            .toEqual(["wall", "zForm"]);
    });
});

describe("並びの規則", () => {
    it("新しい順・古い順が互いに逆になる", () => {
        const list = [
            photo("old", { date: "2024-01-01" }),
            photo("new", { date: "2026-01-01" }),
            photo("mid", { date: "2025-01-01" }),
        ];
        expect(ids([...list].sort(compareNewest))).toEqual(["new", "mid", "old"]);
        expect(ids([...list].sort(compareOldest))).toEqual(["old", "mid", "new"]);
    });

    // **`Array#sort` の「安定」は入力順を保つという意味**で、入力順は
    // 面ごとに違う（集約ページは createdAt 降順、ホームは絞り込み後の順）。
    // 同じ日付の2枚は、それだけで面ごとに前後が入れ替わる。
    it("キーが同じなら、入力の順に関係なく同じ並びになる", () => {
        const a = photo("aaa", { date: "2026-04-29", createdAt: "2026-04-29T07:30:00.000Z" });
        const b = photo("bbb", { date: "2026-04-29", createdAt: "2026-04-29T13:25:00.000Z" });
        expect(ids(sortByNewest([a, b]))).toEqual(ids(sortByNewest([b, a])));
        expect(ids([...[a, b]].sort(compareOldest))).toEqual(ids([...[b, a]].sort(compareOldest)));
    });

    // **id だけで決めない。** UUID の大小は利用者から見て意味が無く、
    // 実データ30枚で唯一同キーになる組は、それだと投稿順の逆に並んでいた
    // （変更前のホームは安定ソートで投稿順を保っていた）。
    it("同じ撮影日なら、投稿が新しい方を先に出す", () => {
        const older = photo("zzz-posted-first", { date: "2026-04-29", createdAt: "2026-04-29T07:30:30.240Z" });
        const newer = photo("aaa-posted-later", { date: "2026-04-29", createdAt: "2026-04-29T13:25:07.841Z" });
        expect(ids(sortByNewest([older, newer])), "id の大小で並べている")
            .toEqual(["aaa-posted-later", "zzz-posted-first"]);
        // 古い順は鏡合わせ
        expect(ids([older, newer].sort(compareOldest))).toEqual(["zzz-posted-first", "aaa-posted-later"]);
    });

    it("撮影日も投稿日も同じなら id で決める（必ず決着する）", () => {
        const a = photo("aaa", { date: "2026-04-29", createdAt: "2026-04-29T07:30:00.000Z" });
        const b = photo("bbb", { date: "2026-04-29", createdAt: "2026-04-29T07:30:00.000Z" });
        expect(ids(sortByNewest([b, a]))).toEqual(["aaa", "bbb"]);
        expect(ids([b, a].sort(compareOldest))).toEqual(["aaa", "bbb"]);
    });

    it("元の配列を書き換えない", () => {
        const list = [photo("x", { date: "2024-01-01" }), photo("y", { date: "2026-01-01" })];
        sortByNewest(list);
        expect(ids(list)).toEqual(["x", "y"]);
    });

    // **`new Date()` を通さない。** ゾーンの無い `2024-11-01T07:30:00` は
    // ローカル時刻、日付だけの `2024-11-01` は UTC と解釈されるので、
    // 同じ配列の中で規則が混ざり、**並びが閲覧者のタイムゾーンで変わる**。
    // EXIF 由来の date（`exifWallClock`）はゾーン無しの T 形式で入る。
    it("タイムゾーンで並びが変わらない（EXIF 由来の時刻つき日付）", () => {
        const noon = photo("noon", { date: "2024-11-01T07:30:00" });
        const dayOnly = photo("dayOnly", { date: "2024-11-01" });

        const order: string[][] = [];
        for (const tz of ["Asia/Tokyo", "UTC", "America/New_York"]) {
            process.env.TZ = tz;
            order.push(ids(sortByNewest([dayOnly, noon])));
        }
        // 同じ日の 07:30 は、その日の 00:00 より新しい（どのタイムゾーンでも）
        expect(order, "閲覧者のタイムゾーンで並びが変わっている")
            .toEqual([["noon", "dayOnly"], ["noon", "dayOnly"], ["noon", "dayOnly"]]);
    });
});
