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
describe("音源はこのサイトで唯一の <audio> を通る", () => {
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
        expect(audio?.getAttribute("src") ?? "", "外部の音源を先読みしている").not.toContain("evil.example");
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
