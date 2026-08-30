"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, XMarkIcon, MusicalNoteIcon } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import UserAvatar from "../UserAvatar";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { toUploadSafeFile, UnstrippableFileError } from "../../../lib/utils/image";
import { searchSongs, type SongResult } from "../../../lib/utils/music";
import { startFromPointer, clampStart } from "../../../lib/utils/songTrim";
import { log } from "../../../lib/utils/log";
import {
    groupStories, hasUnseen, loadSeenStoryIds, markStorySeen, SEEN_STORAGE_KEY,
    type Story, type StoryGroup,
} from "../../../lib/stories";
import StoryViewer from "./StoryViewer";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";
import { useMusic } from "../../music/MusicContext";


// 画像ストーリーの表示秒数。投稿者が選べる（既定5秒）
const STORY_DEFAULT_DURATION_SEC = 5;
const STORY_DURATION_CHOICES = [3, 5, 7, 10, 15];
// iTunes プレビューの長さ。「好きな部分」の開始位置はこの範囲で選ぶ
const SONG_PREVIEW_SEC = 30;

// 0:07 形式（プレビューは30秒なので分は常に0）
const fmtSec = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_VIDEO_SECONDS = 60;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// 未読リング（Instagram のブランドグラデーション）と既読リング（上品なグレー）
const RING_UNSEEN = "linear-gradient(45deg, #FEDA75, #FA7E1E, #D62976, #962FBF, #4F5BD5)";
const RING_SEEN = "#3a3a3d";

/**
 * 動画のメタデータが返らないときの打ち切り。
 *
 * `loadedmetadata` も `error` も鳴らないまま終わる場合がある（メモリが
 * 足りない iOS Safari など。画像側の `loadImageFromFile` に同じ理由で
 * 同じ守りが入っている）。**動画側だけ抜けていた**ので、そうなると
 * 選んだのに下書きも出ずエラーも出ず、blob URL（最大50MB）が解放
 * されないまま溜まる。失敗として扱えば、呼び出し側の catch が
 * 「動画を読み込めませんでした」を出すところまで進む。
 */
const VIDEO_METADATA_TIMEOUT_MS = 15000;

// 動画の再生時間を取得（メタデータのみ読み込み）
function getVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.preload = "metadata";
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            fn();
        };
        const timer = setTimeout(
            () => finish(() => reject(new Error("動画の読み込みがタイムアウトしました"))),
            VIDEO_METADATA_TIMEOUT_MS,
        );
        video.onloadedmetadata = () => finish(() => resolve(video.duration));
        video.onerror = () => finish(() => reject(new Error("動画を読み込めません")));
        video.src = url;
    });
}

type Draft = {
    file: File;
    previewUrl: string;
    mediaType: "image" | "video";
};

