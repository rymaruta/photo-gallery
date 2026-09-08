import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// **サーバーの許可リストは「これから保存する値」にしか効かない。**
// 許可リストを入れる前に保存された行（曲の音源・アートワーク・リンク）は
// 任意のホストのまま残りうる（本番を読めないので実態は未確認）。
// 画面はそれを `<audio src>` `<img src>` `<a href>` で読み込むので、
// 開いた人の IP・User-Agent・時刻が外部へ渡る。**出すときにも確かめる。**
//
// **入口（`sanitizeProfile`）ではなく画面側で確かめる。** 入口で落とすと、
// プロフィール編集画面が「利用者が消した」と読んで**保存の差分に載せる**
// ——古い曲の情報を勝手に書き換えることになる（実際それで既存テストが
// 3本落ちた。`fab56fad` の訂正）。

vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));

// jsdom は `HTMLMediaElement.play()` を実装していない（undefined が返る）
beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true, writable: true, value: () => Promise.resolve(),
    });
});

const APPLE = {
    title: "曲", artist: "歌手",
    artwork: "https://is1-ssl.mzstatic.com/a.jpg",
    previewUrl: "https://audio-ssl.itunes.apple.com/p.m4a",
    trackUrl: "https://music.apple.com/jp/album/1",
};
const EVIL = {
    title: "曲", artist: "歌手",
    artwork: "https://evil.example/a.jpg",
    previewUrl: "https://evil.example/p.m4a",
    trackUrl: "https://evil.example/s",
};

const { MusicProvider } = await import("../../music/MusicContext");
const MusicCard = (await import("../MusicCard")).default;

const renderCard = (song: typeof APPLE) => render(
    <MusicProvider>
        <MusicCard songs={[song]} queueKey="q" label="BGM" locale="ja" />
    </MusicProvider>,
);

describe("曲の URL は出すときにも確かめる", () => {
    it("許可していないホストのアートワークは読み込まない", () => {
        renderCard(EVIL);
        const img = document.querySelector("img");
        expect(img?.getAttribute("src") ?? "", "外部の画像を読み込んでいる").not.toContain("evil.example");
    });

    it("許可していないホストのリンクは踏ませない", () => {
        renderCard(EVIL);
        const a = Array.from(document.querySelectorAll("a")).find((x) => x.textContent?.includes("曲"));
        expect(a?.getAttribute("href") ?? "", "外部へのリンクを出している").not.toContain("evil.example");
    });

    // 正常系: Apple のホストはそのまま出す（塞ぎすぎない）
    it("Apple のホストはそのまま出す", () => {
        renderCard(APPLE);
        expect(document.querySelector("img")?.getAttribute("src")).toBe(APPLE.artwork);
        const a = Array.from(document.querySelectorAll("a")).find((x) => x.textContent?.includes("曲"));
        expect(a?.getAttribute("href")).toBe(APPLE.trackUrl);
    });
});

// `<audio>` はこのサイトに1つだけ（`MusicContext`）。プロフィール・
// 写真BGM・ストーリーの全部がここを通る
// **「唯一の `<audio>`」ではない。** ストーリーは自前の
// `<audio preload="auto">` を持つ（`StoryViewer`）。ここが受け持つのは
// プロフィールの曲と写真BGM——最初この前提を `grep` せずに書いて、
// **自分のコメントが最悪ケースと名指しした経路（ストーリー）を
// 塞がないまま「全部ここを通る」と書いた**
describe("プロフィール・写真BGM の音源（MusicContext の <audio>）", () => {
    it("許可していないホストの音源は読み込まない", async () => {
        const { useMusic } = await import("../../music/MusicContext");
        // **1回だけ鳴らす。** `music` は再生のたびに新しくなるので、
        // 依存に入れると鳴らし直しの無限ループになる（実際に踏んだ）
        function Play({ song }: { song: typeof APPLE }) {
            const music = useMusic();
            const done = React.useRef(false);
            React.useEffect(() => {
                if (done.current) return;
                done.current = true;
                music.play("q", [song], 0, "BGM");
            }, [music, song]);
            return null;
        }
        render(<MusicProvider><Play song={EVIL} /></MusicProvider>);
        const audio = document.querySelector("audio");
        // **`src=""` では駄目。** 空の src は「現在のページを取り直す」
        // ので、属性そのものが無いことを見る
        expect(audio?.hasAttribute("src"), "空の src を残している（現在のページを取り直す）").toBe(false);
    });

    it("Apple のホストの音源は読み込む", async () => {
        const { useMusic } = await import("../../music/MusicContext");
        // **1回だけ鳴らす。** `music` は再生のたびに新しくなるので、
        // 依存に入れると鳴らし直しの無限ループになる（実際に踏んだ）
        function Play({ song }: { song: typeof APPLE }) {
            const music = useMusic();
            const done = React.useRef(false);
            React.useEffect(() => {
                if (done.current) return;
                done.current = true;
                music.play("q", [song], 0, "BGM");
            }, [music, song]);
            return null;
        }
        render(<MusicProvider><Play song={APPLE} /></MusicProvider>);
        expect(document.querySelector("audio")?.getAttribute("src")).toBe(APPLE.previewUrl);
    });
});

// **用途ごとに分けた許可リストが、画面側では1つも縛られていなかった。**
// `is1-ssl.mzstatic.com` は音源にもアートワークにも通るので、
// 取り違えても気づけない（サーバー側のテストは縛っている）
describe("用途を取り違えない", () => {
    it("アートワークの欄に音源のホストを入れたら落とす", () => {
        renderCard({ ...APPLE, artwork: "https://audio-ssl.itunes.apple.com/p.m4a" });
        expect(document.querySelector("img")?.getAttribute("src") ?? "",
            "音源のホストをアートワークとして読み込んでいる").not.toContain("audio-ssl");
    });
});

// MiniPlayer のアートワークも同じ（確認を戻す変異が素通りしていた）
describe("MiniPlayer のアートワーク", () => {
    async function playThen(song: typeof APPLE) {
        const { useMusic } = await import("../../music/MusicContext");
        const MiniPlayer = (await import("../MiniPlayer")).default;
        function Play() {
            const music = useMusic();
            const done = React.useRef(false);
            React.useEffect(() => {
                if (done.current) return;
                done.current = true;
                music.play("q", [song], 0, "BGM");
            }, [music]);
            return null;
        }
        render(<MusicProvider><Play /><MiniPlayer /></MusicProvider>);
    }

    it("許可していないホストのアートワークは読み込まない", async () => {
        await playThen(EVIL);
        const srcs = Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src") ?? "");
        expect(srcs.join(" "), "外部の画像を読み込んでいる").not.toContain("evil.example");
    });

    it("Apple のホストは出す", async () => {
        await playThen(APPLE);
        const srcs = Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src") ?? "");
        expect(srcs.join(" ")).toContain("is1-ssl.mzstatic.com");
    });
});
