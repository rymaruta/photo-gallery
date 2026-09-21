"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { userPublicFetch, userFetch, readApiError, sessionErrorMessage } from "../../lib/utils/api";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { ROUTES } from "../../lib/routes";
import { publicImageUrl } from "@/lib/utils/seo";

/**
 * 共同アルバムの招待（案C）。
 *
 * **`/j?t=<トークン>` というクエリ形式**にしてある。このサイトは静的書き出しで
 * `dynamicParams = false`（列挙外は404）なので、`/j/<トークン>` にすると
 * **全トークンをビルド時に列挙しないと開けない**。`/?photo=<id>`・
 * `/users?id=` と同じ形で、実績がある。
 *
 * **閲覧はログイン不要。** 開いた瞬間にログインを求めると、拡散の輪が
 * そこで切れる。参加と投稿だけログインが要る。
 */

type InviteAlbum = { id: string; title: string; memberCount: number };
type InvitePhoto = { id: string; src: string; thumbSrc?: string; blurDataURL?: string };

function InviteView() {
    const token = useSearchParams().get("t") ?? "";
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { showToast } = useToast();

    const [state, setState] = React.useState<"loading" | "ok" | "error">("loading");
    const [error, setError] = React.useState("");
    const [album, setAlbum] = React.useState<InviteAlbum | null>(null);
    const [photos, setPhotos] = React.useState<InvitePhoto[]>([]);
    const [joined, setJoined] = React.useState(false);
    const [joining, setJoining] = React.useState(false);

    React.useEffect(() => {
        if (!token) {
            setState("error");
            setError("招待リンクが正しくありません");
            return;
        }
        let alive = true;
        (async () => {
            try {
                const res = await userPublicFetch(`/invites/${encodeURIComponent(token)}`);
                if (!alive) return;
                if (!res.ok) {
                    // **理由をそのまま出す。** サーバーは「期限が切れた」
                    // 「取り消された」「見つからない」を書き分けている
                    setError(await readApiError(res, "この招待リンクは開けませんでした"));
                    setState("error");
                    return;
                }
                const data = await res.json() as { album?: InviteAlbum; photos?: InvitePhoto[] };
                if (!alive) return;
                if (!data.album?.id) {
                    setError("この招待リンクは開けませんでした");
                    setState("error");
                    return;
                }
                setAlbum(data.album);
                setPhotos(Array.isArray(data.photos) ? data.photos : []);
                setState("ok");
            } catch (e) {
                if (!alive) return;
                // 圏外とセッション切れを混ぜない（`sessionErrorMessage` に寄せる。
                // 見分けが付かないときは null が返るので、その場合の文言を持つ）
                setError(sessionErrorMessage(e) ?? "この招待リンクを開けませんでした");
                setState("error");
            }
        })();
        return () => { alive = false; };
    }, [token]);

    const join = React.useCallback(async () => {
        if (joining) return;
        setJoining(true);
        try {
            const res = await userFetch(`/invites/${encodeURIComponent(token)}/join`, { method: "POST" });
            if (!res.ok) {
                showToast(await readApiError(res, "参加できませんでした"), "error");
                return;
            }
            setJoined(true);
            // 招待リンクは共有されるので、同じ人が二度開くのは普通に起きる。
            // サーバーは `already` で区別を返すので、文言も分ける
            const data = await res.json().catch(() => ({})) as { already?: boolean };
            showToast(data.already ? "すでにこのアルバムに参加しています" : "このアルバムに参加しました", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "参加できませんでした", "error");
        } finally {
            setJoining(false);
        }
    }, [token, joining, showToast]);

    if (state === "loading") {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                {/* **見出しを1つ置く。** 読み上げは見出しでページを渡り歩くので、
                    h1 が無いとこの画面には入口が無い。見た目は変えない
                    （ホームの `sr-only sm:hidden` と同じ形） */}
                <h1 className="sr-only">アルバムへの招待</h1>
                <p className="text-sm text-white/60" aria-live="polite">読み込み中…</p>
            </main>
        );
    }

    if (state === "error" || !album) {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                <div className="text-center max-w-sm">
                    {/* **失敗の画面こそ見出しが要る。** 招待リンクは30日で
                        失効するので、ここは実際に人が着地する */}
                    <h1 className="sr-only">アルバムへの招待</h1>
                    <p className="text-sm text-white/85" role="alert">{error}</p>
                    <Link href={ROUTES.HOME} prefetch={false} className="inline-block mt-4 text-sm underline decoration-white/40 underline-offset-2">
                        トップへ
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black text-white px-4 py-8">
            <div className="max-w-2xl mx-auto">
                <p className="text-[11px] tracking-widest uppercase text-white/50">アルバムへの招待</p>
                <h1 className="text-xl mt-1">{album.title}</h1>
                {/* **枚数は出さない。** サーバーは返さない——消された写真の ID を
                    持ち続けるので、数えると嘘になる */}
                <p className="text-xs text-white/60 mt-1">{album.memberCount}人が参加</p>

                {photos.length > 0 && (
                    <ul className="grid grid-cols-3 gap-1 mt-6">
                        {photos.map((p) => (
                            <li key={p.id} className="aspect-square overflow-hidden rounded-sm bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={publicImageUrl(p.thumbSrc || p.src)}
                                    alt=""
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                />
                            </li>
                        ))}
                    </ul>
                )}

                <div className="mt-8">
                    {joined ? (
                        <Link
                            href={`${ROUTES.UPLOAD}?album=${encodeURIComponent(album.id)}`}
                            prefetch={false}
                            className="inline-block rounded-full bg-accent-fill text-white text-sm px-5 py-2.5"
                        >
                            写真を追加する
                        </Link>
                    ) : authLoading ? (
                        <p className="text-sm text-white/60">…</p>
                    ) : isAuthenticated ? (
                        <button
                            type="button"
                            onClick={join}
                            aria-disabled={joining}
                            className="rounded-full bg-accent-fill text-white text-sm px-5 py-2.5"
                            style={{ minHeight: 44 }}
                        >
                            {joining ? "参加しています…" : "このアルバムに参加する"}
                        </button>
                    ) : (
                        <>
                            {/* **閲覧は誰でも、参加はログイン。** 戻り先を渡して、
                                ログイン後にこの招待へ帰ってこられるようにする */}
                            <Link
                                href={`${ROUTES.LOGIN}?next=${encodeURIComponent(`/j?t=${token}`)}`}
                                prefetch={false}
                                className="inline-block rounded-full bg-accent-fill text-white text-sm px-5 py-2.5"
                            >
                                ログインして参加する
                            </Link>
                            {/* **はじめての人の入口も出す。** ログインしか
                                無いと、未登録の人はログイン画面の「新規登録」を
                                押すことになり、そこで戻り先が消えていた */}
                            <p className="text-xs text-white/60 mt-3">
                                はじめての方は{" "}
                                <Link
                                    href={`${ROUTES.SIGNUP}?next=${encodeURIComponent(`/j?t=${token}`)}`}
                                    prefetch={false}
                                    className="underline hover:text-white transition-colors"
                                >
                                    新規登録
                                </Link>
                                。写真を見るだけならログインは要りません。
                            </p>
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}

export default function InvitePage() {
    // `useSearchParams` は Suspense の中で使う（静的書き出しの前提。
    // `/users` も同じ形）
    return (
        <Suspense fallback={
            // **事前描画で焼かれるのはこの fallback。** 内側の
            // `state === "loading"` ではない——`useSearchParams` のために
            // 全体を包んでいるので、**JS が走る前に見えるのはここ**。
            // 内側にだけ見出しを足しても静的HTMLは h1=0 のままだった（実測）
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                <h1 className="sr-only">アルバムへの招待</h1>
                <p className="text-sm text-white/60">読み込み中…</p>
            </main>
        }>
            <InviteView />
        </Suspense>
    );
}
