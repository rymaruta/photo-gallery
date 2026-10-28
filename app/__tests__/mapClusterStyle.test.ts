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
    const body = (selector: string) => {
        const at = css.indexOf(selector);
        expect(at, `${selector} の規則が無い`).toBeGreaterThan(-1);
        return css.slice(css.indexOf("{", at), css.indexOf("}", at));
    };

    // Leaflet の `.leaflet-container .leaflet-marker-pane img`（詳細度 0,2,1）が `width: auto` を
    // 当てる。負けると、読み込み前は幅0・読み込み後は元画像の 256px になり、ピンが地図いっぱいに広がる
    it("ピンの写真は Leaflet の width:auto に詳細度で勝つ書き方で、px の大きさを持つ", () => {
        const b = body(".photo-map-shell .leaflet-marker-pane .photo-map-pin__img");
        expect(b).toContain("width: 40px");
        expect(b).toContain("max-width: none");
        expect(body(".photo-map-shell .leaflet-marker-pane .spot-map-pin__img")).toContain("width: 40px");
    });

    // `L.divIcon` の箱に白い四角（leaflet-div-icon の既定）や切り抜きが出ると、
    // 名前と枚数のバッジ（箱の外へはみ出して描く）が欠ける
    it("印の箱ははみ出しを切らない（名前とバッジは箱の外に描く）", () => {
        expect(body(".photo-map-pin-icon.leaflet-marker-icon")).toContain("overflow: visible");
    });

    // 地図の下地も第三者CSSに負けていた。`bg-white/5` は `@layer utilities` の
    // 中にあるので、レイヤーの外にある Leaflet の
    // `.leaflet-container { background: #ddd }` に**詳細度に関係なく**負ける
    // （実測 rgb(221,221,221)＝真っ黒な画面に明るい灰色の板）。
    // こちらの規則はレイヤーの外なので詳細度で決まるが、クラス1つでは
    // 後から読まれる leaflet.css に負けるため2クラスで書く。
    it("地図の下地も、順序で負けない書き方になっている", () => {
        expect(body(".photo-map-shell.leaflet-container")).toContain("background");
    });

    // Apple のマップでは、印の箱（`.jp-map-marker`）と印の見た目のクラスが同じ要素に付く。
    // 箱の側で `display` を書くと、どちらが勝つかが読み込み順で決まる
    it("Apple のマップの印の箱は display を書かない", () => {
        expect(body(".jp-map-marker {")).not.toMatch(/display\s*:/);
    });

    // CLAUDE.md の owner の好み（iOS の CountBadge と同じ）
    it("枚数のバッジは真鍮の塗り・墨の数字・黒 2px の縁・12px", () => {
        const b = body(".map-count-badge {");
        expect(b).toContain("background: #c9a66b");
        expect(b).toContain("color: #07090a");
        expect(b).toContain("0 0 0 2px #000");
        expect(b).toContain("12px");
    });
});
