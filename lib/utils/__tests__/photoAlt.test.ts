import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { photoAltText } from "../photoAlt";
import type { Photo } from "../../data/photos";

/**
 * 写真の alt。**画像検索に出るかどうかは、ほぼここで決まる。**
 *
 * 撮影地を併記する形は `GalleryGrid`（一覧のサムネ）だけに入っていて、
 * **写真ページの本体画像・モーダル・OGP は素の題のまま**だった
 * ——画像検索が見て順位を付けるのは本体画像の方なので、
 * 効かせたい1枚にだけ効いていなかった。
 */
const photo = (over: Partial<Photo>): Photo => ({ id: "p1", src: "https://cdn/x.jpg", ...over } as Photo);

describe("photoAltText", () => {
    it("利用者が書いた alt があれば、そのまま使う", () => {
        expect(photoAltText(photo({ alt: "自分で書いた説明", title: "題", location: "パリ" }), "ja"))
            .toBe("自分で書いた説明");
    });

    it("alt が無ければ、題に撮影地を添える", () => {
        expect(photoAltText(photo({ title: "未完の大聖堂", location: "バルセロナ" }), "ja"))
            .toBe("未完の大聖堂（バルセロナ）");
    });

    // **重ねない。** 「山中湖の白鳥（山中湖）」を作らない
    it("題に既に地名が入っていれば添えない", () => {
        expect(photoAltText(photo({ title: "山中湖の白鳥", location: "山中湖" }), "ja"))
            .toBe("山中湖の白鳥");
    });

    it("撮影地が無ければ題だけ", () => {
        expect(photoAltText(photo({ title: "秋のグラデーション" }), "ja")).toBe("秋のグラデーション");
    });

    it("題が無ければ撮影地だけ", () => {
        expect(photoAltText(photo({ location: "高屋神社" }), "ja")).toBe("高屋神社");
    });

    it("どちらも無ければ空（意味の無い文字を置かない）", () => {
        expect(photoAltText(photo({}), "ja")).toBe("");
    });

    it("言語ごとの値を見る", () => {
        const p = photo({ title: { ja: "雲海の鳥居", en: "Torii above the clouds" }, location: "高屋神社" });
        expect(photoAltText(p, "ja")).toBe("雲海の鳥居（高屋神社）");
        expect(photoAltText(p, "en")).toBe("Torii above the clouds（高屋神社）");
    });

    it("撮影地の前後の空白は落とす", () => {
        expect(photoAltText(photo({ title: "朝", location: "  パリ  " }), "ja")).toBe("朝（パリ）");
    });

    // **「無題」は保存されている値**（サーバーが題の無い投稿に入れていた）。
    // 読み上げにも画像検索にも「無題」と言わせない
    it("保存されている「無題」は題として使わない", () => {
        expect(photoAltText(photo({ title: "無題", location: "高屋神社" }), "ja")).toBe("高屋神社");
        expect(photoAltText(photo({ title: { ja: "無題", en: "Untitled" } }), "ja")).toBe("");
        expect(photoAltText(photo({ title: { ja: "無題", en: "Untitled" } }), "en")).toBe("");
    });

    // 落としすぎない——人が書いた題は残す
    it("「無題の風景」は残す", () => {
        expect(photoAltText(photo({ title: "無題の風景", location: "パリ" }), "ja")).toBe("無題の風景（パリ）");
    });
});

// **配線を縛る。** 1本に切り出しても、呼んでいなければ元の木阿弥
// （この差分の発端が「1か所にしか入っていなかった」なので、
//  ここが緩いと同じことがまた起きる）
describe("alt を出す4か所すべてが、この1本を通る", () => {
    const sites = [
        ["app/photo/[id]/PhotoPageClient.tsx", "写真ページの本体画像（画像検索が見る1枚）"],
        ["app/components/GalleryModal/index.tsx", "拡大モーダル"],
        ["app/photo/[id]/page.tsx", "共有カード（OGP）"],
        ["app/components/GalleryGrid.tsx", "一覧のサムネ"],
    ] as const;

    it.each(sites)("%s（%s）", (file) => {
        const src = readFileSync(resolve(process.cwd(), file), "utf8");
        // 深さはファイルごとに違うので、相対の段数は見ない
        expect(src, `${file} が photoAltText を import していない`)
            .toMatch(/import \{ photoAltText \} from "[./]+lib\/utils\/photoAlt";/);
        expect(src, `${file} が photoAltText を呼んでいない`).toContain("photoAltText(");
    });

    // **素の組み立てが残っていないか。** 切り出したのに片方が古い形のままだと、
    // 同じ値を2か所で別々に決めることになる（この台帳が何度も踏んだ型）
    it.each(sites)("%s に古い組み立てが残っていない", (file) => {
        const src = readFileSync(resolve(process.cwd(), file), "utf8");
        expect(src, `${file} に getLocalized(...alt...) が残っている`)
            .not.toMatch(/getLocalized\(\s*(p|photo)\.alt/);
    });
});
