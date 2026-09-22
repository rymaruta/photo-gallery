import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VIEWER_KEPT_FIELDS, slimForViewer, slimForGrid } from "../related";
import type { Photo } from "../../data/photos";

const MODAL_DIR = join(__dirname, "..", "..", "..", "app", "components", "GalleryModal");

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * 🔴 **その場で拡大する画面に渡す写真から、項目が落ちていないこと。**
 *
 * 絞った写真をビューアに渡すと、説明文も撮影情報も投稿者も**黙って空**に
 * なる。例外にならないので、単体テストも実ブラウザのスモークも素通りする
 * ——実際、撮影スポット詳細で起きていた（2026-09-22 のレビューで発覚）。
 * **「落ちないバグ」は、こういう突き合わせでしか捕まらない。**
 *
 * だから `GalleryModal` の**ソースを読んで**、触っている `photo.X` が
 * 全部 `slimForViewer` の中に在るかを見る。ビューアが新しい項目を読み
 * 始めた日に、ここが落ちて教える。
 */
describe("ビューアに渡す写真の項目", () => {
    const files = readdirSync(MODAL_DIR).filter((f) => f.endsWith(".tsx") && !f.includes("__"));

    /**
     * ビューアのソースが触っている写真の項目。
     *
     * `photo?.x` / `p.x` / `current.x` を拾う。**`?.` も見る**
     * ——最初 `\.` だけで数えて `p?.likes` を取りこぼした（実測）。
     */
    const readFields = (): Set<string> => {
        const out = new Set<string>();
        for (const f of files) {
            const src = stripComments(readFileSync(join(MODAL_DIR, f), "utf8"));
            for (const m of src.matchAll(/\b(?:photo|p|current)\??\.([a-zA-Z]+)/g)) out.add(m[1]);
        }
        return out;
    };

    /**
     * 写真の項目ではないもの（同じ綴りで別物）。**理由を書けるものだけ**。
     * 書けないものが出たら、それは本当に落ちている項目。
     */
    const NOT_PHOTO_FIELDS = new Set([
        "length",   // 配列の長さ（photos.length）
        "current",  // ref の中身（xxxRef.current）
        "map", "filter", "slice", "find", "findIndex", "includes", "indexOf", "join", "some", "every",
        "preventDefault", "stopPropagation", "key", "target", "clientX", "clientY", "button",
        "metaKey", "ctrlKey", "shiftKey", "altKey", "focus", "blur", "contains", "querySelector",
        "style", "classList", "dataset", "value", "name", "ok", "message", "requiresAuth", "then",
        "catch",
        // ⚠️ **`id` は入れない。** 本物の項目なので、落ちたら落ちてほしい
    ]);

    it("見張る対象のファイルが実在する（空回りしていない）", () => {
        expect(files.length, "GalleryModal の tsx が見つからない").toBeGreaterThan(0);
        expect(readFields().size, "項目を1つも拾えていない").toBeGreaterThan(5);
    });

    it("ビューアが読む項目は、全部 slimForViewer に入っている", () => {
        const kept = new Set(VIEWER_KEPT_FIELDS);
        const missing = [...readFields()]
            .filter((k) => !NOT_PHOTO_FIELDS.has(k) && !kept.has(k))
            .sort();
        expect(missing, `ビューアが読むのに渡していない項目: ${missing.join(", ")}`).toEqual([]);
    });

    // **格子の絞りでは足りないことを、数で固定する。**
    // 「`slimForViewer` を `slimForGrid` に戻す」変異が素通りしないように
    it("slimForViewer は slimForGrid より多くの項目を残す", () => {
        const photo = {
            id: "a", title: "t", src: "s", description: "d", exif: { camera: "c" },
            userId: "u", displayName: "n", song: { title: "s" }, commentCount: 3,
            likes: 2, coords: { lat: 1, lng: 2 }, geoApprox: true, srcAvif: "a.avif",
        } as unknown as Photo;
        const grid = Object.keys(slimForGrid(photo));
        const viewer = Object.keys(slimForViewer(photo));
        expect(viewer.length).toBeGreaterThan(grid.length);
        for (const k of ["description", "exif", "userId", "song", "commentCount", "likes", "srcAvif"]) {
            expect(viewer, `${k} が落ちている`).toContain(k);
            expect(grid, `${k} は格子の絞りには入らないはず`).not.toContain(k);
        }
    });
});
