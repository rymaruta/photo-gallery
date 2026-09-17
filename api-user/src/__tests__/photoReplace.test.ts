import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPLACE_CLEARS, REPLACE_SETS, replaceRefusal, buildReplace } from "../photoReplace";

const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const CDN = "https://d15fn3rcaiymu9.cloudfront.net";
const url = (u: string, p: string) => `${CDN}/uploads/${u}/${p}`;

// 「自分のアップロード領域か」の判定は `CLOUDFRONT_URL` を土台にする。
// **後始末をする**——api-user のテストは module スコープで stub して戻して
// いないものが多く、順番に依存する形になっている（台帳の記録）。
beforeEach(() => { vi.stubEnv("CLOUDFRONT_URL", CDN); });
afterEach(() => { vi.unstubAllEnvs(); });

/**
 * 🔴 **この差分でいちばん危ないのは「派生を残したまま `src` だけ替える」こと。**
 *
 * `srcAvif` を残すと **AVIF を出す端末にだけ古い写真が出続ける**
 * ——端末によって見える写真が違う、という気づきにくい壊れ方。
 *
 * ビルド（`scripts/generate-thumbnails.js`）は「空なら埋める」で動くので、
 * **消せば必ず作り直される**。だから守るべきは1つ:
 * **ビルドが埋める項目が、消す側か送る側のどちらかに必ず入っていること。**
 *
 * 綴りで突き合わせるのではなく、**ビルドのソースから一覧を読む**
 * ——片方だけ増えると静かにずれる（このリポジトリが何度も踏んだ型）。
 */
describe("ビルドが作る派生と、差し替えが消す項目がずれない", () => {
    const src = readFileSync(join(__dirname, "../../../scripts/generate-thumbnails.js"), "utf8");

    /** `const NAME = ["a", "b"];` を読む */
    const listOf = (name: string): string[] => {
        const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
        if (!m) throw new Error(`${name} を generate-thumbnails.js から読めない（名前が変わった？）`);
        return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };

    it("読み取り自体が効いている（空振りで通らない）", () => {
        expect(listOf("META_FIELDS").length, "META_FIELDS を読めていない").toBeGreaterThan(3);
        expect(listOf("DERIVATIVE_FIELDS").length, "DERIVATIVE_FIELDS を読めていない").toBeGreaterThan(2);
        expect(() => listOf("NO_SUCH_LIST")).toThrow();
    });

    it("ビルドが埋める項目は、消すか送るかのどちらかに入っている", () => {
        const covered = new Set<string>([...REPLACE_CLEARS, ...REPLACE_SETS]);
        // `needsThumb` が見るのは thumbSrc（一覧には入っていないので名指しで足す）
        const filled = [...listOf("META_FIELDS"), ...listOf("DERIVATIVE_FIELDS"), "thumbSrc"];
        for (const f of filled) {
            expect(covered.has(f), `ビルドが埋める「${f}」を差し替えが扱っていない（古い写真の値が残る）`).toBe(true);
        }
    });

    it("AVIF の派生は必ず消す側（送る側にあってはいけない）", () => {
        // 画面は AVIF を作らない。送る側に入れると「作ったつもりで空」になる
        for (const f of ["srcAvif", "thumbAvif", "thumbSmAvif"]) {
            expect(REPLACE_CLEARS as readonly string[]).toContain(f);
            expect(REPLACE_SETS as readonly string[]).not.toContain(f);
        }
    });
});

