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
});
