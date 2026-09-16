"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, UserCircleIcon, CameraIcon, MusicalNoteIcon, MagnifyingGlassIcon, XMarkIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { usernameLengthError, USERNAME_MAX } from "../../../lib/utils/usernameRule";
import { userFetch, readApiError, sessionErrorMessage } from "../../../lib/utils/api";
import { changedFields } from "../../../lib/utils/changedFields";
import { sanitizeProfile } from "../../../lib/utils/profileShape";
import { parseMusicEmbed, musicServiceLabel, type SongResult } from "../../../lib/utils/music";
import { toUploadSafeFile, AVATAR_MAX_PX, COVER_MAX_PX } from "../../../lib/utils/image";
import { unstrippableMessage, gifRejectedMessage } from "../../../lib/utils/uploadRejection";
import { useSongSearch } from "../../../lib/hooks/useSongSearch";
import { isImeKey } from "../../../lib/utils/ime";
import { log } from "../../../lib/utils/log";
import { useMusic } from "../../music/MusicContext";
import DeleteAccountModal from "../../components/DeleteAccountModal";
import { changePassword, PASSWORD_RULE_MESSAGE, getCurrentEmail, startEmailChange, confirmEmailChange } from "../../../lib/auth/cognito";
import BlockedUsers from "./BlockedUsers";
import SongArtwork from "../../components/SongArtwork";
import { loginWithNext } from "../../../lib/routes";
import { publicImageUrl } from "@/lib/utils/seo";
import SongSearchError from "../../components/SongSearchError";

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

