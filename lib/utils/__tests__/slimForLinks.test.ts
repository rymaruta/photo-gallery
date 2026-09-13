import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slimForLinks, initialRelatedFor, slimForGrid } from "../related";
import type { Photo } from "../../data/photos";

/**
 * **写真ページの RSC ペイロードに、読まれない項目が載っていた。**
 *
 * `app/photo/[id]/page.tsx` は回遊リンク（同じ投稿者・同じ場所・前後）を
 * ビルド時に計算して props に渡す——**写真オブジェクト最大18個**が、
 * 説明も EXIF もタグも付いたまま全写真ページの HTML に埋め込まれる。
 * 写真ページは索引に載るページの約6割＝検索から人が着地する側。
 *
 * ここで守るのは2つ:
 *   1. **画面が読む項目を落とさない**（落とすとサムネや題が消える）
 *   2. **読まない項目を載せない**（載せると元の木阿弥）
 */
const FULL = {
    id: "p1", title: { ja: "題", en: "T" }, dominantColor: "#123456",
    src: "https://cdn/a.jpg", thumbSrc: "https://cdn/a-512.webp", thumbSm: "https://cdn/a-256.webp",
    thumbAvif: "https://cdn/a-512.avif", thumbSmAvif: "https://cdn/a-256.avif",
    blurDataURL: "data:image/webp;base64,zz",
    // グリッドが読む（切り抜きの中心・alt の材料）。**フィクスチャに無いと、
    // `pick` が undefined を飛ばすので「落としている」に見える**——
    // 実際そう出て、この2つを足した（テストが仕掛けの穴を捕まえた側）
    focalPoint: { x: 0.5, y: 0.3 }, alt: { ja: "代替テキスト" },
    // ここから下は回遊リンクが読まない
    description: { ja: ["長い説明".repeat(20)] }, exif: { camera: "SONY ILCE-7M3", lens: "FE 24-70" },
    tags: ["雲海", "神社"], category: "landscape", location: "高屋神社",
    userId: "u1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
    likes: 3, commentCount: 2, published: true, width: 4000, height: 3000,
} as unknown as Photo;

describe("回遊リンクに渡す写真を絞る", () => {
    // **画面が読む項目**（`RelatedPhotos` と `Thumb` と前後のリンク）
    it("画面が読む項目は全部残る", () => {
        const out = slimForLinks(FULL) as unknown as Record<string, unknown>;
        for (const k of ["id", "title", "dominantColor",
            "src", "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif", "blurDataURL"]) {
            expect(out[k], `${k} が落ちている（サムネか題が消える）`)
                .toEqual((FULL as unknown as Record<string, unknown>)[k]);
        }
    });

    it("読まない項目は落とす", () => {
        const out = slimForLinks(FULL) as unknown as Record<string, unknown>;
        for (const k of ["description", "exif", "tags", "category", "location",
            "userId", "createdAt", "updatedAt", "likes", "commentCount", "width", "height"]) {
            expect(k in out, `${k} が残っている（HTML に載り続ける）`).toBe(false);
        }
    });

    // **無い項目を `undefined` で埋めない**（そのぶん JSON が増える）
    it("持っていない項目は生やさない", () => {
        expect(Object.keys(slimForLinks({ id: "x", src: "s" } as unknown as Photo)).sort())
            .toEqual(["id", "src"]);
    });

    // **残す側を並べていること**（消す側の一覧にすると、新しい項目が
    // 増えた日に黙って載る。台帳の型: `PRIVATE_FIELDS` で一度踏んだ）
    it("残す項目を並べている（消す項目の一覧ではない）", () => {
        const src = readFileSync(join(__dirname, "..", "related.ts"), "utf8");
        expect(src).toContain("THUMB_FIELDS");
        expect(src).toContain("LINK_FIELDS");
        // 知らない項目は落ちる側に倒れる
        const out = slimForLinks({ id: "x", src: "s", brandNewField: "v" } as unknown as Photo);
        expect("brandNewField" in out, "知らない項目が通り抜ける").toBe(false);
    });

    // **`Thumb` が実際に読む項目と突き合わせる。** 手で並べた一覧は
    // 片方だけ増えた日に静かにずれる（台帳の型2）
    it("Thumb が読む項目を、1つも落としていない", () => {
        const thumb = readFileSync(join(__dirname, "..", "..", "..", "app", "components", "Thumb.tsx"), "utf8");
        // **コメントを先に落とす。** 理由を書くほど、綴りで見る判定は自分の
        // 説明に当たる（実際、コメントに書いた `journey-photo.com` が
        // `photo.com` として「Thumb が読む項目 `com`」に化けた）
        const code = thumb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
        const used = [...code.matchAll(/photo\.([a-zA-Z]+)/g)].map((m) => m[1]);
        expect(used.length, "Thumb.tsx から項目を1つも読めていない").toBeGreaterThan(3);
        const kept = Object.keys(slimForLinks(FULL));
        for (const k of new Set(used)) {
            expect(kept, `Thumb が読む ${k} を落としている`).toContain(k);
        }
    });
});