describe("受け取ってよい差し替えか（判定は savePhoto と同じ）", () => {
    it("自分のアップロード領域なら通す", () => {
        expect(replaceRefusal({ key: `uploads/${UID}/a.webp`, publicUrl: url(UID, "a.webp") }, UID)).toBeNull();
    });

    it("他人の領域は断る（消すと相手の実体が S3 から消える）", () => {
        expect(replaceRefusal({ key: `uploads/${OTHER}/a.webp`, publicUrl: url(OTHER, "a.webp") }, UID)).not.toBeNull();
        // URL だけ他人、キーは自分（片方しか見ていないと通る）
        expect(replaceRefusal({ key: `uploads/${UID}/a.webp`, publicUrl: url(OTHER, "a.webp") }, UID)).not.toBeNull();
        // キーだけ他人、URL は自分
        expect(replaceRefusal({ key: `uploads/${OTHER}/a.webp`, publicUrl: url(UID, "a.webp") }, UID)).not.toBeNull();
    });

    it("`..` で領域の外へ出る鍵は断る", () => {
        expect(replaceRefusal({ key: `uploads/${UID}/../${OTHER}/a.webp`, publicUrl: url(UID, "a.webp") }, UID)).not.toBeNull();
    });

    it("鍵もURLも無ければ断る", () => {
        expect(replaceRefusal({}, UID)).not.toBeNull();
        expect(replaceRefusal({ key: "", publicUrl: "" }, UID)).not.toBeNull();
        expect(replaceRefusal({ key: 1 as unknown, publicUrl: url(UID, "a.webp") }, UID)).not.toBeNull();
    });
});

describe("差し替えで書く値と消す項目", () => {
    const ok = { key: `uploads/${UID}/new.webp`, publicUrl: url(UID, "new.webp") };

    it("src は検証したときの形で保存する", () => {
        const { sets } = buildReplace(ok, UID, CDN);
        expect(sets.src).toBe(url(UID, "new.webp"));
    });

    it("派生は必ず消す（古い写真が AVIF の端末に出続けない）", () => {
        const { clears } = buildReplace(ok, UID, CDN);
        for (const f of ["srcAvif", "thumbAvif", "thumbSmAvif", "thumbSm", "width", "height", "aspectRatio"]) {
            expect(clears, `${f} が残っている`).toContain(f);
        }
    });

    it("送らなかった項目も消す（ビルドの「空なら埋める」に拾わせる）", () => {
        const { sets, clears } = buildReplace(ok, UID, CDN);
        expect(sets.thumbSrc, "送っていないのに書いている").toBeUndefined();
        expect(clears, "古いサムネが残る").toContain("thumbSrc");
        expect(clears).toContain("dominantColor");
        expect(clears).toContain("blurDataURL");
    });

    it("送った項目は消さない（消す側と書く側で取り合わない）", () => {
        const { sets, clears } = buildReplace({
            ...ok,
            thumbUrl: url(UID, "new_thumb.webp"),
            dominantColor: "#AABBCC",
            blurDataURL: "data:image/webp;base64,UklGRg==",
        }, UID, CDN);
        expect(sets.thumbSrc).toBe(url(UID, "new_thumb.webp"));
        expect(sets.dominantColor, "大文字のまま保存している").toBe("#aabbcc");
        expect(sets.blurDataURL).toContain("data:image/webp;base64,");
        for (const f of ["thumbSrc", "dominantColor", "blurDataURL"]) {
            expect(clears, `${f} を書いたうえで消している（消える）`).not.toContain(f);
        }
    });

    it("外部のサムネURLは受け取らない（見た人全員の IP が相手に渡る）", () => {
        const { sets, clears } = buildReplace({ ...ok, thumbUrl: "https://evil.example/t.webp" }, UID, CDN);
        expect(sets.thumbSrc).toBeUndefined();
        expect(clears).toContain("thumbSrc");
    });

    /** この機能の目的そのもの */
    it("EXIF・撮影日・座標は新しい写真の値で置き換える", () => {
        const { sets } = buildReplace({
            ...ok,
            exif: { camera: "SONY ILCE-7M4", iso: 400 },
            date: "2024-11-01",
            coords: { lat: 35.6, lng: 139.7 },
        }, UID, CDN);
        expect((sets.exif as Record<string, unknown>).camera).toBe("SONY ILCE-7M4");
        expect(sets.date).toBe("2024-11-01");
        expect(sets.coords).toBeTruthy();
    });

    it("読めなかった EXIF では触らない（古い値を消すための操作ではない）", () => {
        const { sets, clears } = buildReplace(ok, UID, CDN);
        expect("exif" in sets, "読めていないのに上書きしている").toBe(false);
        expect("date" in sets).toBe(false);
        expect(clears, "EXIF を消している").not.toContain("exif");
        expect(clears, "撮影日を消している").not.toContain("date");
    });
});
