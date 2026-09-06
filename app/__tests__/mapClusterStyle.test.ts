import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// 束の数字（`.photo-map-cluster`）が円の左上に寄って欠けていた（Chromium で実測:
// 数字の箱が円の左端・上から2px に出る）。原因は **CSS の詳細度**——Leaflet の
// `.leaflet-marker-icon { display: block }` はクラス1つで、こちらも1つだと
// 読み込み順で負ける。ビルドの順序は Next のバンドルが決めるので、
// **順序に頼らない形（クラス2つ）**で書く必要がある。
// 実ブラウザでしか出ない壊れ方なので、ここでは書き方を固定する。
describe("撮影地マップの見た目（第三者CSSとの詳細度）", () => {
    const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf-8");

    it("Leaflet の display:block に順序で負けない書き方になっている", () => {
        expect(css, "`.photo-map-cluster` だけだと Leaflet と同じ強さで、順序次第で数字がずれる")
            .toContain(".photo-map-cluster.leaflet-marker-icon");
    });

    it("中央寄せの指定そのものがある", () => {
        const rule = css.slice(css.indexOf(".photo-map-cluster.leaflet-marker-icon"));
        const body = rule.slice(rule.indexOf("{"), rule.indexOf("}"));
        expect(body).toContain("display: flex");
        expect(body).toContain("align-items: center");
        expect(body).toContain("justify-content: center");
    });

    // 地図の下地も第三者CSSに負けていた。`bg-white/5` は `@layer utilities` の
    // 中にあるので、レイヤーの外にある Leaflet の
    // `.leaflet-container { background: #ddd }` に**詳細度に関係なく**負ける
    // （実測 rgb(221,221,221)＝真っ黒な画面に明るい灰色の板）。
    // こちらの規則はレイヤーの外なので詳細度で決まるが、クラス1つでは
    // 後から読まれる leaflet.css に負けるため2クラスで書く。
    it("地図の下地も、順序で負けない書き方になっている", () => {
        expect(css).toContain(".photo-map-shell.leaflet-container");
        const rule = css.slice(css.indexOf(".photo-map-shell.leaflet-container"));
        expect(rule.slice(rule.indexOf("{"), rule.indexOf("}"))).toContain("background");
    });

    // ポップアップのサムネ。Tailwind の preflight（`@layer base` の
    // `img { max-width: 100% }`）を打ち消さないと、Leaflet の幅の計算で
    // サムネの幅寄与が 0 になり、ポップアップが最小幅まで潰れる
    // （実測: 160px 指定のサムネが 96px で描かれた）
    it("ポップアップのサムネが preflight に潰されない", () => {
        expect(css).toContain(".photo-map-card img");
        const rule = css.slice(css.indexOf(".photo-map-card img"));
        expect(rule.slice(rule.indexOf("{"), rule.indexOf("}"))).toContain("max-width: none");
    });

    // 同じ升の写真は横に送る（縦積みは枚数ぶん伸びて地図の外へ出た）
    it("束のポップアップが横並びで、送れるようになっている", () => {
        const rule = css.slice(css.indexOf(".photo-map-list {"));
        const body = rule.slice(rule.indexOf("{"), rule.indexOf("}"));
        expect(body).toContain("display: flex");
        expect(body).toContain("overflow-x: auto");
        // 1枚ずつ止まる（半端な位置で止めない）
        expect(body).toContain("scroll-snap-type: x mandatory");
        // 端で地図やページを巻き込まない
        expect(body).toContain("overscroll-behavior-x: contain");
    });

    // 題名は利用者の入力。折り返せない長い語でカードが広がると、1枚を見るのに
    // 何画面ぶんも送ることになる（実測: 60文字の英語1語で 531px＝枠の2.6倍）
    it("長い題名でカードが広がらない", () => {
        const rule = css.slice(css.indexOf(".photo-map-list > .photo-map-card"));
        expect(rule.slice(rule.indexOf("{"), rule.indexOf("}")), "フレックス項目の既定 min-width: auto で広がる")
            .toContain("min-width: 0");
        expect(css).toContain(".photo-map-card a");
        const wrap = css.slice(css.indexOf(".photo-map-card a"));
        expect(wrap.slice(wrap.indexOf("{"), wrap.indexOf("}"))).toContain("overflow-wrap: anywhere");
    });
});