/** @名に使える形へ寄せる（英小文字・数字・`_` のみ）。入力欄の説明と対 */
function cleanUsername(v: string): string {
    return v.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export default function ProfileEditPage() {
    const { isAuthenticated, loading, deleteAccount } = useAuth();
    const { locale } = useLocale();
    const router = useRouter();
    const { showToast } = useToast();
    const { stop: stopGlobalMusic } = useMusic();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // パスワード変更。**プロフィールの保存とは別の口**——`handleSave` は
    // プロフィールの項目を送るもので、そこへ混ぜると「自己紹介を直したら
    // パスワードも送られる」形になる
    const [curPassword, setCurPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [changingPassword, setChangingPassword] = useState(false);

    // メールアドレス変更。**2段**——新しいアドレスにコードを送り、
    // そのコードで確定する。確定するまで古いアドレスでログインできる
    // （プールの `AttributesRequireVerificationBeforeUpdate` が効いている。
    //  本番に入っていることは `diagnose` で実測した）
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    const [newEmail, setNewEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    // コードを送った先。**送ったアドレスを覚えておく**——欄を書き換えられても
    // 「どこに届いたか」を言い続けるため
    const [emailPending, setEmailPending] = useState<string | null>(null);
    const [emailBusy, setEmailBusy] = useState(false);

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
    // 変換中かどうか（IME-8。下の入力欄のコメントを見よ）
    const usernameComposing = useRef(false);
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
    // 検索そのものは共有のフック（3画面で同じものを書いていた）
    const {
        results: songResults, searching, error: searchError,
        search: runSongSearch,
    } = useSongSearch();
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

    /**
     * 打ちかけがあるか。**送り返す前に見る。**
     *
     * この画面は会員ページの門を**手書きで写して**いて、
     * `useMemberGate` が持っている「打ちかけがあるときは送り返さない」
     * だけが抜けていた（`/user/edit` `/user/upload` `/user/drafts`
     * `/user/albums` は本物を使っている）。自己紹介を書いている最中に
     * **別タブでログアウト・退会**すると、`storage` イベントで
     * `isAuthenticated` が落ち、`router.replace` が画面ごと作り直して
     * **打った文章が消える**。
     *
     * 見るのは**打って入れる項目**だけ（テーマ色・曲は選び直せる）。
     * 誤って true になっても、倒れる先は「送り返さずに理由を出す」＝安全側。
     */
    //
    // **両側とも `trim()` して比べる。** サーバーは保存時に
    // `displayName` / `bio` / `instagram` / `website` を trim して返す
    // （`api-user/src/userProfile.ts`）が、画面は打った文字をそのまま
    // 持つ。素で比べると**末尾に空白を1つ打って保存しただけで、成功後も
    // true のまま固まる**——「保存しました」の直後に「この内容は保存
    // できません」と言い、以後この画面では送り返しが永久に効かない。
    const hasUnsavedWork = !!profile && (
        username.trim().toLowerCase().replace(/^@/, "") !== (profile.username ?? "")
        || displayName.trim() !== (profile.displayName ?? "").trim()
        || bio.trim() !== (profile.bio ?? "").trim()
        || instagram.trim() !== (profile.instagram ?? "").trim()
        || website.trim() !== (profile.website ?? "").trim()
    );

    useEffect(() => {
        // **打ちかけがあるときは送り返さない**（`useMemberGate` と同じ判断）。
        // ログインが切れた側はどのみち保存できないが、書いたものを消して
        // よい理由にはならない。保存できないことは下のトーストで伝える
        if (!loading && !isAuthenticated && !hasUnsavedWork) {
            router.replace(loginWithNext(window.location.pathname + window.location.search));
        }
    }, [isAuthenticated, loading, router, hasUnsavedWork]);

    // 留めたぶん、**保存できないことを言う**（`/user/edit` と同じ形）。
    // 一度だけ出す（描画のたびに出すと読めない）
    const toldSignedOut = useRef(false);
    useEffect(() => {
        // **ログインし直したら札を下ろす。** 下ろさないと二度目が無言になる
        if (isAuthenticated) { toldSignedOut.current = false; return; }
        if (loading || !hasUnsavedWork || toldSignedOut.current) return;
        toldSignedOut.current = true;
        showToast(locale === "en"
            ? "You are signed out. This can't be saved yet — sign in again in another tab, then save."
            : "ログインが切れました。この内容は保存できません。別のタブでログインし直してから、もう一度保存してください", "error");
    }, [isAuthenticated, loading, hasUnsavedWork, locale, showToast]);

    useEffect(() => {
        if (!isAuthenticated) return;
        void (async () => {
            try {
                const res = await userFetch("/user/profile");
                if (res.ok) {
                    // **形を確かめてから入れる。** `as UserProfile` は実行時に
                    // 何も確かめないので、オブジェクトが入力欄に入って
                    // `[object Object]` になり、保存で焼き付いていた。
                    // 本文が `null` の 200 も、以前は `data.displayName` の
                    // 例外を catch が拾って「読み込めませんでした」に
                    // なっていた——同じ結果を、例外に頼らずに出す
                    const data = sanitizeProfile<UserProfile>(await res.json(), "GET /user/profile");
                    if (!data) {
                        setLoadFailed(true);
                        return;
                    }
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
        // **GIF は選んだ時点で断る。** `toUploadSafeFile` は GIF を必ず
        // `UnstrippableFileError` にするので、進めても必ず失敗する
        // ——プレビューが一瞬出てから断られる形だった。
        // アップロード画面（アイコン）とストーリーは選択時に断っている
        // ＝この2か所（カバー・アバター）だけ残っていた
        if (file.type === "image/gif") {
            showToast(gifRejectedMessage(locale), "error");
            return;
        }
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
            showToast(sessionErrorMessage(e) ?? "カバー写真のアップロードに失敗しました", "error");
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
        // **GIF は選んだ時点で断る。** `toUploadSafeFile` は GIF を必ず
        // `UnstrippableFileError` にするので、進めても必ず失敗する
        // ——プレビューが一瞬出てから断られる形だった。
        // アップロード画面（アイコン）とストーリーは選択時に断っている
        // ＝この2か所（カバー・アバター）だけ残っていた
        if (file.type === "image/gif") {
            showToast(gifRejectedMessage(locale), "error");
            return;
        }

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
            showToast(sessionErrorMessage(e) ?? "アバターのアップロードに失敗しました", "error");
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
        // **空の語では何もしない（試聴も止めない）。** 入力欄の Enter は
        // 空でも素通りするので、ここで見ないと「語を消して Enter」で
        // 再生が止まる（StoriesBar と同じ）。
        if (!songQuery.trim()) return;
        // **試聴を止めてから検索する**（結果が入れ替わっても前の曲が鳴り続ける）。
        // 追い越しを捨てる仕掛けは `useSongSearch` が持っている。
        stopPreview();
        await runSongSearch(songQuery);
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
        // **@名の長さも、送る前に確かめる。** 画面は `maxLength` で**上限だけ**
        // 縛り、**下限3文字を一切見ていなかった**。`ab` のまま保存すると
        // サーバーは**書き込みの前に** 400 を返す（`userProfile.ts:522`）ので、
        // **同じ保存に乗せた自己紹介・表示名・テーマ色も1件も保存されない**。
        // すぐ下の曲のリンクと同じ形に揃える（文言はサーバーと同じもの）。
        // 予約語はサーバーだけが持つ一覧なので、こちらには写さない。
        const nameError = usernameLengthError(username, locale !== "en");
        if (nameError) {
            showToast(nameError, "error");
            return;
        }
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
        } catch (e) {
            // **セッション切れを塗り潰さない。** 裸の catch だった頃は
            // 「保存に失敗しました。」だけが出るので、**再ログインすれば
            // 直ると分からず**同じ操作を繰り返すことになった。
            // 同じファイルのアバター・カバー（`handleCoverChange` ほか）は
            // 前からこう書いてある——対の乖離だった
            showToast(sessionErrorMessage(e)
                ?? (locale === "en" ? "Failed to save." : "保存に失敗しました。"), "error");
        } finally {
            setSaving(false);
        }
    };

    // いま登録されているアドレスを出す（何から何に変えるのかが分からないと押せない）。
    // **変えたあとは読み直さない**——ID トークンは作られた時点の写しで、
    // 次に更新されるまで古い値のまま（`getCurrentEmail` のコメントを見よ）
    useEffect(() => {
        let aborted = false;
        void (async () => {
            const e = await getCurrentEmail();
            if (!aborted) setCurrentEmail(e);
        })();
        return () => { aborted = true; };
    }, []);

    const handleStartEmailChange = async () => {
        if (emailBusy) return;
        const next = newEmail.trim();
        // 送る前に断れるものだけ断る（形の細かい判定はサーバーに任せる）
        if (!next) return;
        if (next === currentEmail) {
            showToast(locale === "en" ? "That is already your email address." : "いまのメールアドレスと同じです", "error");
            return;
        }
        setEmailBusy(true);
        try {
            const result = await startEmailChange(next);
            if (!result.success) {
                showToast(result.error || (locale === "en" ? "Failed to send the code." : "確認コードを送れませんでした"), "error");
                return;
            }
            setEmailPending(next);
            setEmailCode("");
            showToast(locale === "en"
                ? `A confirmation code was sent to ${next}. Your current address still works until you confirm.`
                : `${next} に確認コードを送りました。確定するまでは、いまのアドレスでログインできます`, "success");
        } finally {
            setEmailBusy(false);
        }
    };

    const handleConfirmEmailChange = async () => {
        if (emailBusy || !emailCode.trim()) return;
        setEmailBusy(true);
        try {
            const result = await confirmEmailChange(emailCode);
            if (!result.success) {
                showToast(result.error || (locale === "en" ? "Failed to change your email." : "メールアドレスを変更できませんでした"), "error");
                return;
            }
            // **自分が知っている新しい値を出す**（トークンはまだ古い）
            setCurrentEmail(emailPending);
            setEmailPending(null);
            setNewEmail("");
            setEmailCode("");
            showToast(locale === "en"
                ? "Your email address has been changed. Use it to sign in from now on."
                : "メールアドレスを変更しました。次からはこのアドレスでログインしてください", "success");
        } finally {
            setEmailBusy(false);
        }
    };

    /**
     * **送る前に断るのは、こちらで確かめられる条件だけ。**
     *
     * プールの規則は8文字以上＋英大小・数字・記号（`provision-env.js:410`）だが、
     * **本番のプールが今もその設定かはコードからは確かめられない**——
     * ここで規則を写して厳しく断ると、プールが通すパスワードを画面だけが
     * 拒む側に倒れる（台帳が何度も記録している「正当な操作を殺す」）。
     * なので長さと空欄と「同じもの」だけ見て、残りはサーバーの
     * `InvalidPasswordException` に言わせる（`changePasswordErrorMessage` が
     * `PASSWORD_RULE_MESSAGE` に訳す）。
     */
    const handleChangePassword = async () => {
        if (changingPassword) return;
        if (!curPassword || !newPassword) return;
        if (newPassword.length < 8) {
            showToast(PASSWORD_RULE_MESSAGE, "error");
            return;
        }
        if (newPassword === curPassword) {
            showToast(locale === "en" ? "The new password is the same as the current one." : "いまのパスワードと同じです", "error");
            return;
        }
        setChangingPassword(true);
        try {
            const result = await changePassword(curPassword, newPassword);
            if (!result.success) {
                showToast(result.error || (locale === "en" ? "Failed to change password." : "パスワードを変更できませんでした"), "error");
                return;
            }
            // **打った中身を画面に残さない。** 次に誰かがこの端末を触ったとき、
            // 入力欄に残っていると読める（`type="password"` でも devtools で見える）
            setCurPassword("");
            setNewPassword("");
            // Cognito はパスワードを変えてもいまのトークンを失効させないので、
            // ログインし直す必要は無い。**そう言わないと「他の端末はどうなる？」に
            // 答えられない**ので、そこまで書く
            showToast(locale === "en"
                ? "Password changed. You stay signed in on this device; other devices stay signed in until their session expires."
                : "パスワードを変更しました。この端末はログインしたままです（他の端末は、そのセッションが切れるまでログインしたままになります）", "success");
        } finally {
            setChangingPassword(false);
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
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">プロフィール編集</h1>
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const currentAvatarUrl = profile?.userId && CLOUDFRONT_URL
        ? publicImageUrl(`${CLOUDFRONT_URL}/profiles/${encodeURIComponent(profile.userId)}`)
        : null;
    const currentCoverUrl = profile?.userId && CLOUDFRONT_URL
        ? publicImageUrl(`${CLOUDFRONT_URL}/profiles/${encodeURIComponent(profile.userId)}/cover`)
        : null;

    // **ボタンの名前を状態で分けるための旗。** 描き分けの式と同じ材料から
    // 作る（`src` の式そのものは触らない——`imageOriginSites.test.ts` の
    // 免除一覧が式の綴りで突き合わせているので、`!` を足すだけで落ちる。
    // 実際に落として気づいた）。**片方だけずれる変異は、対テストが
    // 「出ている絵」と「名前の言葉」を突き合わせて捕まえる**
    const hasCover = !!coverPreview || (!!currentCoverUrl && !coverError);

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
                    className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/60 transition-colors mb-10"
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
                    {/* **カバーを一度でも設定すると、このボタンは名前を失う。**
                        中身は `alt=""` の `<img>` とアイコンだけになるので、
                        読み上げでは「ボタン」としか言われない（未設定のときだけ
                        「カバー写真を追加」の文字が中にある）。**すぐ下の
                        アバターのボタンは前から `aria-label` を持っている**
                        ——対になっている片方だけ漏れていた。
                        文言は見えている文字と食い違わないよう状態で分ける
                        （未設定のときは中の文字と同じ「追加」）。 */}
                    <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        disabled={coverUploading}
                        aria-label={hasCover
                            ? (locale === "en" ? "Change cover photo" : "カバー写真を変更")
                            : (locale === "en" ? "Add cover photo" : "カバー写真を追加")}
                        className="relative w-full h-28 rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 transition-colors group"
                    >
                        {coverPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverPreview} alt="" className="w-full h-full object-cover" />
                        ) : currentCoverUrl && !coverError ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={currentCoverUrl} alt="" className="w-full h-full object-cover" onError={() => setCoverError(true)} />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-white/50">
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
                    <p className="text-xs text-white/50 mt-2">
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
                        <label className={labelClass} htmlFor="profile-username">
                            {locale === "en" ? "Username" : "ユーザー名"}
                        </label>
                        <div className="flex items-center gap-1.5">
                            <span className="text-white/50 text-sm">@</span>
                            <input
                                id="profile-username"
                                type="text"
                                value={username}
                                // **変換中は書き換えない。** 毎打鍵で値を作り直すと
                                // IME の変換が壊れ、かな入力のままだと**打っても
                                // 画面に何も出ない**（実ブラウザで `compositionstart`
                                // が1回であるべきところ4回になることを確認）。
                                // 利用者からは「入力できない欄」に見える。
                                // 変換中はそのまま見せ、確定した時点でふるいに掛ける
                                // （使える文字は下の説明に書いてある）。
                                onCompositionStart={() => { usernameComposing.current = true; }}
                                onCompositionEnd={e => {
                                    usernameComposing.current = false;
                                    setUsername(cleanUsername(e.currentTarget.value));
                                }}
                                onChange={e => setUsername(
                                    usernameComposing.current ? e.target.value : cleanUsername(e.target.value))}
                                maxLength={USERNAME_MAX}
                                placeholder="travel_photo"
                                className={inputClass}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                // **使える文字と長さは、この文にしか書いていない。**
                                // 結ばないと読み上げに届かず、打っても入らない理由が分からない
                                aria-describedby="profile-username-rule"
                            />
                        </div>
                        <p id="profile-username-rule" className="text-[11px] text-white/50 mt-1">
                            {locale === "en"
                                ? "Lowercase letters, numbers and _ (3-20). Shown under your name."
                                : "英小文字・数字・_ の3〜20文字。プロフィールの名前の下に表示されます。"}
                        </p>
                    </div>

                    <div>
                        <label className={labelClass} htmlFor="profile-display-name">
                            {locale === "en" ? "Display name" : "表示名"}
                        </label>
                        <input
                            id="profile-display-name"
                            type="text"
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            maxLength={100}
                            placeholder={locale === "en" ? "Your name" : "名前"}
                            className={inputClass}
                        />
                    </div>

                    <div>
                        <label className={labelClass} htmlFor="profile-bio">
                            {locale === "en" ? "Bio" : "自己紹介"}
                        </label>
                        <textarea
                            id="profile-bio"
                            value={bio}
                            onChange={e => setBio(e.target.value)}
                            maxLength={300}
                            rows={4}
                            placeholder={locale === "en" ? "Tell us about yourself..." : "旅と写真が好きです…"}
                            className={`${inputClass} resize-none`}
                        />
                        <div className="text-right text-xs text-white/50 mt-1">{bio.length}/300</div>
                    </div>


                    <div>
                        {/* **ここは `<label>` にしない。** 中身は見本の丸ボタンの集まりで、
                            `<label>` は単一の部品にしか結べない。見出しとして結ぶ */}
                        <p className={labelClass} id="profile-theme-color">
                            {locale === "en" ? "Theme color" : "テーマカラー"}
                        </p>
                        <div role="group" aria-labelledby="profile-theme-color" className="flex flex-wrap items-center gap-2.5">
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
                        <p className="text-xs text-white/50 mt-1.5">
                            {locale === "en"
                                ? "Colors your avatar ring and accents. The last swatch opens a full color picker."
                                : "アバターのリングなどの色になります。右端の丸を押すとパレットから自由に選べます。"}
                        </p>
                    </div>

                    <div>
                        <label className={labelClass} htmlFor="profile-instagram">Instagram</label>
                        <div className="flex items-center">
                            <span className="text-white/50 text-sm px-3 py-3 bg-white/5 border border-r-0 border-white/10 rounded-l-lg">@</span>
                            <input
                                id="profile-instagram"
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
                        <label className={labelClass} htmlFor="profile-website">
                            {locale === "en" ? "Website" : "ウェブサイト"}
                        </label>
                        <input
                            id="profile-website"
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
                                        {/* **保存された値をそのまま読み込まない。** ここは
                                            `GET /user/profile` が返した行そのもので、許可リスト
                                            以前の曲は任意のホストのまま残りうる（`SongArtwork`） */}
                                        <SongArtwork src={song.artwork} className="w-9 h-9 rounded-md object-cover bg-white/10 flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs text-white truncate">{song.title}</p>
                                            <p className="text-[11px] text-white/50 truncate">{song.artist}</p>
                                        </div>
                                        <button type="button" onClick={() => moveSong(idx, -1)} disabled={idx === 0}
                                            aria-label={locale === "en" ? "Move up" : "上へ"}
                                            className="px-1.5 py-1 text-white/50 hover:text-white disabled:opacity-25 active:scale-90 transition text-sm">↑</button>
                                        <button type="button" onClick={() => moveSong(idx, 1)} disabled={idx === selectedSongs.length - 1}
                                            aria-label={locale === "en" ? "Move down" : "下へ"}
                                            className="px-1.5 py-1 text-white/50 hover:text-white disabled:opacity-25 active:scale-90 transition text-sm">↓</button>
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
                                <p className="text-xs text-white/50 -mt-1">
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
                                            onKeyDown={e => { if (e.key === "Enter" && !isImeKey(e.nativeEvent)) { e.preventDefault(); void handleSongSearch(); } }}
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
                                    <SongSearchError />
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
                                                    <SongArtwork src={song.artwork} className="absolute inset-0 w-full h-full object-cover" />
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
                                                    <span className="text-[11px] text-white/50 flex-shrink-0 pl-2">{locale === "en" ? "Add" : "追加"}</span>
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
                                className="w-full flex items-center justify-between text-xs text-white/50 hover:text-white/70 transition pt-2"
                            >
                                <span>{locale === "en" ? "Or paste a link (full song / pick a section)" : "またはリンクを貼る（フル尺・区間指定）"}</span>
                                <ChevronDownIcon className={`w-4 h-4 transition-transform ${showUrlMethod ? "rotate-180" : ""}`} />
                            </button>

                            {selectedSongs.length > 0 && (songUrl.trim() || showUrlMethod) && (
                                <p className="text-[11px] text-white/50 pt-2">
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
                                                            <label className="block text-[11px] text-white/50 mb-1" htmlFor="profile-song-start">{locale === "en" ? "Start (m:ss)" : "開始 (m:ss)"}</label>
                                                            <input
                                                                id="profile-song-start"
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
                                                            <label className="block text-[11px] text-white/50 mb-1" htmlFor="profile-song-end">{locale === "en" ? "End (m:ss)" : "終了 (m:ss)"}</label>
                                                            <input
                                                                id="profile-song-end"
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
                                                    <p className="text-[11px] text-white/50">
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

                    {/* ブロックした人（1人も居なければ何も描かない）。
                        **解除できる場所がここしか無い**——ストーリーの返信から
                        ブロックできるようにしたぶん、戻す口が要る */}
                    <BlockedUsers locale={locale as "ja" | "en"} />

                    {/* アカウント: パスワードの変更。
                        **これが無かった間、変える手段は「ログアウト →
                        パスワードをお忘れですか → メールのコード」だけだった**
                        ——漏洩を疑ったその場で替えられず、しかも「忘れた」を
                        装う必要があった。プロフィールの保存とは別のボタンにする
                        （自己紹介を直すたびにパスワードを送らない）。 */}
                    <div className="mt-10 pt-6 border-t border-white/10">
                        <p className="text-[11px] tracking-widest uppercase text-white/40 mb-2">
                            {locale === "en" ? "Account" : "アカウント"}
                        </p>
                        <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-4 space-y-3">
                            {/* メールアドレスの変更。
                                **メールがログインID**（プールの `AliasAttributes` が
                                email）なので、変える手段が無いと「メールを変えた人は
                                アカウントごと失う」——退会して作り直す以外に無く、
                                写真・いいね・フォロワー・共有したURLが全部消えていた。

                                **2段にする。** 新しいアドレスにコードを送り、その
                                コードで確定する。**確定するまで古いアドレスでログイン
                                できる**（プールの `AttributesRequireVerificationBeforeUpdate`
                                が効いている。本番に入っていることは診断で実測した）
                                ——これが無いと、コードを入れる前にタブを閉じた人が
                                締め出される。 */}
                            <p className="text-sm font-semibold text-white/90">
                                {locale === "en" ? "Change email address" : "メールアドレスを変更"}
                            </p>
                            <p className="text-xs text-white/50 leading-relaxed">
                                {locale === "en" ? "Sign-in address" : "ログインに使うアドレス"}:{" "}
                                <span className="text-white/80">{currentEmail ?? (locale === "en" ? "(loading)" : "（読み込み中）")}</span>
                            </p>
                            {emailPending === null ? (
                                <>
                                    <div>
                                        <label className={labelClass} htmlFor="profile-new-email">
                                            {locale === "en" ? "New email address" : "新しいメールアドレス"}
                                        </label>
                                        <input
                                            id="profile-new-email"
                                            type="email"
                                            // **本人の連絡先**なので `email`（パスワード管理を汚さない）
                                            autoComplete="email"
                                            inputMode="email"
                                            aria-describedby="profile-email-note"
                                            value={newEmail}
                                            onChange={(e) => setNewEmail(e.target.value)}
                                            disabled={emailBusy}
                                            className={inputClass}
                                        />
                                        <p id="profile-email-note" className="mt-1.5 text-xs text-white/50 leading-relaxed">
                                            {locale === "en"
                                                ? "We'll send a confirmation code to the new address. Your current address keeps working until you confirm."
                                                : "新しいアドレスに確認コードを送ります。確定するまでは、いまのアドレスでログインできます"}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleStartEmailChange()}
                                        disabled={emailBusy || !newEmail.trim()}
                                        className="w-full py-2.5 rounded-xl bg-white/5 text-white text-sm font-medium ring-1 ring-inset ring-white/15 hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                                    >
                                        {emailBusy && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                        {locale === "en" ? "Send confirmation code" : "確認コードを送る"}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <label className={labelClass} htmlFor="profile-email-code">
                                            {locale === "en" ? `Code sent to ${emailPending}` : `${emailPending} に送ったコード`}
                                        </label>
                                        <input
                                            id="profile-email-code"
                                            type="text"
                                            // 届いたコードを自動で入れられるようにする
                                            // （`/login` `/signup` の確認コードと同じ）
                                            autoComplete="one-time-code"
                                            inputMode="numeric"
                                            value={emailCode}
                                            onChange={(e) => setEmailCode(e.target.value)}
                                            disabled={emailBusy}
                                            className={inputClass}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleConfirmEmailChange()}
                                        disabled={emailBusy || !emailCode.trim()}
                                        className="w-full py-2.5 rounded-xl bg-white/5 text-white text-sm font-medium ring-1 ring-inset ring-white/15 hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                                    >
                                        {emailBusy && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                        {locale === "en" ? "Change email address" : "メールアドレスを変更する"}
                                    </button>
                                    {/* **やめる道を残す。** コードが届かない／打ち間違えた人が
                                        ここで詰まると、設定画面から出るしか無くなる */}
                                    <button
                                        type="button"
                                        onClick={() => { setEmailPending(null); setEmailCode(""); }}
                                        disabled={emailBusy}
                                        className="w-full py-2 text-xs text-white/50 hover:text-white/80 transition disabled:opacity-40"
                                        style={{ touchAction: "manipulation" }}
                                    >
                                        {locale === "en" ? "Cancel and use a different address" : "やめる（別のアドレスにする）"}
                                    </button>
                                </>
                            )}

                            <div className="pt-1 border-t border-white/10" />

                            <p className="text-sm font-semibold text-white/90">
                                {locale === "en" ? "Change password" : "パスワードを変更"}
                            </p>
                            <div>
                                <label className={labelClass} htmlFor="profile-current-password">
                                    {locale === "en" ? "Current password" : "いまのパスワード"}
                                </label>
                                <input
                                    id="profile-current-password"
                                    type="password"
                                    // ブラウザとパスワード管理に「いまのもの」と伝える。
                                    // 付けないと新しい方を保存候補にされる
                                    autoComplete="current-password"
                                    value={curPassword}
                                    onChange={(e) => setCurPassword(e.target.value)}
                                    disabled={changingPassword}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className={labelClass} htmlFor="profile-new-password">
                                    {locale === "en" ? "New password" : "新しいパスワード"}
                                </label>
                                <input
                                    id="profile-new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    // **満たせないと進めない条件は、読み上げにも渡す**
                                    // （`/signup` のパスワード条件と同じ形）
                                    aria-describedby="profile-password-rule"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    disabled={changingPassword}
                                    className={inputClass}
                                />
                                <p id="profile-password-rule" className="mt-1.5 text-xs text-white/50 leading-relaxed">
                                    {PASSWORD_RULE_MESSAGE}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void handleChangePassword()}
                                // **押せるのに必ず失敗する形にしない。** 空欄のうちは
                                // 押しても往復するだけ（台帳の `903279da` と同じ判断）
                                disabled={changingPassword || !curPassword || !newPassword}
                                className="w-full py-2.5 rounded-xl bg-white/5 text-white text-sm font-medium ring-1 ring-inset ring-white/15 hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {changingPassword && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                {changingPassword
                                    ? (locale === "en" ? "Changing..." : "変更中...")
                                    : (locale === "en" ? "Change password" : "パスワードを変更する")}
                            </button>
                        </div>
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
                            <p className="text-xs text-white/50 leading-relaxed mb-3">
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
