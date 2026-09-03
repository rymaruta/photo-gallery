"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, UserCircleIcon, CameraIcon, MusicalNoteIcon, MagnifyingGlassIcon, XMarkIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { userFetch, readApiError, AUTH_REQUIRED_MESSAGE } from "../../../lib/utils/api";
import { changedFields } from "../../../lib/utils/changedFields";
import { parseMusicEmbed, musicServiceLabel, searchSongs, type SongResult } from "../../../lib/utils/music";
import { toUploadSafeFile, AVATAR_MAX_PX, COVER_MAX_PX } from "../../../lib/utils/image";
import { unstrippableMessage } from "../../../lib/utils/uploadRejection";
import { log } from "../../../lib/utils/log";
import { useMusic } from "../../music/MusicContext";
import DeleteAccountModal from "../../components/DeleteAccountModal";
import { loginWithNext } from "../../../lib/routes";

type SongEntry = {
    title: string;
    artist?: string;
    artwork?: string;
    previewUrl: string;
    trackUrl?: string;
};

type UserProfile = {
    userId: string;
    username?: string;
    displayName?: string;
    bio?: string;
    instagram?: string;
    website?: string;
    songUrl?: string;
    songStart?: number;
    songEnd?: number;
    songTitle?: string;
    songArtist?: string;
    songArtwork?: string;
    songPreviewUrl?: string;
    songTrackUrl?: string;
    songs?: SongEntry[];
    tripTitles?: Record<string, string>;
    tripCovers?: Record<string, string>;
    tripSongs?: Record<string, SongEntry>;
    themeColor?: string;
    statusText?: string;
    pinnedPhotoIds?: string[];
};

// "1:23" / "83" → 秒。空や不正は undefined。
function mmssToSec(v: string): number | undefined {
    const t = v.trim();
    if (!t) return undefined;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/^(\d+):([0-5]?\d)$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}