/**
 * **配線は「呼んでいるか」ではなく「出たもの」で見る。**
 * ページ（サーバーコンポーネント）の中で `map(slimForLinks)` と書いて
 * いると、1つ消してもテストから触れない。組み立てを純関数にした。
 */
describe("写真ページに渡す回遊リンク（組み立て）", () => {
    const P = (o: Partial<Photo>): Photo => ({
        src: "https://cdn/x.jpg", description: { ja: ["説明"] }, exif: { camera: "X" },
        tags: ["t"], userId: "u1", ...o,
    } as unknown as Photo);
    const all = [
        P({ id: "a", userId: "u1", location: "パリ", createdAt: "2026-03-03T00:00:00Z" }),
        P({ id: "b", userId: "u1", location: "パリ", createdAt: "2026-02-02T00:00:00Z" }),
        P({ id: "c", userId: "u2", location: "パリ", createdAt: "2026-01-01T00:00:00Z" }),
    ];

    it("4つの入れ物すべてが絞られている", () => {
        const out = initialRelatedFor(all[1], all);
        const every = [...out.author, ...out.location, out.prev, out.next].filter(Boolean) as Photo[];
        expect(every.length, "1つも入っていない（この確認が空回りしている）").toBeGreaterThan(2);
        for (const p of every) {
            expect("description" in (p as object), "説明が残っている").toBe(false);
            expect("exif" in (p as object), "EXIF が残っている").toBe(false);
            expect(p.id, "id が落ちている（リンクが作れない）").toBeTruthy();
        }
    });

    it("前後のリンクも絞る", () => {
        const out = initialRelatedFor(all[1], all);
        expect(out.prev?.id, "前の写真が出ていない").toBe("a");
        expect(out.next?.id, "次の写真が出ていない").toBe("c");
        expect("tags" in (out.prev as object), "前の写真にタグが残っている").toBe(false);
    });

    it("端の写真では prev / next が null（生やさない）", () => {
        expect(initialRelatedFor(all[0], all).prev).toBeNull();
        expect(initialRelatedFor(all[2], all).next).toBeNull();
    });
});

/**
 * **集約ページのグリッドも同じ形だった。**
 * `/tag/*` `/location/*` `/category/*` `/camera/*` ＝約86ページが、
 * 写真オブジェクトを丸ごと props に渡していた（実測
 * `/category/landscape` で description 19回・exif 15回）。
 */
describe("集約ページのグリッドに渡す写真を絞る", () => {
    it("グリッドが読む項目は全部残る", () => {
        const out = slimForGrid(FULL) as unknown as Record<string, unknown>;
        for (const k of ["id", "title", "dominantColor",
            "src", "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif", "blurDataURL",
            // グリッド固有（切り抜きの中心・分類名・alt の材料）
            "focalPoint", "category", "alt", "location"]) {
            expect(out[k], `${k} が落ちている`).toEqual((FULL as unknown as Record<string, unknown>)[k]);
        }
    });

    it("読まない項目は落とす", () => {
        const out = slimForGrid(FULL) as unknown as Record<string, unknown>;
        for (const k of ["description", "exif", "tags", "userId", "createdAt", "likes", "commentCount"]) {
            expect(k in out, `${k} が残っている`).toBe(false);
        }
    });

    // **回遊リンク用より広い**（グリッドは切り抜きと分類名と alt を出す）
    it("回遊リンク用より項目が多い（用途ごとに分けている）", () => {
        expect(Object.keys(slimForGrid(FULL)).length)
            .toBeGreaterThan(Object.keys(slimForLinks(FULL)).length);
    });

    // **`GalleryGrid` と `photoAltText` が実際に読む項目と突き合わせる**
    it("GalleryGrid / photoAltText が読む項目を、1つも落としていない", () => {
        const grid = readFileSync(join(__dirname, "..", "..", "..", "app", "components", "GalleryGrid.tsx"), "utf8");
        const alt = readFileSync(join(__dirname, "..", "photoAlt.ts"), "utf8");
        const used = [
            ...[...grid.matchAll(/\b[p]\.([a-zA-Z]+)/g)].map((m) => m[1]),
            ...[...grid.matchAll(/\bphoto\.([a-zA-Z]+)/g)].map((m) => m[1]),
            ...[...alt.matchAll(/\bphoto\.([a-zA-Z]+)/g)].map((m) => m[1]),
        ];
        expect(used.length, "ソースから項目を1つも読めていない").toBeGreaterThan(4);
        const kept = Object.keys(slimForGrid(FULL));
        for (const k of new Set(used)) {
            expect(kept, `画面が読む ${k} を落としている`).toContain(k);
        }
    });
});