export default function StoriesBar() {
    const { isAuthenticated, userId } = useAuth();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const { stop: stopGlobalMusic } = useMusic();

    const [groups, setGroups] = useState<StoryGroup[]>([]);
    // 取得の失敗を「誰も投稿していない」と混ぜない（コメント一覧と同じ型）
    const [loadError, setLoadError] = useState(false);
    const [seen, setSeen] = useState<Set<string>>(new Set());
    const [viewerGroup, setViewerGroup] = useState<number | null>(null);
    const [posting, setPosting] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [caption, setCaption] = useState("");
    // ストーリーBGM（任意・1曲）
    const [draftSong, setDraftSong] = useState<SongResult | null>(null);
    const [songPickerOpen, setSongPickerOpen] = useState(false);
    const [songQuery, setSongQuery] = useState("");
    const [songResults, setSongResults] = useState<SongResult[]>([]);
    const [songSearching, setSongSearching] = useState(false);
    const [songSearchError, setSongSearchError] = useState(false);
    // 曲の「好きな部分」= 30秒プレビュー内の開始位置（秒）
    const [songStart, setSongStart] = useState(0);
    // 画像ストーリーの表示秒数（投稿者が選ぶ）
    const [durationSec, setDurationSec] = useState(STORY_DEFAULT_DURATION_SEC);

    // 試聴用オーディオ（検索結果も選択中の曲も、常に1つだけ鳴らす）
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    // 再生位置（秒）。選んだ範囲のどこを鳴らしているかを見せる
    const [previewTime, setPreviewTime] = useState(0);
    // 繰り返す範囲。timeupdate から最新値を読むため ref に持つ
    const loopRangeRef = useRef<{ start: number; end: number } | null>(null);

    const stopPreview = useCallback(() => {
        previewAudioRef.current?.pause();
        loopRangeRef.current = null;
        setPreviewingId(null);
    }, []);

    /**
     * 曲を試聴する。loopSec を渡すと start〜start+loopSec だけを繰り返す
     * （インスタと同じで、ストーリーに実際に乗る範囲がそのまま聴ける）。
     */
    const playPreview = useCallback((song: SongResult, startSec = 0, loopSec?: number) => {
        // BGM が鳴っていたら止める。止めないとミニプレイヤーの曲と試聴が
        // 同時に鳴り、しかもミニプレイヤーは再生中のまま見える。
        // この下書きモーダルは z-[95] でミニプレイヤー（z-40）を覆うので、
        // 止める手段が画面上に無い（リロードするまで2曲鳴り続ける）。
        // 同じ場面の app/user/profile/page.tsx の togglePreview と、
        // StoryViewer の冒頭には既に同じ一行が入っている。ここだけ抜けていた。
        stopGlobalMusic();
        let a = previewAudioRef.current;
        if (!a) {
            a = new Audio();
            a.onended = () => {
                const range = loopRangeRef.current;
                const el = previewAudioRef.current;
                if (range && el) {
                    try { el.currentTime = range.start; } catch { /* ignore */ }
                    void el.play().catch(() => setPreviewingId(null));
                    return;
                }
                setPreviewingId(null);
            };
            a.ontimeupdate = () => {
                const el = previewAudioRef.current;
                if (!el) return;
                setPreviewTime(el.currentTime);
                const range = loopRangeRef.current;
                if (range && el.currentTime >= range.end) {
                    try { el.currentTime = range.start; } catch { /* ignore */ }
                }
            };
            previewAudioRef.current = a;
        }
        loopRangeRef.current = loopSec
            ? { start: startSec, end: Math.min(SONG_PREVIEW_SEC, startSec + loopSec) }
            : null;
        if (a.src !== song.previewUrl) a.src = song.previewUrl;
        try { a.currentTime = startSec; } catch { /* seek 未対応は無視 */ }
        setPreviewTime(startSec);
        void a.play()
            .then(() => setPreviewingId(song.id))
            .catch(() => setPreviewingId(null)); // 自動再生ブロック等
    }, [stopGlobalMusic]);

    // 画面を離れるときに音を止める
    useEffect(() => () => { previewAudioRef.current?.pause(); }, []);

    // 曲を流す長さ＝ストーリーの表示時間（動画は長さが可変なのでプレビュー全体を使う）
    const songWindowSec = draft?.mediaType === "video" ? SONG_PREVIEW_SEC : durationSec;
    const maxSongStart = Math.max(0, SONG_PREVIEW_SEC - songWindowSec);

    // 「好きな部分」バーのドラッグ
    const trimBarRef = useRef<HTMLDivElement | null>(null);
    const [trimDragging, setTrimDragging] = useState(false);

    /** 開始秒を反映し、再生中なら音もその場で追従させる（止めない） */
    const applyTrimStart = useCallback((raw: number) => {
        const next = clampStart(raw, songWindowSec, SONG_PREVIEW_SEC);
        setSongStart(next);
        const a = previewAudioRef.current;
        if (a && draftSong && previewingId === draftSong.id) {
            try { a.currentTime = next; } catch { /* ignore */ }
            setPreviewTime(next);
        }
    }, [songWindowSec, draftSong, previewingId]);

    const applyTrimFromPointer = useCallback((clientX: number) => {
        const rect = trimBarRef.current?.getBoundingClientRect();
        if (!rect) return;
        applyTrimStart(startFromPointer(clientX, rect.left, rect.width, songWindowSec, SONG_PREVIEW_SEC));
    }, [applyTrimStart, songWindowSec]);

    // 再生中に範囲や長さを変えたら、繰り返す区間も追従させる
    useEffect(() => {
        if (draftSong && previewingId === draftSong.id) {
            loopRangeRef.current = { start: songStart, end: Math.min(SONG_PREVIEW_SEC, songStart + songWindowSec) };
        }
    }, [songStart, songWindowSec, draftSong, previewingId]);

    // 検索の世代。**打ち消したはずの結果が出る**のを止める。
    // 順序の保証が無かった頃は、遅い1回目の応答が速い2回目より後に届くと
    // 前の語の結果で上書きされていた（lib/hooks/useUserSearch.ts に
    // 正しい形がある。同じ仕掛けを使う）。
    const songSearchGen = useRef(0);
    const searchDraftSongs = async () => {
        const q = songQuery.trim();
        if (!q) return;
        // **試聴を止めてから引き直す。** 結果が差し替わると、鳴っている曲の
        // 停止ボタンごと画面から消える——下書きは z-[95] でミニプレイヤーも
        // 覆うので、下書きを閉じるまで止められない。プロフィール側の
        // `handleSongSearch` は最初からこの形（対の乖離だった）。
        stopPreview();
        const gen = ++songSearchGen.current;
        setSongSearching(true);
        setSongSearchError(false);
        try {
            const found = await searchSongs(q);
            if (gen !== songSearchGen.current) return;   // もっと新しい検索が走っている
            setSongResults(found);
        } catch {
            if (gen === songSearchGen.current) {
                setSongResults([]);
                setSongSearchError(true);   // 0件と同じ無反応にしない（SW-b6）
            }
        } finally {
            if (gen === songSearchGen.current) setSongSearching(false);
        }
    };
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadStories = useCallback(async () => {
        try {
            // ストーリーはログインユーザー限定。認証トークン付きで取得する。
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch("/stories");
            if (!res.ok) {
                setLoadError(true);
                return;
            }
            const data = await res.json() as Story[];
            if (Array.isArray(data)) {
                // 空配列でも成功は成功（全ストーリーが期限切れの朝など）。
                // ここで下ろさないと、成功なのにエラー行が復活する
                setGroups(groupStories(data, userId));
                setLoadError(false);
            }
        } catch (e) {
            log.warn("stories fetch error:", e);
            setLoadError(true);
        }
    }, [userId]);

    useEffect(() => {
        // 未ログインではストーリーを取得も表示もしない
        if (!isAuthenticated) {
            setGroups([]);
            setLoadError(false);   // 前のセッションの失敗表示を持ち越さない
            return;
        }
        setSeen(loadSeenStoryIds());
        void loadStories();
    }, [isAuthenticated, loadStories]);

    // 別タブで見たストーリーは、こちらでも既読にする。
    // 読み直すのがログイン状態の変化時だけだと、片方のタブで全部見たあとも
    // もう片方はリングが未読のまま残り、リロードするまで直らない。
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === null || e.key === SEEN_STORAGE_KEY) setSeen(loadSeenStoryIds());
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    const handleSeen = useCallback((storyId: string) => {
        markStorySeen(storyId);
        setSeen((prev) => {
            if (prev.has(storyId)) return prev;
            const next = new Set(prev);
            next.add(storyId);
            return next;
        });
    }, []);

    const closeDraft = useCallback(() => {
        // 解放は上の effect が担う（✕ を押さずに離れた場合も拾うため）
        stopPreview();
        setDraft(null);
        setCaption("");
        setDraftSong(null);
        setSongPickerOpen(false);
        setSongQuery("");
        setSongResults([]);
        setSongSearchError(false);   // 開き直したときに前回の失敗を出さない
        setSongStart(0);
        setDurationSec(STORY_DEFAULT_DURATION_SEC);
    }, [stopPreview]);

    // 下書きのプレビューURLを必ず解放する。
    // 解放は closeDraft の中だけにあったので、✕ を押さずに離れたとき
    // （ブラウザの戻る・写真をタップして別ページへ）に、選んだファイルが
    // まるごとメモリに残り続けていた。動画は数十MBあるので、
    // 何度か繰り返すと iOS Safari はタブごと落とす。
    useEffect(() => {
        const url = draft?.previewUrl;
        if (!url) return;
        return () => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } };
    }, [draft?.previewUrl]);

    // **Tab を中に閉じ込める。** `fixed inset-0 z-[95]` の全画面で、裏には
    // ストーリーのリングとギャラリーの写真リンクが全部ある。
    //
    // 最初に当てるのは**キャンセル（✕）**。**指名する。**
    // DOM 順の先頭は背面のメディアで、動画の下書きでは `<video controls>` が
    // そこに来る（`video[controls]` を FOCUSABLE に入れたので巡回に乗る）。
    // 指名しないと、動画を選んだときだけ初期フォーカスが動画に移る。
    // キャプション入力を先頭にはしない——スマホでいきなりキーボードが
    // 出るのは、写真を見ながら書く今の作りと合わない。
    const draftRef = useRef<HTMLDivElement | null>(null);
    const draftCancelRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(draft !== null, draftRef, undefined, draftCancelRef);

    // ファイル選択 → 検証 → 投稿プレビューを開く
    const handleFileSelect = useCallback(async (file: File) => {
        const isImage = file.type.startsWith("image/");
        const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);
        if (!isImage && !isVideo) {
            showToast(locale === "en" ? "Choose a photo or video (mp4)" : "写真または動画（mp4）を選んでください", "error");
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            showToast(locale === "en" ? "File too large (max 50MB)" : "ファイルが大きすぎます（最大50MB）", "error");
            return;
        }
        let prepared = file;
        if (isVideo) {
            try {
                const duration = await getVideoDuration(file);
                if (duration > MAX_VIDEO_SECONDS) {
                    showToast(locale === "en" ? "Video must be 60s or shorter" : "動画は60秒以内にしてください", "error");
                    return;
                }
            } catch {
                showToast(locale === "en" ? "Could not read the video" : "動画を読み込めませんでした", "error");
                return;
            }
            // **位置情報はここで落とす。** 動画だけ関門を通していなかったので、
            // 丸めていない緯度経度が付いたまま公開URLに乗っていた
            // （iPhone の .mov、Android の .mp4 のどちらも入る）。
            //
            // **投稿時ではなく選択時にやる。** 投稿時だと、落とせない動画
            // （WebM など）でもプレビュー・キャプション・曲選びまで進めてから
            // 断ることになり、作った下書きが全部無駄になる。
            // ここ1か所だけに置く——投稿時にも同じ関門を重ねると、
            // 片方を壊してもテストが緑のままになる。
            try {
                const { toUploadSafeVideo } = await import("../../../lib/utils/video");
                prepared = await toUploadSafeVideo(file);
            } catch (e) {
                if (e instanceof UnstrippableFileError) {
                    showToast(
                        locale === "en"
                            ? "This video's location data can't be removed. Please try a different file (MP4 or MOV)."
                            : "この動画は位置情報を取り除けません。別のファイル（MP4 か MOV）をお試しください。",
                        "error",
                    );
                } else {
                    log.error("story video prepare failed:", e);
                    showToast(locale === "en" ? "Failed to prepare the video" : "動画の準備に失敗しました", "error");
                }
                return;
            }
        }
        setDraft({ file: prepared, previewUrl: URL.createObjectURL(prepared), mediaType: isVideo ? "video" : "image" });
        setCaption("");
    }, [locale, showToast]);

    // 投稿: 圧縮（画像のみ）→ presigned URL → S3 → レコード作成
    const handlePost = useCallback(async () => {
        if (!draft) return;
        setPosting(true);
        stopPreview();
        // S3 に上げ終わって、まだ保存に至っていない実体のキー
        let uploadedKey: string | undefined;
        const discardUploaded = async () => {
            if (!uploadedKey) return;
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                await userFetch("/upload/discard", {
                    method: "DELETE", body: JSON.stringify({ key: uploadedKey }),
                });
            } catch { /* 消せなくても投稿の失敗は伝える */ }
            uploadedKey = undefined;
        };
        try {
            let uploadFile = draft.file;
            if (draft.mediaType === "image") {
                // 写真アップロードと同じ「消せたものだけ上げる」経路を使う。
                // 以前は compressImage → 失敗したら stripJpegExif という順だったが、
                // compressImage は GIF・getContext が null・エンコード失敗のときに
                // 投げずに元ファイルをそのまま返すので catch に入らず、
                // GPS 入りの原本がそのまま公開されていた。
                try {
                    uploadFile = await toUploadSafeFile(draft.file, 1440, 0.85);
                } catch (e) {
                    if (e instanceof UnstrippableFileError) {
                        showToast(
                            locale === "en"
                                ? "This format can't be uploaded safely. Please save it as JPEG or PNG and try again."
                                : "この形式は安全にアップロードできません。JPEG か PNG で保存し直してください。",
                            "error",
                        );
                    } else {
                        log.error("story image prepare failed:", e);
                        showToast(
                            locale === "en" ? "Failed to prepare the image" : "画像の準備に失敗しました",
                            "error",
                        );
                    }
                    return; // setPosting(false) は下の finally が担当する
                }
            }

            // ストーリーは常にユーザーAPI経由（動画対応・管理者トークンでも有効）
            const { userFetch } = await import("../../../lib/utils/api");

            const presignedRes = await userFetch("/upload/presigned-url", {
                method: "POST",
                body: JSON.stringify({
                    fileName: uploadFile.name,
                    fileType: uploadFile.type,
                    fileSize: uploadFile.size,
                }),
            });
            if (!presignedRes.ok) {
                // ステータス番号だけを投げると、下の catch が「投稿に失敗しました」に
                // まとめてしまう。サーバーは断る理由を文章で返している
                // （枚数を確認できなかった 503、上限の 403 など）ので、それを出す。
                const { readApiError } = await import("../../../lib/utils/api");
                throw new Error(await readApiError(presignedRes,
                    locale === "en" ? "Could not prepare the upload." : "アップロードの準備に失敗しました。"));
            }
            const { presignedUrl, publicUrl, key, contentType } = await presignedRes.json() as { presignedUrl: string; publicUrl: string; key?: string; contentType?: string };

            // **PUT の前に控える。** ここが PUT のあとだったので、`fetch` が
            // **reject** したとき（本文は上がりきったが応答が返らない）に
            // catch の `discardUploaded()` が空振りしていた。押し直すと
            // presign を取り直して別のキーへ上げ直すので、**再投稿のたびに
            // 動画1本ぶんの孤児が増える**（写真より実害が大きい）。
            //
            // ストーリーは写真と違い「上げたが保存していない実体」を
            // **使い回さない**（下書きにキーを覚えず、失敗したら presign から
            // やり直す）ので、控えを2つに分ける必要は無い。
            // 保存が通った時点で undefined に戻す——通ったあとの失敗
            // （一覧の再読込など）で、**使われている実体**を消さないため。
            uploadedKey = key;

            const s3Res = await fetch(presignedUrl, {
                method: "PUT",
                body: uploadFile,
                // サーバーが署名した種別で送る（`content-type` は署名対象。
                // 違う文字列だと S3 が 403 にする）
                headers: { "Content-Type": contentType ?? uploadFile.type },
            });
            if (!s3Res.ok) {
                log.error("story S3 upload failed:", s3Res.status);
                throw new Error(locale === "en" ? "Could not upload the file." : "ファイルをアップロードできませんでした。");
            }

            // 表示名を取得（ベストエフォート）
            let displayName: string | undefined;
            try {
                const profRes = await userFetch("/user/profile");
                if (profRes.ok) {
                    const prof = await profRes.json() as { displayName?: string };
                    displayName = prof.displayName;
                }
            } catch { /* ignore */ }

            const saveRes = await userFetch("/stories", {
                method: "POST",
                body: JSON.stringify({
                    publicUrl,
                    ...(key ? { key } : {}),
                    mediaType: draft.mediaType,
                    ...(caption.trim() ? { caption: caption.trim() } : {}),
                    ...(draftSong ? { song: { title: draftSong.title, artist: draftSong.artist, artwork: draftSong.artwork, previewUrl: draftSong.previewUrl, trackUrl: draftSong.trackUrl, ...(songStart > 0 ? { startSec: songStart } : {}) } } : {}),
                    ...(draft.mediaType === "image" ? { durationSec } : {}),
                    ...(displayName ? { displayName } : {}),
                }),
            });
            if (!saveRes.ok) {
                // 保存に至らなかったので、先に上げた実体を消す。
                // 残すと、どの削除経路も DynamoDB の項目からキーを引くため
                // 誰にも辿れないオブジェクトになる（公開URLでは取れる）。
                await discardUploaded();
                // 投稿上限（429）はユーザーにそのまま伝える
                if (saveRes.status === 429) {
                    const err = await saveRes.json().catch(() => ({})) as { error?: string };
                    showToast(err.error ?? (locale === "en" ? "Daily story limit reached" : "投稿上限に達しています"), "error");
                    return;
                }
                // `save ${status}` のような番号だけの文字列を投げない。
                // catch は e.message をそのまま出すので、利用者に「save 500」が
                // 見えていた。サーバーの理由を読めればそれを出す。
                const { readApiError } = await import("../../../lib/utils/api");
                throw new Error(await readApiError(saveRes,
                    locale === "en" ? "Failed to post story" : "ストーリーの投稿に失敗しました"));
            }
            // 保存済み。印を消して、ここから先の失敗では実体を消さない。
            // ※ 現状、保存成功後に投げる await は無い（loadStories は内部で
            //   握り潰す）ので、これは**将来ここに処理を足したとき**のための
            //   防御。観測できないため変異テストでは固定していない。
            uploadedKey = undefined;

            showToast(locale === "en" ? "Story posted!" : "ストーリーを投稿しました", "success");
            closeDraft();
            await loadStories();
        } catch (e) {
            // **例外で終わった回も実体を消す。** !ok の分岐だけで消していた頃は、
            // オフライン・DNS 失敗などで userFetch 自体が投げると打ち消しを
            // 通らず、S3 に上げただけの孤児が残った（再投稿のたびに増える）。
            await discardUploaded();
            log.error("story upload error:", e);
            // サーバーが断る理由を文章で返している場合はそれを出す。
            // 固定文言で塗り潰していた頃は、枚数を確認できなかった 503 も
            // 上限の 403 も、全部「投稿に失敗しました」になっていて、
            // 利用者は何をすれば通るのか分からなかった。
            const fallback = locale === "en" ? "Failed to post story" : "ストーリーの投稿に失敗しました";
            showToast(e instanceof Error && e.message ? e.message : fallback, "error");
        } finally {
            setPosting(false);
        }
    }, [draft, caption, draftSong, songStart, durationSec, locale, showToast, loadStories, closeDraft, stopPreview]);

    // 自分のストーリーを削除
    const handleDeleteStory = useCallback(async (storyId: string) => {
        try {
            const { userFetch, isGoneResponse, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/stories/${encodeURIComponent(storyId)}`, { method: "DELETE" });
            // 404 は成功として扱う（別タブで先に消した／24時間で期限切れ）。
            // 失敗と読んで throw していたので `loadStories()` に到達せず、
            // **もう存在しないストーリーがバーに残り続けた**（開くと画像が
            // 取れない）。消えているなら目的は達成している。
            if (!res.ok && !await isGoneResponse(res)) {
                // **サーバーの理由をそのまま出す。** 画像を消せなかったときは
                // 行を残して 500 を返す（＝押し直せば続きから消える）ので、
                // 「削除に失敗しました」だけだと、もう一度押せばよいことが
                // 伝わらない
                throw new Error(await readApiError(res,
                    locale === "en" ? "Failed to delete" : "削除に失敗しました"));
            }
            showToast(locale === "en" ? "Story deleted" : "ストーリーを削除しました", "success");
            await loadStories();
            return true;
        } catch (e) {
            log.error("story delete error:", e);
            // **`e.message` をそのまま出さない。** `userFetch` は `fetch` を
            // そのまま返すので、機内モードや DNS 失敗では
            // `TypeError: Failed to fetch`（Safari は "Load failed"）が
            // 飛んでくる。素で出すと英語の技術文字列が画面に並ぶ
            // ——アップロード画面が同じ事故で作った境界を使う
            const { userFacingError } = await import("../../../lib/utils/errorText");
            showToast(userFacingError(e, locale === "en" ? "Failed to delete" : "削除に失敗しました"), "error");
            return false;
        }
    }, [locale, showToast, loadStories]);

    // ストーリーはログインユーザー限定。未ログインではバー自体を出さない
    if (!isAuthenticated) return null;

    // 自分のストーリーは「あなた」の枠に統合して表示する（同じ人が2つ並ばないように）
    const ownGroupIdx = userId ? groups.findIndex((g) => g.userId === userId) : -1;
    const ownUnseen = ownGroupIdx >= 0 && hasUnseen(groups[ownGroupIdx], seen);

    return (
        <div className="mb-5">
            {loadError && groups.length === 0 && (
                // 失敗をバー空表示と混ぜない。他の人のストーリーが
                // 「誰も投稿していない」ように見えたまま気づけない。
                // ※古い一覧が見えている間（groups あり）の失敗は**意図して**
                //   無言にする——バーは装飾的で、古い表示が出ていれば実害が薄い
                <p className="text-[11px] text-white/45 px-1 pb-1">
                    {locale === "en" ? "Couldn't load stories. " : "ストーリーを読み込めませんでした。"}
                    <button onClick={() => void loadStories()} className="underline text-white/70 hover:text-white">
                        {locale === "en" ? "Retry" : "再試行"}
                    </button>
                </p>
            )}
            <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
                {/* 自分の枠は常に1つだけ。すでに投稿があればリング＝自分のストーリー、
                    右下の「+」で追加投稿。まだ無ければ「+」だけを出す。 */}
                {isAuthenticated && userId && (
                    <div className="relative flex flex-col items-center gap-1.5 flex-shrink-0">
                        <button
                            onClick={() => { if (ownGroupIdx >= 0) setViewerGroup(ownGroupIdx); else fileInputRef.current?.click(); }}
                            disabled={posting}
                            className="disabled:opacity-50 group"
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                            aria-label={ownGroupIdx >= 0
                                ? (locale === "en" ? "View your story" : "自分のストーリーを見る")
                                : (locale === "en" ? "Add a story" : "ストーリーを追加")}
                        >
                            <div
                                className="rounded-full p-[2.5px] group-active:scale-95 transition-transform"
                                style={{ background: ownGroupIdx >= 0 ? (ownUnseen ? RING_UNSEEN : RING_SEEN) : "rgba(255,255,255,0.1)" }}
                            >
                                <div className="rounded-full p-[2.5px] bg-black">
                                    <UserAvatar userId={userId} className="w-[64px] h-[64px]" iconClassName="w-8 h-8" />
                                </div>
                            </div>
                        </button>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={posting}
                            className="absolute top-[50px] right-0 w-[22px] h-[22px] rounded-full ring-[3px] ring-black flex items-center justify-center active:scale-90 transition disabled:opacity-50"
                            style={{ background: "#0095F6", touchAction: "manipulation" }}
                            aria-label={locale === "en" ? "Add a story" : "ストーリーを追加"}
                        >
                            {posting
                                ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                : <PlusIcon className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                        </button>
                        <span className="text-[11px] text-white/70 leading-none">
                            {locale === "en" ? "Your story" : "あなた"}
                        </span>
                    </div>
                )}

                {/* 他ユーザーのストーリーリング（自分は上の枠に統合済みなので除く） */}
                {groups.map((group, idx) => {
                    if (idx === ownGroupIdx) return null;
                    const unseen = hasUnseen(group, seen);
                    return (
                        <button
                            key={group.userId}
                            onClick={() => setViewerGroup(idx)}
                            className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        >
                            <div
                                className="rounded-full p-[2.5px] group-active:scale-95 transition-transform"
                                style={{ background: unseen ? RING_UNSEEN : RING_SEEN }}
                            >
                                <div className="rounded-full p-[2.5px] bg-black">
                                    <UserAvatar userId={group.userId} className="w-[64px] h-[64px]" iconClassName="w-8 h-8" />
                                </div>
                            </div>
                            <span className={`text-[11px] max-w-[68px] truncate leading-none ${unseen ? "text-white/90" : "text-white/50"}`}>
                                {group.displayName}
                            </span>
                        </button>
                    );
                })}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFileSelect(f);
                    e.target.value = "";
                }}
            />

            {/* 投稿プレビュー（キャプション入力つき） */}
            {draft && (
                <div
                    ref={draftRef}
                    className="fixed inset-0 z-[95] bg-black flex flex-col"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="story-draft-title"
                >
                    {/* 写真は画面いっぱいの背面に固定。入力欄はその上に重ねるので、
                        キャプションや曲を入れている間もずっと写真を見ていられる。 */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        {draft.mediaType === "video" ? (
                            <video src={draft.previewUrl} className="w-full h-full object-contain" controls playsInline muted loop autoPlay />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={draft.previewUrl} alt="" className="w-full h-full object-contain" />
                        )}
                    </div>
                    {/* 上下のスクリム（文字と写真が重なっても読めるように） */}
                    <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none" />

                    <div className="relative flex items-center justify-between p-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
                        <h2 id="story-draft-title" className="text-sm font-semibold text-white drop-shadow">
                            {locale === "en" ? "New story" : "新しいストーリー"}
                        </h2>
                        <button ref={draftCancelRef} onClick={closeDraft} disabled={posting} className="p-2 text-white/80 hover:text-white drop-shadow" aria-label={locale === "en" ? "Cancel" : "キャンセル"}>
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="flex-1 min-h-0" />
                    <div className="relative p-4 space-y-3 max-h-[70%] overflow-y-auto no-scrollbar" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
                        <input
                            type="text"
                            value={caption}
                            onChange={(e) => setCaption(e.target.value)}
                            maxLength={200}
                            placeholder={locale === "en" ? "Add a caption..." : "キャプションを追加..."}
                            disabled={posting}
                            className="w-full px-4 py-3 bg-black/55 backdrop-blur-sm ring-1 ring-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:bg-black/70"
                            style={{ fontSize: "16px" }}
                        />

                        {/* ストーリーBGM（任意） */}
                        {draftSong ? (
                            <div className="rounded-2xl bg-black/50 backdrop-blur-sm ring-1 ring-white/10 p-2.5 space-y-2.5">
                                <div className="flex items-center gap-2.5">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={draftSong.artwork} alt="" className="w-9 h-9 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-white truncate">{draftSong.title}</p>
                                        <p className="text-[11px] text-white/50 truncate">{draftSong.artist}</p>
                                    </div>
                                    <button
                                        onClick={() => previewingId === draftSong.id ? stopPreview() : playPreview(draftSong, songStart, songWindowSec)}
                                        disabled={posting}
                                        className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center active:scale-90 transition flex-shrink-0"
                                        aria-label={previewingId === draftSong.id ? (locale === "en" ? "Pause" : "停止") : (locale === "en" ? "Play" : "再生")}
                                    >
                                        {previewingId === draftSong.id
                                            ? <PauseIcon className="w-4 h-4 text-white" />
                                            : <PlayIcon className="w-4 h-4 text-white" />}
                                    </button>
                                    <button onClick={() => { stopPreview(); setDraftSong(null); setSongStart(0); }} disabled={posting} className="p-1 text-white/50 hover:text-white active:scale-90 transition flex-shrink-0" aria-label={locale === "en" ? "Remove song" : "曲を外す"}>
                                        <XMarkIcon className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* 好きな部分。ストーリーに乗る範囲を白枠で示し、その中だけを
                                    繰り返し再生する（インスタと同じ考え方）。秒数を頭で考えなくていい。
                                    動画は長さが可変で、曲は動画の長さぶん流れるため区間を選ぶ意味がない
                                    （可動域ゼロのバーを出すと「ドラッグしても動かない」ように見える）。 */}
                                {draft.mediaType === "video" ? (
                                    <p className="text-[11px] text-white/45">
                                        {locale === "en"
                                            ? "Plays from the start, for the length of the video."
                                            : "動画の長さぶん、曲の頭から流れます"}
                                    </p>
                                ) : (
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[11px] text-white/60">
                                            {locale === "en" ? "Drag to pick the part" : "ドラッグで好きな部分を選ぶ"}
                                        </span>
                                        <span className="text-[11px] text-white/80 tabular-nums">
                                            {fmtSec(songStart)} – {fmtSec(Math.min(SONG_PREVIEW_SEC, songStart + songWindowSec))}
                                        </span>
                                    </div>
                                    {/* バーのどこを押しても、押した位置が範囲の中央になる。
                                        透明な range 入力だと iOS では見えないつまみを掴まないと
                                        動かず「反応しない」ため、ポインタを直接扱う。 */}
                                    <div
                                        ref={trimBarRef}
                                        role="slider"
                                        tabIndex={posting ? -1 : 0}
                                        aria-label={locale === "en" ? "Song start position" : "曲の開始位置"}
                                        aria-valuemin={0}
                                        aria-valuemax={maxSongStart}
                                        aria-valuenow={Math.min(songStart, maxSongStart)}
                                        aria-valuetext={`${fmtSec(songStart)} – ${fmtSec(Math.min(SONG_PREVIEW_SEC, songStart + songWindowSec))}`}
                                        onPointerDown={(e) => {
                                            if (posting) return;
                                            e.currentTarget.setPointerCapture(e.pointerId);
                                            setTrimDragging(true);
                                            applyTrimFromPointer(e.clientX);
                                        }}
                                        onPointerMove={(e) => {
                                            if (!trimDragging) return;
                                            e.preventDefault();
                                            applyTrimFromPointer(e.clientX);
                                        }}
                                        onPointerUp={(e) => {
                                            setTrimDragging(false);
                                            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
                                        }}
                                        onPointerCancel={() => setTrimDragging(false)}
                                        onKeyDown={(e) => {
                                            const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
                                            if (step === 0 && e.key !== "Home" && e.key !== "End") return;
                                            e.preventDefault();
                                            const next = e.key === "Home" ? 0 : e.key === "End" ? maxSongStart : songStart + step;
                                            applyTrimStart(next);
                                        }}
                                        className={`relative h-12 rounded-lg bg-white/10 overflow-hidden select-none ${posting ? "opacity-50" : "cursor-pointer"} focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60`}
                                        // 縦スクロールにドラッグを取られないようにする
                                        style={{ touchAction: "none", WebkitTapHighlightColor: "transparent" }}
                                    >
                                        {/* 選ばれている範囲 */}
                                        <div
                                            className={`absolute inset-y-0 bg-white/25 ring-2 ring-white/70 rounded-lg pointer-events-none ${trimDragging ? "" : "transition-[left] duration-75"}`}
                                            style={{
                                                left: `${(songStart / SONG_PREVIEW_SEC) * 100}%`,
                                                width: `${(songWindowSec / SONG_PREVIEW_SEC) * 100}%`,
                                            }}
                                        >
                                            {/* 掴めることが分かるつまみ */}
                                            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-1 rounded-full bg-white/80" />
                                        </div>
                                        {/* 再生位置 */}
                                        {previewingId === draftSong.id && (
                                            <div
                                                className="absolute inset-y-0 w-[2px] bg-white pointer-events-none"
                                                style={{ left: `${(previewTime / SONG_PREVIEW_SEC) * 100}%` }}
                                            />
                                        )}
                                    </div>
                                    <p className="mt-1.5 text-[10px] text-white/40">
                                        {locale === "en"
                                            ? `Plays ${songWindowSec}s from here, matching the story length.`
                                            : `ここから${songWindowSec}秒（ストーリーの表示時間ぶん）が流れます`}
                                    </p>
                                </div>
                                )}
                            </div>
                        ) : songPickerOpen ? (
                            <div className="rounded-2xl bg-black/60 backdrop-blur-sm ring-1 ring-white/10 p-2.5 space-y-2">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={songQuery}
                                        onChange={(e) => setSongQuery(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchDraftSongs(); } }}
                                        placeholder={locale === "en" ? "Song or artist" : "曲名・アーティスト名"}
                                        autoFocus
                                        className="flex-1 min-w-0 px-3 py-2 bg-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:bg-white/15"
                                        style={{ fontSize: "16px" }}
                                    />
                                    <button onClick={() => void searchDraftSongs()} disabled={songSearching || !songQuery.trim()}
                                        className="px-3.5 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 transition text-xs text-white disabled:opacity-40 min-w-[56px]">
                                        {songSearching
                                            ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
                                            : (locale === "en" ? "Search" : "検索")}
                                    </button>
                                    <button onClick={() => { stopPreview(); setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                        className="px-2 text-xs text-white/50 hover:text-white/80 active:scale-95 transition">
                                        {locale === "en" ? "Cancel" : "閉じる"}
                                    </button>
                                </div>
                                {songSearchError && (
                                    <p className="text-xs text-amber-400/80">
                                        {locale === "en" ? "Search failed. Try again." : "検索に失敗しました。もう一度お試しください。"}
                                    </p>
                                )}
                                {songResults.length > 0 && (
                                    <ul className="rounded-xl bg-black/40 divide-y divide-white/5 overflow-hidden max-h-44 overflow-y-auto no-scrollbar">
                                        {songResults.map((r) => (
                                            <li key={r.id} className="flex items-center gap-1 pr-2">
                                                {/* 試聴（曲を決める前に雰囲気を確かめられる）*/}
                                                <button
                                                    onClick={() => previewingId === r.id ? stopPreview() : playPreview(r)}
                                                    className="relative w-8 h-8 ml-2 my-2 rounded overflow-hidden flex-shrink-0 active:scale-90 transition"
                                                    aria-label={previewingId === r.id
                                                        ? (locale === "en" ? `Pause ${r.title}` : `${r.title} を停止`)
                                                        : (locale === "en" ? `Play ${r.title}` : `${r.title} を試聴`)}
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={r.artwork} alt="" loading="lazy" className="w-full h-full object-cover bg-white/10" />
                                                    <span className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                                        {previewingId === r.id
                                                            ? <PauseIcon className="w-4 h-4 text-white" />
                                                            : <PlayIcon className="w-4 h-4 text-white" />}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={() => { stopPreview(); setDraftSong(r); setSongStart(0); setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                                    className="flex-1 min-w-0 flex items-center gap-2.5 py-2 hover:bg-white/10 active:bg-white/15 transition text-left"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs text-white truncate">{r.title}</p>
                                                        <p className="text-[11px] text-white/50 truncate">{r.artist}</p>
                                                    </div>
                                                    <span className="text-[11px] text-white/40 flex-shrink-0">{locale === "en" ? "Set" : "設定"}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={() => setSongPickerOpen(true)}
                                disabled={posting}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/10 hover:bg-black/70 text-white/85 text-xs active:scale-95 transition"
                            >
                                <MusicalNoteIcon className="w-4 h-4 text-fuchsia-300" />
                                {locale === "en" ? "Add music" : "曲を付ける"}
                            </button>
                        )}

                        {/* 表示時間（画像のみ。動画は動画の長さで決まる）*/}
                        {draft.mediaType === "image" && (
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-white/60 flex-shrink-0">
                                    {locale === "en" ? "Duration" : "表示時間"}
                                </span>
                                <div className="flex gap-1.5">
                                    {STORY_DURATION_CHOICES.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => {
                                                setDurationSec(s);
                                                // 表示時間を伸ばしたら、曲の範囲が30秒を超えないように詰める
                                                setSongStart((v) => Math.min(v, Math.max(0, SONG_PREVIEW_SEC - s)));
                                            }}
                                            disabled={posting}
                                            aria-pressed={durationSec === s}
                                            className={`px-3 py-1.5 rounded-full text-xs transition active:scale-95 ${durationSec === s
                                                ? "bg-white text-black font-semibold"
                                                : "bg-black/55 backdrop-blur-sm ring-1 ring-white/10 text-white/70"}`}
                                        >
                                            {s}
                                            {locale === "en" ? "s" : "秒"}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={() => void handlePost()}
                            disabled={posting}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            style={{ touchAction: "manipulation" }}
                        >
                            {posting && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                            {posting
                                ? (locale === "en" ? "Posting..." : "投稿中...")
                                : (locale === "en" ? "Share to story" : "ストーリーに投稿")}
                        </button>
                    </div>
                </div>
            )}

            {viewerGroup !== null && groups[viewerGroup] && (
                <StoryViewer
                    groups={groups}
                    initialGroupIndex={viewerGroup}
                    locale={locale}
                    ownUserId={userId}
                    isAuthenticated={isAuthenticated}
                    onSeen={handleSeen}
                    onDelete={handleDeleteStory}
                    onClose={() => setViewerGroup(null)}
                />
            )}
        </div>
    );
}