function secToMMSS(s?: number): string {
    if (!s || s <= 0) return "";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";


// テーマカラーの見本。ここに無い色はパレット（input type="color"）から選べる
// 貼付リンクの曲は、サーバーが3つ揃っている前提で突き合わせる
// （songUrl が無ければ位置を無視し、終了位置は開始位置と比べて落とす）。
// 送るならこの3つ一緒、送らないなら1つも送らない。
const LINK_SONG_KEYS = ["songUrl", "songStart", "songEnd"] as const;

const THEME_COLOR_PRESETS = ["#38bdf8", "#34d399", "#f472b6", "#a78bfa", "#fb7185", "#fbbf24", "#f97316", "#22d3ee"];

export default function ProfileEditPage() {
    const { isAuthenticated, loading, deleteAccount } = useAuth();
    const { locale } = useLocale();
    const router = useRouter();
    const { showToast } = useToast();
    const { stop: stopGlobalMusic } = useMusic();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 退会（アカウント削除）
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    // 退会モーダルを閉じたときの戻り先（モーダル内の autoFocus に奪われるため明示）
    const deleteAccountBtnRef = useRef<HTMLButtonElement | null>(null);
    const [deletingAccount, setDeletingAccount] = useState(false);

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [fetching, setFetching] = useState(true);
    const [saving, setSaving] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);

    const [username, setUsername] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [themeColor, setThemeColor] = useState("");
    // 見本に無い色＝パレットで選んだ色（右端の丸を選択中として見せる）
    const isCustomTheme = !!themeColor && !THEME_COLOR_PRESETS.includes(themeColor);
    const [instagram, setInstagram] = useState("");
    const [website, setWebsite] = useState("");
    // マイBGMプレイリスト: アプリ内検索で選んだ曲（最大5曲・順に再生）
    const [selectedSongs, setSelectedSongs] = useState<SongResult[]>([]);
    const [songQuery, setSongQuery] = useState("");
    const [songResults, setSongResults] = useState<SongResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState(false);
    // 検索結果の試聴（同時に1曲だけ）
    const [previewId, setPreviewId] = useState<string | null>(null);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    // テーマソング: リンク貼付（上級者向け・フル尺/区間指定）
    const [showUrlMethod, setShowUrlMethod] = useState(false);
    const [songUrl, setSongUrl] = useState("");
    const [songStartText, setSongStartText] = useState("");
    const [songEndText, setSongEndText] = useState("");
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [coverError, setCoverError] = useState(false);
    const [coverUploading, setCoverUploading] = useState(false);
    // プロフィールの読み込みに失敗したか。
    // PUT は全置換なので、読み込めていない（=フォームが空欄の）状態で保存すると
    // 自己紹介・リンク・テーマ色・BGM・ピン留め・旅アルバムがまとめて消える。
    // app/users/UserProfileClient.tsx にも同じ理由のガードがある。
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        if (!loading && !isAuthenticated) router.replace(loginWithNext(window.location.pathname + window.location.search));
    }, [isAuthenticated, loading, router]);

    useEffect(() => {
        if (!isAuthenticated) return;
        void (async () => {
            try {
                const res = await userFetch("/user/profile");
                if (res.ok) {
                    const data = await res.json() as UserProfile;
                    setProfile(data);
                    setDisplayName(data.displayName ?? "");
                    setBio(data.bio ?? "");
                    setThemeColor(data.themeColor ?? "");
                    setInstagram(data.instagram ?? "");
                    setWebsite(data.website ?? "");
                    // 検索の曲と貼付リンクは独立して復元する（両方保持される）
                    if (data.songs && data.songs.length > 0) {
                        setSelectedSongs(data.songs.map((sg) => ({
                            id: sg.previewUrl,
                            title: sg.title,
                            artist: sg.artist ?? "",
                            artwork: sg.artwork ?? "",
                            previewUrl: sg.previewUrl,
                            trackUrl: sg.trackUrl ?? "",
                        })));
                    } else if (data.songPreviewUrl && data.songTitle) {
                        setSelectedSongs([{
                            id: data.songPreviewUrl,
                            title: data.songTitle,
                            artist: data.songArtist ?? "",
                            artwork: data.songArtwork ?? "",
                            previewUrl: data.songPreviewUrl,
                            trackUrl: data.songTrackUrl ?? "",
                        }]);
                    }
                    setUsername(data.username ?? "");
                    if (data.songUrl) {
                        setShowUrlMethod(true);
                        setSongUrl(data.songUrl);
                        setSongStartText(secToMMSS(data.songStart));
                        setSongEndText(secToMMSS(data.songEnd));
                    }
                } else {
                    setLoadFailed(true);
                }
            } catch {
                setLoadFailed(true);
            } finally {
                setFetching(false);
            }
        })();
    }, [isAuthenticated]);

    const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // 同じファイルを選び直しても change が発火するように値を空にしておく。
        // アップロードに失敗したあと同じ写真でやり直せなかった。
        e.target.value = "";
        if (!file) return;
        const reader = new FileReader();
        // 失敗したらプレビューを消す。残したままだと**保存された気になる**
        // ——画面には新しい写真が出ているのに、S3 にもプロフィールにも
        // 入っていない。次に開くと元に戻っていて、何が起きたのか分からない。
        //
        // FileReader は非同期なので、**先に失敗する順序がある**
        // （presign が 503 で即返るなど）。あとから onload が発火して
        // 消したはずのプレビューを描き直さないよう、両方の順序を見る。
        let saved = false;
        let failed = false;
        reader.onload = (ev) => { if (!failed) setCoverPreview(ev.target?.result as string); };
        reader.readAsDataURL(file);
        setCoverUploading(true);
        try {
            // 表示は横幅いっぱいの帯なので、原寸ではなく1280pxまで縮めて送る。
            // 縮小に失敗しても原寸で続行してはいけない（EXIF の GPS が公開URLに乗る）。
            let upload: File;
            try {
                upload = await toUploadSafeFile(file, COVER_MAX_PX, 0.85);
            } catch (e) {
                log.error("cover: could not strip metadata:", e);
                showToast(unstrippableMessage(e, locale), "error");
                return;
            }

            const res = await userFetch("/profile/avatar/presigned-url", {
                method: "POST",
                body: JSON.stringify({ fileType: upload.type, type: "cover" }),
            });
            // サーバーは理由を返し分けている（「対応していない形式です
            // （JPEG・PNG・WebP・AVIF・HEIC・GIF）」など）。固定文に潰していたので、
            // 形式が原因なのか一時障害なのか分からず、同じ画像を選び直していた
            if (!res.ok) { showToast(await readApiError(res, "カバー写真のアップロードに失敗しました"), "error"); return; }
            const { presignedUrl, contentType } = await res.json() as { presignedUrl: string; contentType?: string };
            const uploadRes = await fetch(presignedUrl, {
                method: "PUT",
                body: upload,
                // Cache-Control は署名対象外ヘッダなので presigned URL 側では指定できない。
                // クライアントが送らないと S3 に何も付かず、CDN の既定TTLで配信されて
                // アイコンを変えても他人には古いものが出続ける（固定キーのため）。
                headers: { "Content-Type": contentType ?? upload.type, "Cache-Control": "no-store" },
            });
            if (!uploadRes.ok) { showToast("カバー写真のアップロードに失敗しました", "error"); return; }
            setCoverError(false);
            saved = true;
            showToast("カバー写真を更新しました", "success");
        } catch (e) {
            const authMissing = e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE;
            showToast(authMissing ? AUTH_REQUIRED_MESSAGE : "カバー写真のアップロードに失敗しました", "error");
        } finally {
            setCoverUploading(false);
            if (!saved) { failed = true; setCoverPreview(null); }
        }
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // 同じファイルを選び直せるように値を空にする（失敗後のやり直し用）
        e.target.value = "";
        if (!file) return;

        // プレビュー表示
        const reader = new FileReader();
        // カバーと同じ。失敗したらプレビューを消す（保存された気にさせない）。
        // FileReader が後から発火して描き直さないよう、両方の順序を見る。
        let saved = false;
        let failed = false;
        reader.onload = (ev) => { if (!failed) setAvatarPreview(ev.target?.result as string); };
        reader.readAsDataURL(file);

        setAvatarUploading(true);
        try {
            // 表示サイズに合わせて縮小。
            // 縮小に失敗しても原寸で続行してはいけない（EXIF の GPS が公開URLに乗る）。
            let upload: File;
            try {
                upload = await toUploadSafeFile(file, AVATAR_MAX_PX, 0.85);
            } catch (e) {
                log.error("avatar: could not strip metadata:", e);
                showToast(unstrippableMessage(e, locale), "error");
                return;
            }

            // Presigned URL 取得
            const res = await userFetch("/profile/avatar/presigned-url", {
                method: "POST",
                body: JSON.stringify({ fileType: upload.type }),
            });
            // カバー写真と同じ理由（サーバーは形式の誤りと一時障害を返し分けている）
            if (!res.ok) { showToast(await readApiError(res, "アバターのアップロードに失敗しました"), "error"); return; }
            const { presignedUrl, contentType } = await res.json() as { presignedUrl: string; contentType?: string };

            // S3 に直接アップロード（表示サイズに合わせて縮小してから送る）
            const uploadRes = await fetch(presignedUrl, {
                method: "PUT",
                body: upload,
                // Cache-Control は署名対象外ヘッダなので presigned URL 側では指定できない。
                // クライアントが送らないと S3 に何も付かず、CDN の既定TTLで配信されて
                // アイコンを変えても他人には古いものが出続ける（固定キーのため）。
                headers: { "Content-Type": contentType ?? upload.type, "Cache-Control": "no-store" },
            });
            if (!uploadRes.ok) { showToast("アバターのアップロードに失敗しました", "error"); return; }

            setAvatarError(false);
            saved = true;
            showToast("プロフィール写真を更新しました", "success");
        } catch (e) {
            const authMissing = e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE;
            showToast(authMissing ? AUTH_REQUIRED_MESSAGE : "アバターのアップロードに失敗しました", "error");
        } finally {
            setAvatarUploading(false);
            if (!saved) { failed = true; setAvatarPreview(null); }
        }
    };

    const stopPreview = () => {
        previewAudioRef.current?.pause();
        setPreviewId(null);
    };

    const togglePreview = (song: SongResult) => {
        if (!previewAudioRef.current) previewAudioRef.current = new Audio();
        const a = previewAudioRef.current;
        if (previewId === song.id) {
            a.pause();
            setPreviewId(null);
            return;
        }
        // BGM が鳴っていたら止める。止めないとミニプレイヤーの曲と試聴が
        // 同時に鳴り、しかもミニプレイヤーは再生中のまま見える。
        stopGlobalMusic();
        a.src = song.previewUrl;
        a.currentTime = 0;
        a.onended = () => setPreviewId(null);
        void a.play().catch(() => { /* 再生できない環境は無視 */ });
        setPreviewId(song.id);
    };

    // 画面を離れたら試聴を止める
    useEffect(() => () => { previewAudioRef.current?.pause(); }, []);

    const addSong = (song: SongResult) => {
        setSelectedSongs((cur) => {
            if (cur.some((x) => x.previewUrl === song.previewUrl)) {
                showToast(locale === "en" ? "Already in your playlist" : "すでにプレイリストにあります", "info");
                return cur;
            }
            if (cur.length >= 5) {
                showToast(locale === "en" ? "Up to 5 songs" : "プレイリストは5曲までです", "info");
                return cur;
            }
            return [...cur, song];
        });
    };
    const removeSong = (previewUrl: string) =>
        setSelectedSongs((cur) => cur.filter((x) => x.previewUrl !== previewUrl));
    const moveSong = (idx: number, d: number) =>
        setSelectedSongs((cur) => {
            const j = idx + d;
            if (j < 0 || j >= cur.length) return cur;
            const next = [...cur];
            [next[idx], next[j]] = [next[j], next[idx]];
            return next;
        });

    const handleSongSearch = async () => {
        const q = songQuery.trim();
        if (!q) return;
        stopPreview();
        setSearching(true);
        setSearchError(false);
        try {
            setSongResults(await searchSongs(q));
        } catch {
            setSearchError(true);
            setSongResults([]);
        } finally {
            setSearching(false);
        }
    };

    const handleSave = async () => {
        // 読み込めていない状態で保存すると、PUT が全置換なので既存の項目が
        // まとめて消える。保存させず、再読み込みを促す。
        if (loadFailed) {
            showToast(locale === "en"
                ? "Could not load your profile. Please reload and try again."
                : "プロフィールを読み込めていません。再読み込みしてからお試しください。", "error");
            return;
        }
        // 検索の曲 と 貼付リンク を独立して保存する。
        //  - 曲(検索)があれば表示は曲を優先（UserProfileClient 側で判定）
        //  - リンクはそのまま保持され、曲を消すとリンクが使われる
        const trimmedUrl = songUrl.trim();
        if (trimmedUrl && !parseMusicEmbed(trimmedUrl)) {
            showToast(locale === "en"
                ? "Song link must be Spotify, YouTube, or Apple Music."
                : "曲のリンクは Spotify / YouTube / Apple Music に対応しています。", "error");
            return;
        }
        const songPayload = {
            // 貼付リンク（独立）
            songUrl: trimmedUrl,
            // null で送る。undefined だと JSON.stringify がキーごと落とし、
            // サーバーの部分更新が「指定なし＝触らない」と解釈するため、
            // 一度入れた開始/終了位置を空にしても消えなかった
            // （他の項目は空文字を送っているので影響がない）。
            songStart: mmssToSec(songStartText) ?? null,
            songEnd: mmssToSec(songEndText) ?? null,
            // 検索で選んだ曲（独立）
            songTitle: selectedSongs[0]?.title ?? "",
            songArtist: selectedSongs[0]?.artist ?? "",
            songArtwork: selectedSongs[0]?.artwork ?? "",
            songPreviewUrl: selectedSongs[0]?.previewUrl ?? "",
            songTrackUrl: selectedSongs[0]?.trackUrl ?? "",
            songs: selectedSongs.map((sg) => ({
                title: sg.title,
                artist: sg.artist,
                artwork: sg.artwork,
                previewUrl: sg.previewUrl,
                trackUrl: sg.trackUrl,
            })),
        };
        setSaving(true);
        try {
            // PUT は部分更新なので、このページで編集する項目だけ送る。
            // 旅アルバム・ピン留め・ひとことは送らなければ触られない
            // （以前は全置換で、送り忘れた項目が消えていた）。
            //
            // さらに **実際に変えた項目だけ**へ絞る。開いた時点の値を毎回
            // 全部送っていたので、同じ画面を2タブで開いて片方で自己紹介を
            // 直したあと、もう片方でテーマ色だけ変えて保存すると
            // **自己紹介が元に戻った**（サーバーの rev は「同じ項目を送って
            // きた側が勝つ」ので、これは rev では守れない）。
            const nextFields: Record<string, unknown> = {
                username: username.trim().toLowerCase().replace(/^@/, ""),
                displayName, bio, instagram, website,
                themeColor,
                ...songPayload,
            };
            const originalFields: Record<string, unknown> = {
                username: profile?.username ?? "",
                displayName: profile?.displayName ?? "",
                bio: profile?.bio ?? "",
                instagram: profile?.instagram ?? "",
                website: profile?.website ?? "",
                themeColor: profile?.themeColor ?? "",
                songUrl: profile?.songUrl ?? "",
                songStart: profile?.songStart ?? null,
                songEnd: profile?.songEnd ?? null,
                songTitle: profile?.songTitle ?? "",
                songArtist: profile?.songArtist ?? "",
                songArtwork: profile?.songArtwork ?? "",
                songPreviewUrl: profile?.songPreviewUrl ?? "",
                songTrackUrl: profile?.songTrackUrl ?? "",
                // 復元（この上の useEffect）は songs が無いとき
                // songPreviewUrl + songTitle から1曲を組む。比較元を
                // 素の `?? []` にすると、**何も触っていない旧データの人が
                // 毎回 songs を送る**——PC の古いタブで自己紹介だけ直すと、
                // スマホで増やしたプレイリストが1曲に潰れる。復元と同じ形で組む。
                songs: profile?.songs ?? (profile?.songPreviewUrl && profile?.songTitle
                    ? [{
                        title: profile.songTitle,
                        artist: profile.songArtist ?? "",
                        artwork: profile.songArtwork ?? "",
                        previewUrl: profile.songPreviewUrl,
                        trackUrl: profile.songTrackUrl ?? "",
                    }]
                    : []),
            };
            const body = changedFields(nextFields, originalFields);
            // 貼付リンクの3項目は**ひとかたまりで送る**。サーバーは
            // 「songUrl を送った回だけ開始・終了位置を触る」規約（E-4）で、
            // さらに終了位置は開始位置と突き合わせて成立しないものを落とす。
            // 変わった1項目だけ送ると、サーバーが片方を undefined として
            // 判定するので、突き合わせの結果が「全部送っていた頃」と変わる。
            // 3つとも変わっていなければ1つも送らない（それがこの修正の目的）。
            if (LINK_SONG_KEYS.some((k) => k in body)) {
                for (const k of LINK_SONG_KEYS) body[k] = nextFields[k];
            }

            // 変更ゼロなら投げない。サーバーは changes が空でも rev と
            // updatedAt を書き直すので、同時に走っている UserProfileClient の
            // 保存を無駄に競合させる。比較元を保存後に更新するようにした分、
            // この「何も変えずに保存」は普通に起きる。
            if (Object.keys(body).length === 0) {
                showToast(locale === "en" ? "Profile saved." : "プロフィールを保存しました。", "success");
                return;
            }
            const res = await userFetch("/user/profile", {
                method: "PUT",
                body: JSON.stringify(body),
            });
            if (res.ok) {
                // **比較元を保存後の姿に更新する。** これが無いと、同じ画面で
                // 保存 → やっぱり元に戻す → 保存、が黙って無視された
                // （2回目は「開いた時点の値」と比べるので差分ゼロになる）。
                // いちばん質が悪いのは @名で、old→new の保存で old は
                // 解放済みなのに、old に戻す保存が送られず new のまま残る。
                //
                // サーバーは 200 でマージ後のプロフィールをそのまま返す。
                // 読めなかったときは、送った分だけ手元で重ねる。
                const saved = await res.json().catch(() => null) as UserProfile | null;
                if (saved && typeof saved === "object") setProfile(saved);
                else setProfile((p) => ({ ...(p ?? {}), ...body } as UserProfile));
                showToast(locale === "en" ? "Profile saved." : "プロフィールを保存しました。", "success");
            } else {
                // サーバーは理由を返している（「そのユーザー名は既に使われています」など）。
                // 「保存に失敗しました。」だけだと、@名が重複しているのか通信が
                // 切れたのか分からず、同じ操作を何度も繰り返すことになる。
                // 保存は1件も書かれていない（サーバー側で先に弾いている）。
                showToast(await readApiError(res,
                    locale === "en" ? "Failed to save." : "保存に失敗しました。"), "error");
            }
        } catch {
            showToast(locale === "en" ? "Failed to save." : "保存に失敗しました。", "error");
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteAccount = async () => {
        setDeletingAccount(true);
        try {
            const result = await deleteAccount();
            if (result.success) {
                // deleteAccount 内でトップへ遷移済み。トーストで結果を伝える。
                showToast(locale === "en" ? "Your account has been deleted." : "退会が完了しました。ご利用ありがとうございました。", "success");
            } else {
                showToast(result.error || (locale === "en" ? "Failed to delete account." : "退会処理に失敗しました。"), "error");
                setShowDeleteModal(false);
            }
        } catch {
            showToast(locale === "en" ? "Failed to delete account." : "退会処理に失敗しました。", "error");
            setShowDeleteModal(false);
        } finally {
            setDeletingAccount(false);
        }
    };

    if (loading || fetching) {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const currentAvatarUrl = profile?.userId && CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(profile.userId)}`
        : null;
    const currentCoverUrl = profile?.userId && CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(profile.userId)}/cover`
        : null;

    const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors";
    const labelClass = "block text-xs text-white/50 mb-1.5 tracking-wide";

    const songPreview = parseMusicEmbed(songUrl, mmssToSec(songStartText), mmssToSec(songEndText));
    const songInvalid = songUrl.trim().length > 0 && !songPreview;
    const isYouTubePreview = songPreview?.service === "youtube";

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-sm mx-auto px-4 pt-12 pb-16">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors mb-10"
                >
                    <ArrowLeftIcon className="w-3 h-3" />
                    {locale === "en" ? "Back" : "戻る"}
                </Link>

                {/* 読み込めていないことを黙って空欄で見せると、書き直して保存され
                    既存のプロフィールが消える。はっきり伝えて保存させない。 */}
                {loadFailed && (
                    <div className="mb-8 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs leading-relaxed text-red-200">
                        {locale === "en"
                            ? "Could not load your profile. The fields below are empty because of this, not because your profile is empty. Reload before editing — saving now would erase it."
                            : "プロフィールを読み込めませんでした。下の欄が空なのはそのためで、登録内容が消えたわけではありません。このまま保存すると上書きされてしまうので、再読み込みしてください。"}
                    </div>
                )}

                <h1 className="text-xl font-bold mb-6">
                    {locale === "en" ? "Edit Profile" : "プロフィール編集"}
                </h1>

                {/* カバー写真 */}
                <div className="mb-6">
                    <p className={labelClass}>{locale === "en" ? "Cover photo" : "カバー写真"}</p>
                    <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        disabled={coverUploading}
                        className="relative w-full h-28 rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 transition-colors group"
                    >
                        {coverPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverPreview} alt="" className="w-full h-full object-cover" />
                        ) : currentCoverUrl && !coverError ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={currentCoverUrl} alt="" className="w-full h-full object-cover" onError={() => setCoverError(true)} />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-white/30">
                                <CameraIcon className="w-6 h-6" />
                                <span className="text-xs">{locale === "en" ? "Add cover photo" : "カバー写真を追加"}</span>
                            </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                            {coverUploading
                                ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                : <CameraIcon className="w-6 h-6 text-white" />}
                        </div>
                    </button>
                    <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
                        onChange={(e) => void handleCoverChange(e)} />
                </div>

                {/* アバター */}
                <div className="flex flex-col items-center mb-8">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="relative group"
                        aria-label={locale === "en" ? "Change profile photo" : "プロフィール写真を変更"}
                    >
                        <div className="w-20 h-20 rounded-full overflow-hidden bg-white/10 ring-2 ring-white/20 group-hover:ring-white/50 transition-all">
                            {avatarPreview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                            ) : currentAvatarUrl && !avatarError ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={currentAvatarUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={() => setAvatarError(true)}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <UserCircleIcon className="w-10 h-10 text-white/30" />
                                </div>
                            )}
                        </div>
                        <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                            {avatarUploading
                                ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                : <CameraIcon className="w-6 h-6 text-white" />
                            }
                        </div>
                    </button>
                    <p className="text-xs text-white/40 mt-2">
                        {locale === "en" ? "Tap to change photo" : "タップして写真を変更"}
                    </p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleAvatarChange(e)}
                    />
                </div>

                <div className="space-y-5">
                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Username" : "ユーザー名"}
                        </label>
                        <div className="flex items-center gap-1.5">
                            <span className="text-white/40 text-sm">@</span>
                            <input
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                                maxLength={20}
                                placeholder="travel_photo"
                                className={inputClass}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                        </div>
                        <p className="text-[11px] text-white/40 mt-1">
                            {locale === "en"
                                ? "Lowercase letters, numbers and _ (3-20). Shown under your name."
                                : "英小文字・数字・_ の3〜20文字。プロフィールの名前の下に表示されます。"}
                        </p>
                    </div>

                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Display name" : "表示名"}
                        </label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            maxLength={100}
                            placeholder={locale === "en" ? "Your name" : "名前"}
                            className={inputClass}
                        />
                    </div>

                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Bio" : "自己紹介"}
                        </label>
                        <textarea
                            value={bio}
                            onChange={e => setBio(e.target.value)}
                            maxLength={300}
                            rows={4}
                            placeholder={locale === "en" ? "Tell us about yourself..." : "旅と写真が好きです…"}
                            className={`${inputClass} resize-none`}
                        />
                        <div className="text-right text-xs text-white/30 mt-1">{bio.length}/300</div>
                    </div>


                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Theme color" : "テーマカラー"}
                        </label>
                        <div className="flex flex-wrap items-center gap-2.5">
                            {THEME_COLOR_PRESETS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setThemeColor(themeColor === c ? "" : c)}
                                    aria-label={c}
                                    aria-pressed={themeColor === c}
                                    className={`w-9 h-9 rounded-full ring-2 ring-offset-2 ring-offset-black active:scale-90 transition ${themeColor === c ? "ring-white scale-110" : "ring-transparent"}`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}

                            {/* パレットから自由に選ぶ。見本の中に無い色もここで決められる */}
                            <label
                                className={`relative w-9 h-9 rounded-full ring-2 ring-offset-2 ring-offset-black active:scale-90 transition cursor-pointer overflow-hidden ${isCustomTheme ? "ring-white scale-110" : "ring-white/30"}`}
                                style={{
                                    background: isCustomTheme
                                        ? themeColor
                                        : "conic-gradient(#f87171, #fbbf24, #34d399, #38bdf8, #a78bfa, #f472b6, #f87171)",
                                }}
                                title={locale === "en" ? "Pick any color" : "パレットから選ぶ"}
                            >
                                <input
                                    type="color"
                                    value={/^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : "#38bdf8"}
                                    onChange={(e) => setThemeColor(e.target.value.toLowerCase())}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    aria-label={locale === "en" ? "Pick any color" : "パレットから色を選ぶ"}
                                />
                            </label>

                            {themeColor && (
                                <button
                                    type="button"
                                    onClick={() => setThemeColor("")}
                                    className="px-3 py-2 rounded-full text-xs text-white/60 hover:text-white bg-white/5 ring-1 ring-white/10 active:scale-95 transition"
                                >
                                    {locale === "en" ? "Reset" : "解除"}
                                </button>
                            )}
                        </div>
                        <p className="text-xs text-white/30 mt-1.5">
                            {locale === "en"
                                ? "Colors your avatar ring and accents. The last swatch opens a full color picker."
                                : "アバターのリングなどの色になります。右端の丸を押すとパレットから自由に選べます。"}
                        </p>
                    </div>

                    <div>
                        <label className={labelClass}>Instagram</label>
                        <div className="flex items-center">
                            <span className="text-white/40 text-sm px-3 py-3 bg-white/5 border border-r-0 border-white/10 rounded-l-lg">@</span>
                            <input
                                type="text"
                                value={instagram}
                                onChange={e => setInstagram(e.target.value.replace(/^@/, ""))}
                                maxLength={100}
                                placeholder="username"
                                className={`${inputClass} rounded-l-none`}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Website" : "ウェブサイト"}
                        </label>
                        <input
                            type="url"
                            value={website}
                            onChange={e => setWebsite(e.target.value)}
                            maxLength={200}
                            placeholder="https://example.com"
                            className={inputClass}
                        />
                    </div>

                    {/* テーマソング */}
                    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 space-y-3">
                        <div className="flex items-center gap-1.5">
                            <MusicalNoteIcon className="w-4 h-4 text-fuchsia-400" />
                            <span className="text-sm font-semibold">{locale === "en" ? "My BGM" : "マイBGM"}</span>
                        </div>

                        {/* 選択済みプレイリスト（並べ替え・削除つき） */}
                        {selectedSongs.length > 0 && (
                            <ul className="space-y-1.5">
                                {selectedSongs.map((song, idx) => (
                                    <li key={song.previewUrl} className="flex items-center gap-2 rounded-xl bg-white/5 ring-1 ring-white/10 p-2">
                                        <span className="w-4 text-center text-xs text-white/50 tabular-nums flex-shrink-0">{idx + 1}</span>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={song.artwork} alt="" loading="lazy" className="w-9 h-9 rounded-md object-cover bg-white/10 flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs text-white truncate">{song.title}</p>
                                            <p className="text-[11px] text-white/50 truncate">{song.artist}</p>
                                        </div>
                                        <button type="button" onClick={() => moveSong(idx, -1)} disabled={idx === 0}
                                            aria-label={locale === "en" ? "Move up" : "上へ"}
                                            className="px-1.5 py-1 text-white/40 hover:text-white disabled:opacity-25 active:scale-90 transition text-sm">↑</button>
                                        <button type="button" onClick={() => moveSong(idx, 1)} disabled={idx === selectedSongs.length - 1}
                                            aria-label={locale === "en" ? "Move down" : "下へ"}
                                            className="px-1.5 py-1 text-white/40 hover:text-white disabled:opacity-25 active:scale-90 transition text-sm">↓</button>
                                        <button type="button" onClick={() => removeSong(song.previewUrl)}
                                            aria-label={locale === "en" ? "Remove" : "削除"}
                                            className="px-1.5 py-1 text-white/40 hover:text-red-400 active:scale-90 transition">
                                            <XMarkIcon className="w-4 h-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {selectedSongs.length < 5 && (
                            <>
                                <p className="text-xs text-white/40 -mt-1">
                                    {locale === "en"
                                        ? `Search songs — up to 5 play in order on your profile (${selectedSongs.length}/5).`
                                        : `曲名で検索して追加。プロフィールで順に再生されます（${selectedSongs.length}/5曲）。`}
                                </p>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <MagnifyingGlassIcon className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            value={songQuery}
                                            onChange={e => setSongQuery(e.target.value)}
                                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleSongSearch(); } }}
                                            placeholder={locale === "en" ? "Song or artist" : "曲名・アーティスト名"}
                                            className={`${inputClass} pl-9`}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleSongSearch()}
                                        disabled={searching || !songQuery.trim()}
                                        className="px-4 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-sm disabled:opacity-40 flex items-center justify-center min-w-[64px]"
                                    >
                                        {searching
                                            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            : (locale === "en" ? "Search" : "検索")}
                                    </button>
                                </div>

                                {searchError && (
                                    <p className="text-xs text-amber-400/80">
                                        {locale === "en" ? "Search failed. Try again." : "検索に失敗しました。もう一度お試しください。"}
                                    </p>
                                )}

                                {songResults.length > 0 && (
                                    <ul className="rounded-xl ring-1 ring-white/10 divide-y divide-white/5 overflow-hidden max-h-72 overflow-y-auto no-scrollbar">
                                        {songResults.map(song => {
                                            const isPreviewing = previewId === song.id;
                                            return (
                                            <li key={song.id} className="flex items-center gap-1 pr-2 hover:bg-white/5 transition">
                                                {/* 試聴（選択とは別。同時に1曲だけ再生） */}
                                                <button
                                                    type="button"
                                                    onClick={() => togglePreview(song)}
                                                    aria-label={isPreviewing ? `${song.title}を停止` : `${song.title}を試聴`}
                                                    className="relative w-10 h-10 ml-2 my-2 rounded-md overflow-hidden bg-white/10 flex-shrink-0 group"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={song.artwork} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                                                    <span className={`absolute inset-0 flex items-center justify-center bg-black/45 ${isPreviewing ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
                                                        {isPreviewing ? <PauseIcon className="w-4 h-4 text-white" /> : <PlayIcon className="w-4 h-4 text-white ml-0.5" />}
                                                    </span>
                                                </button>
                                                {/* 選択 */}
                                                <button
                                                    type="button"
                                                    onClick={() => { stopPreview(); addSong(song); }}
                                                    className="min-w-0 flex-1 flex items-center py-2.5 text-left active:opacity-70 transition"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <p className={`text-sm truncate ${isPreviewing ? "text-fuchsia-300" : "text-white"}`}>{song.title}</p>
                                                        <p className="text-xs text-white/50 truncate">{song.artist}</p>
                                                    </div>
                                                    <span className="text-[11px] text-white/40 flex-shrink-0 pl-2">{locale === "en" ? "Add" : "追加"}</span>
                                                </button>
                                            </li>
                                            );
                                        })}
                                    </ul>
                                )}

                            </>
                        )}

                        {/* リンク: 検索の曲とは独立して保存。曲があれば曲を優先し、曲を消すとこのリンクが使われる */}
                        <div className="pt-1 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => setShowUrlMethod(v => !v)}
                                className="w-full flex items-center justify-between text-xs text-white/45 hover:text-white/70 transition pt-2"
                            >
                                <span>{locale === "en" ? "Or paste a link (full song / pick a section)" : "またはリンクを貼る（フル尺・区間指定）"}</span>
                                <ChevronDownIcon className={`w-4 h-4 transition-transform ${showUrlMethod ? "rotate-180" : ""}`} />
                            </button>

                            {selectedSongs.length > 0 && (songUrl.trim() || showUrlMethod) && (
                                <p className="text-[11px] text-white/35 pt-2">
                                    {locale === "en"
                                        ? "A picked song plays first — this link is kept and used when no song is set."
                                        : "曲を選ぶとそちらが優先。リンクは保存され、曲を消すと使われます。"}
                                </p>
                            )}

                            {showUrlMethod && (
                                        <div className="space-y-3 pt-3">
                                            <div>
                                                <input
                                                    type="url"
                                                    value={songUrl}
                                                    onChange={e => setSongUrl(e.target.value)}
                                                    maxLength={500}
                                                    placeholder="https://youtu.be/..."
                                                    className={inputClass}
                                                />
                                                {songInvalid && (
                                                    <p className="text-xs text-amber-400/80 mt-1.5">
                                                        {locale === "en"
                                                            ? "Unsupported link. Use Spotify, YouTube, or Apple Music."
                                                            : "未対応のリンクです。Spotify / YouTube / Apple Music を使ってください。"}
                                                    </p>
                                                )}
                                            </div>

                                            {songPreview && (
                                                <>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1">
                                                            <label className="block text-[11px] text-white/40 mb-1">{locale === "en" ? "Start (m:ss)" : "開始 (m:ss)"}</label>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                value={songStartText}
                                                                onChange={e => setSongStartText(e.target.value)}
                                                                disabled={!isYouTubePreview}
                                                                placeholder="1:12"
                                                                className={`${inputClass} py-2 disabled:opacity-40`}
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[11px] text-white/40 mb-1">{locale === "en" ? "End (m:ss)" : "終了 (m:ss)"}</label>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                value={songEndText}
                                                                onChange={e => setSongEndText(e.target.value)}
                                                                disabled={!isYouTubePreview}
                                                                placeholder="1:35"
                                                                className={`${inputClass} py-2 disabled:opacity-40`}
                                                            />
                                                        </div>
                                                    </div>
                                                    <p className="text-[11px] text-white/35">
                                                        {isYouTubePreview
                                                            ? (locale === "en" ? "Set a start/end to play your favorite part." : "開始・終了を指定すると好きな部分だけ再生できます。")
                                                            : (locale === "en" ? `Section trim works with YouTube only (${musicServiceLabel(songPreview.service)} plays from the start).` : `区間指定は YouTube のみ対応（${musicServiceLabel(songPreview.service)} は先頭から再生）。`)}
                                                    </p>
                                                    <div className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-black">
                                                        {isYouTubePreview ? (
                                                            <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
                                                                <iframe
                                                                    key={songPreview.embedUrl}
                                                                    src={songPreview.embedUrl}
                                                                    title="テーマソングの試聴"
                                                                    className="absolute inset-0 w-full h-full"
                                                                    allow="encrypted-media; picture-in-picture; web-share"
                                                                    referrerPolicy="strict-origin-when-cross-origin"
                                                                    loading="lazy"
                                                                />
                                                            </div>
                                                        ) : (
                                                            <iframe
                                                                key={songPreview.embedUrl}
                                                                src={songPreview.embedUrl}
                                                                title="テーマソングの試聴"
                                                                className="w-full"
                                                                style={{ height: songPreview.height ?? 152 }}
                                                                allow="encrypted-media; autoplay; clipboard-write"
                                                                loading="lazy"
                                                            />
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={() => void handleSave()}
                            disabled={saving || avatarUploading}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {saving && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                            {saving
                                ? (locale === "en" ? "Saving..." : "保存中...")
                                : (locale === "en" ? "Save" : "保存する")}
                        </button>
                    </div>

                    {/* 危険な操作: 退会（アカウント削除） */}
                    <div className="mt-10 pt-6 border-t border-white/10">
                        <p className="text-[11px] tracking-widest uppercase text-red-400/70 mb-2">
                            {locale === "en" ? "Danger zone" : "危険な操作"}
                        </p>
                        <div className="rounded-2xl bg-red-500/[0.05] ring-1 ring-red-500/15 p-4">
                            <p className="text-sm font-semibold text-white/90 mb-1">
                                {locale === "en" ? "Delete account" : "退会（アカウント削除）"}
                            </p>
                            <p className="text-xs text-white/45 leading-relaxed mb-3">
                                {locale === "en"
                                    ? "Permanently deletes your photos, stories, profile, and account. This can't be undone."
                                    : "写真・ストーリー・プロフィール・アカウントをすべて完全に削除します。取り消しはできません。"}
                            </p>
                            <button
                                type="button"
                                ref={deleteAccountBtnRef}
                                onClick={() => setShowDeleteModal(true)}
                                className="w-full py-2.5 rounded-xl bg-transparent text-red-400 text-sm font-medium ring-1 ring-inset ring-red-500/30 hover:bg-red-500/10 active:scale-[0.98] transition"
                                style={{ touchAction: "manipulation" }}
                            >
                                {locale === "en" ? "Delete my account" : "退会する"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <DeleteAccountModal
                openerRef={deleteAccountBtnRef}
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={() => void handleDeleteAccount()}
                locale={locale}
                deleting={deletingAccount}
            />
        </main>
    );
}
