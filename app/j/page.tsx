"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { userPublicFetch, userFetch, readApiError, sessionErrorMessage } from "../../lib/utils/api";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { ROUTES } from "../../lib/routes";

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
            showToast("このアルバムに参加しました", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "参加できませんでした", "error");
        } finally {
            setJoining(false);
        }
    }, [token, joining, showToast]);

    if (state === "loading") {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                <p className="text-sm text-white/60" aria-live="polite">読み込み中…</p>
            </main>
        );
    }

    if (state === "error" || !album) {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                <div className="text-center max-w-sm">
                    <p className="text-sm text-white/85" role="alert">{error}</p>
                    <Link href={ROUTES.HOME} className="inline-block mt-4 text-sm underline decoration-white/40 underline-offset-2">
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
                                    src={p.thumbSrc || p.src}
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
                            className="inline-block rounded-full bg-white text-black text-sm px-5 py-2.5"
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
                            className="rounded-full bg-white text-black text-sm px-5 py-2.5"
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
                                className="inline-block rounded-full bg-white text-black text-sm px-5 py-2.5"
                            >
                                ログインして参加する
                            </Link>
                            <p className="text-xs text-white/60 mt-3">写真を見るだけならログインは要りません。</p>
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
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                <p className="text-sm text-white/60">読み込み中…</p>
            </main>
        }>
            <InviteView />
        </Suspense>
    );
}
