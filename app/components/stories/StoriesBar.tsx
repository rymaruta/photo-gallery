"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, XMarkIcon, MusicalNoteIcon, TrashIcon, ChevronDoubleUpIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { onStoryFileHandoff, takeHandedStoryFile } from "@/lib/utils/storyHandoff";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import UserAvatar from "../UserAvatar";
import SongArtwork from "../SongArtwork";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { toUploadSafeFile, UnstrippableFileError } from "../../../lib/utils/image";
import { unstrippableMessage, gifRejectedMessage } from "../../../lib/utils/uploadRejection";
import { isImeKey } from "../../../lib/utils/ime";
import { useSongSearch } from "../../../lib/hooks/useSongSearch";
import { type SongResult } from "../../../lib/utils/music";
import { startFromPointer, clampStart } from "../../../lib/utils/songTrim";
import { log } from "../../../lib/utils/log";
import {
    groupStories, hasUnseen, loadSeenStoryIds, markStorySeen, isSeenStoriesKey,
    type Story, type StoryGroup, type StoryVisibility,
} from "../../../lib/stories";
import StoryViewer from "./StoryViewer";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";
import StoryTextOverlay from "./StoryTextOverlay";
import { useMediaBox } from "../../../lib/hooks/useMediaBox";
import { movedBeyondTap, type PressPoint } from "../../../lib/utils/tap";
import {
    STORY_FONTS, STORY_FONT_KEYS, STORY_COLORS, STORY_COLOR_KEYS,
    STORY_BGS, STORY_TEXTS_MAX, STORY_TEXT_LEN_MAX,
    STORY_SIZE_MIN, STORY_SIZE_MAX, STORY_SIZE_STEP, STORY_SIZE_DEFAULT, clampStoryTextSize,
    FIRST_STORY_TEXT_POS, clampStoryTextPos, newStoryText, clampStoryTextRotate,
    STORY_STAMPS, STORY_STAMP_KEYS, newStoryStamp, isStoryStamp,
    isStoryTextItem, isStoryVote, newStoryVote, isCompleteStoryVote,
    STORY_VOTE_QUESTION_MAX, STORY_VOTE_OPTION_MAX,
    type StoryText, type StoryTextItem, type StoryStampKey,
} from "../../../lib/utils/storyText";
import { grabHandle, handleMove, type HandleGrab } from "../../../lib/utils/storyTransform";
import { useMusic } from "../../music/MusicContext";
import SongSearchError from "../SongSearchError";


/**
 * 公開設定の入／切。**モックのスイッチの形**。
 *
 * 押せるものは `<button role="switch">`（このリポジトリが
 * `FilterBar` や投稿画面のチップで使っている形）。**寸法は px で書く**
 * ——640px 未満で root が 14px に落ちるので、`rem` だと摘まむところが縮む
 * （CLAUDE.md）。44×24px の軌道に 20px の玉で、指で押せる高さを保つ。
 */
function SettingSwitch({ label, checked, onChange, disabled }: {
    label: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-white/80" style={{ fontSize: "13px" }}>{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={`relative rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${checked ? "bg-white" : "bg-white/20"}`}
                style={{ width: "44px", height: "24px", touchAction: "manipulation" }}
            >
                <span
                    className={`absolute rounded-full transition-transform ${checked ? "bg-black" : "bg-white/70"}`}
                    style={{
                        width: "20px", height: "20px", top: "2px", left: "2px",
                        transform: checked ? "translateX(20px)" : "translateX(0)",
                    }}
                />
            </button>
        </div>
    );
}

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
    /** 投稿中の要求。キャンセルを押したら中断する */
    const postAbortRef = useRef<AbortController | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    /**
     * 写真の上に置いた文字たち。**並びが重なり順**（後ろほど手前）。
     *
     * 文言はここが持ち、`caption`（残したときの題・検索に出る文章）は
     * **サーバーがこれを繋いで**書く。2か所で持たない。
     */
    const [texts, setTexts] = useState<StoryText[]>([]);
    /** いま直している文字。操作の欄はこれに効く */
    const [selected, setSelected] = useState<number | null>(null);
    /** 掴んでいる間は文字を少し透かす（下の写真を確かめられるように） */
    const [dragging, setDragging] = useState(false);
    /**
     * 操作の欄を畳んで**写真だけ**にする。
     *
     * 320×568 の実測で、指で触れる写真は**上の 57% まで**（残りは操作の欄）。
     * 文字を掴んで運べば下へも置けるが、**置いたあと見えない**し、
     * 空いている所を指して決めることもできない
     * （owner:「指で決めれるようにしよう」）。
     * 畳めば写真が全部出て、どこでも指で決められる。
     */
    const [photoOnly, setPhotoOnly] = useState(false);
    /**
     * 文字の見せ方の欄は**1度に1つだけ開く**。
     *
     * 字体・色・大きさ・下地を全部並べると、320×568 で操作の欄が 276px
     * ——画面の**半分**を食っていた（owner:「画面の範囲奪いすぎてる」）。
     * タブ1段＋開いた1段にすれば、置く相手の写真がその分だけ広く見える。
     */
    const [tool, setTool] = useState<"font" | "color" | "size" | "bg">("font");
    const draftMediaAreaRef = useRef<HTMLDivElement | null>(null);
    // 絵が実際に描かれている矩形。**囲みではなく絵に対する割合**で持たないと、
    // 置いた端末と見る端末で写真のどこに載るかがずれる（`object-contain`）
    const { attach: attachDraftMedia, box: draftMediaBox, measure: measureDraftMedia } = useMediaBox(draftMediaAreaRef);

    /** いま選んでいるもの（文字かスタンプ。無ければ null） */
    const current = selected !== null ? texts[selected] ?? null : null;
    /**
     * いま選んでいるものが**文字のとき**だけ中身を返す。
     *
     * 字体・色・下地はスタンプに効かない。分けずに出すと**押しても効かない
     * 欄**が並ぶ——このファイルが既に「動かすものも飾るものも無いなら
     * 欄を置かない」と書いている、その判断をスタンプにも当てる。
     */
    // **「スタンプでない」ではなく「文字である」で絞る。** 否定で書くと、
    // 種類を足すたび（投票）に**新しい種類が文字の側へ落ちる**
    const currentText = current && isStoryTextItem(current) ? current : null;
    /** いま選んでいるものが**投票のとき**だけ中身を返す（問いと2択の欄に効く） */
    const currentVote = current && isStoryVote(current) ? current : null;

    /** 選んでいる**文字**の見せ方を変える（スタンプには当てない） */
    const patchSelected = useCallback((patch: Partial<StoryTextItem>) => {
        setTexts((prev) => prev.map((t, i) => (
            i === selected && isStoryTextItem(t) ? { ...t, ...patch } : t
        )));
    }, [selected]);

    /**
     * 文言を書き換える。**まだ1つも無ければ作る**——今までどおり
     * 「開いて打つだけ」で1つ目が置けるようにする（＋を押させない）。
     */
    const editText = useCallback((value: string) => {
        setTexts((prev) => {
            const cur = selected !== null ? prev[selected] : undefined;
            // **スタンプを選んでいるときは、それに文言を足さない。**
            //
            // 当てていたので、`addStamp` が置いた直後（選んだ状態）に打つと
            // **1文字も入らなかった**——欄は `currentText?.text` を見るので
            // 常に空、そのくせスタンプの中身には `text` が生えて、サーバーが
            // 落とす（＝打った文字が黙って消える）。「スタンプを置いて、
            // そのまま題を打つ」はいちばん自然な流れなので、ここは
            // **新しい文字を足す**側へ倒す。
            // **「文字である」で絞る**（`!isStoryStamp` だと投票が文字の側へ
            // 落ちて、投票の中身に `text` が生える——⑨-2 で踏んだ形。
            // スプレッドは余剰プロパティを型が止めないので、ここは型に頼れない）
            if (cur && isStoryTextItem(cur)) {
                return prev.map((t, i) => (i === selected ? { ...t, text: value } : t));
            }
            if (!value) return prev;
            if (prev.length >= STORY_TEXTS_MAX) return prev;
            return [...prev, newStoryText(FIRST_STORY_TEXT_POS.x, FIRST_STORY_TEXT_POS.y)].map((t, i, a) =>
                i === a.length - 1 ? { ...t, text: value } : t);
        });
        // **文字を選び直す。** スタンプを選んでいた回は、いま足した文字が
        // 新しい選択（そうしないと次の1文字がまたスタンプの側へ行く）
        setSelected((cur) => {
            const sel = cur !== null ? texts[cur] : undefined;
            if (sel && isStoryTextItem(sel)) return cur;
            return Math.min(texts.length, STORY_TEXTS_MAX - 1);
        });
    }, [selected, texts]);

    /** もう1つ置く。**少しずらす**——同じ場所に重ねると掴み分けられない */
    const addText = useCallback(() => {
        setTexts((prev) => {
            if (prev.length >= STORY_TEXTS_MAX) return prev;
            const n = prev.length;
            const next = [...prev, newStoryText(FIRST_STORY_TEXT_POS.x, FIRST_STORY_TEXT_POS.y + 0.12 * n)];
            return next;
        });
        setSelected(texts.length < STORY_TEXTS_MAX ? texts.length : selected);
    }, [texts.length, selected]);

    /**
     * スタンプを1つ置く。
     *
     * **少しずつずらす**のは文字と同じ理由——同じ場所に重ねると掴み分け
     * られない。置いたら**選んだ状態にする**ので、そのまま角のハンドルで
     * 大きさと傾きを決められる。
     */
    const addStamp = useCallback((stamp: StoryStampKey) => {
        setTexts((prev) => {
            if (prev.length >= STORY_TEXTS_MAX) return prev;
            return [...prev, newStoryStamp(stamp, FIRST_STORY_TEXT_POS.x, FIRST_STORY_TEXT_POS.y + 0.12 * prev.length)];
        });
        setSelected(texts.length < STORY_TEXTS_MAX ? texts.length : selected);
    }, [texts.length, selected]);

    /** 投票は1投稿に1つ（票をストーリー単位で数えるため）。既に在るか */
    const hasVote = texts.some(isStoryVote);
    /**
     * 置いた投票に欠けがある（問いか2択が空）。**この間は投稿できない。**
     * `sanitizeStoryTexts` は欠けた投票を落とす（既定で埋めない）ので、
     * 送れてしまうと**カードは見えているのに投稿後に消える**。判定は
     * サーバーと同じ1本（`isCompleteStoryVote`）
     */
    const voteIncomplete = texts.some((t) => isStoryVote(t) && !isCompleteStoryVote(t));

    /**
     * 投票を1つ置く。**既に在れば置かない**（上の理由。`sanitizeStoryTexts` も
     * 2つ目を落とすので、置けても保存で消える——押せない形にしておく）。
     * 置いたら選んだ状態にして、問いと2択を直せるようにする。
     */
    const addVote = useCallback(() => {
        if (hasVote) return;
        setTexts((prev) => {
            if (prev.length >= STORY_TEXTS_MAX || prev.some(isStoryVote)) return prev;
            return [...prev, newStoryVote(FIRST_STORY_TEXT_POS.x, FIRST_STORY_TEXT_POS.y + 0.12 * prev.length)];
        });
        setSelected(texts.length < STORY_TEXTS_MAX ? texts.length : selected);
    }, [hasVote, texts.length, selected]);

    /** 選んでいる**投票**の問い・2択を直す（他の種類には当てない） */
    const patchVote = useCallback((patch: { question?: string; options?: [string, string] }) => {
        setTexts((prev) => prev.map((t, i) => (
            i === selected && isStoryVote(t) ? { ...t, ...patch } : t
        )));
    }, [selected]);

    /**
     * 選んでいる文字を消す。**残っていれば最後の1つを選び直す。**
     *
     * 何も選ばない形にすると、打つ欄が「選んでいない」状態になり、
     * そこへ打つと**直すつもりで新しい文字ができる**（`editText` が
     * 1つ目を作る経路に入る）。消したあとに続けて打つのは普通の流れなので、
     * そこで驚かせない。
     */
    const removeSelected = useCallback(() => {
        if (selected === null) return;
        setTexts((prev) => {
            const next = prev.filter((_, i) => i !== selected);
            setSelected(next.length > 0 ? next.length - 1 : null);
            return next;
        });
    }, [selected]);

    /** 選んでいる文字をいちばん手前へ（並びが重なり順） */
    const bringSelectedToFront = useCallback(() => {
        if (selected === null) return;
        setTexts((prev) => {
            if (selected >= prev.length) return prev;
            const next = prev.filter((_, i) => i !== selected);
            next.push(prev[selected]);
            return next;
        });
        setSelected(texts.length - 1);
    }, [selected, texts.length]);

    /** 掴んだ場所を、絵に対する割合へ。**端は必ず挟む**（半分が外へ出ない） */
    const moveTextTo = useCallback((index: number, clientX: number, clientY: number) => {
        const area = draftMediaAreaRef.current;
        if (!area) return;
        const r = area.getBoundingClientRect();
        // 測れていれば絵の矩形、測れていなければ囲み（文字を消さない）
        const left = r.left + (draftMediaBox?.left ?? 0);
        const top = r.top + (draftMediaBox?.top ?? 0);
        const w = draftMediaBox?.width || r.width;
        const h = draftMediaBox?.height || r.height;
        if (!w || !h) return;
        setTexts((prev) => prev.map((t, i) => (i === index
            ? { ...t, x: clampStoryTextPos((clientX - left) / w), y: clampStoryTextPos((clientY - top) / h) }
            : t)));
    }, [draftMediaBox]);

    /** 掴んでいる文字。指が離れるまで、その1つだけを動かす */
    const draggingIndexRef = useRef<number | null>(null);
    /**
     * 写真の余白に置いた指。**タップ（外す）となぞり（動かす）を見分ける。**
     *
     * 文字そのものを掴む形だけだと、**操作の欄に隠れた文字に指が届かない**
     * ——320×568 では写真の見えている高さが 160px しかない。
     * 選んでいる間は、**写真のどこをなぞっても選んでいる文字が付いてくる**
     * （owner:「指で決めれるようにしよう」）。
     */
    const bgPressRef = useRef<PressPoint | null>(null);

    /** 矢印キーで少しずつ動かす（指でなぞれない人の動かし方） */
    const nudgeText = useCallback((index: number, dx: number, dy: number) => {
        setTexts((prev) => prev.map((t, i) => (i === index
            ? { ...t, x: clampStoryTextPos(t.x + dx), y: clampStoryTextPos(t.y + dy) }
            : t)));
        setSelected(index);
    }, []);

    /**
     * 角のハンドルを掴んでいる間の控え。
     *
     * **`draggingIndexRef`（動かす）とは別に持つ。** 同じ ref を使うと、
     * ハンドルを掴んだ指の動きが「文字を運ぶ」にも流れ込み、
     * **回しながら文字が指を追って飛んでいく**。
     */
    const handleGrabRef = useRef<{ index: number; grab: HandleGrab; pointerId: number } | null>(null);

    /**
     * ハンドルを掴んでよい箱の最小の辺（px）。
     * これより小さい箱は「中心を掴んだ」のと変わらない（下の説明）。
     */
    const MIN_HANDLE_BOX_PX = 8;

    /**
     * 傾き・大きさを直に入れる（キーボードとハンドルの両方から）。
     * **位置は触らない**——回しても置き場所は変わらない。
     */
    const transformText = useCallback((index: number, patch: { rotate?: number; size?: number }) => {
        setTexts((prev) => prev.map((t, i) => (i === index
            ? {
                ...t,
                ...(patch.rotate === undefined ? {} : { rotate: clampStoryTextRotate(patch.rotate) }),
                ...(patch.size === undefined ? {} : { size: clampStoryTextSize(patch.size) }),
            }
            : t)));
        setSelected(index);
    }, []);

    /**
     * ハンドルを掴んだ。**文字の箱の中心**を画面の座標で控える
     * ——回転も拡大縮小も、中心から見た角度と距離で決まる。
     */
    const grabTextHandle = useCallback((index: number, e: React.PointerEvent<HTMLElement>) => {
        const el = (e.currentTarget as HTMLElement).parentElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const t = texts[index];
        if (!t) return;
        // **潰れた箱からは始めない。** 中心からの距離がほぼ 0 の点を掴むと、
        // `dist / grab.dist` が一気に跳ねて**大きさが上限に張り付き**、
        // 半径ほぼ 0 から測った角度は雑音なので**傾きも無関係な値に飛ぶ**。
        // 空の文字にはハンドルを出さないようにしてあるが、下地なしの
        // 細い文字や測る前の一瞬でもここに来うるので、入口でも止める
        if (r.width < MIN_HANDLE_BOX_PX || r.height < MIN_HANDLE_BOX_PX) return;
        handleGrabRef.current = {
            index,
            pointerId: e.pointerId,
            grab: grabHandle(
                r.left + r.width / 2, r.top + r.height / 2,
                e.clientX, e.clientY,
                clampStoryTextRotate(t.rotate), t.size,
            ),
        };
        setSelected(index);
        setDragging(true);
        // **捕まえるのは囲みの方**（ハンドルではなく）。
        // ハンドルに捕まえると、そのあとの `pointermove` / `pointerup` が
        // ハンドルへ飛ぶので、**囲みが持っている追随の仕組みを丸ごと
        // もう一組**書くことになる。囲みに捕まえれば既にある経路を通る。
        const area = draftMediaAreaRef.current;
        if (typeof area?.setPointerCapture === "function") area.setPointerCapture(e.pointerId);
    }, [texts]);
    // 撮影地。**ここが「残す」の価値を決める**——空のまま残すと、写真は
    // 地図にも `/location/<スラッグ>` にも載らない（本人が編集画面で打つまで）
    const [storyLocation, setStoryLocation] = useState("");
    /** 写真の GPS（丸めはサーバー側。写真のアップロード画面と同じ形） */
    const [storyCoords, setStoryCoords] = useState<{ lat: number; lng: number } | null>(null);
    /**
     * いま欄に入っている地名が**写真の GPS から来たものか**。
     *
     * 投稿のときに設定（`jp_gps_autofill`）をもう一度見るのは、
     * 「待っている間に GPS 自動入力を切られたら送らない」ため。だが
     * **手で打った地名にまでそれが効いていた**——設定を切っている人は
     * 自動入力を受けないので、欄に在る文字は必ず自分で打ったものなのに、
     * 投稿すると黙って落ちていた（残しても撮影地の無い写真になる）。
     * 「位置情報を表示」を画面に出したことで、**入のまま送られない**という
     * 嘘が利用者から見えるようになったので、来歴で分ける。
     *
     * 打ち直したら外す（自分で決めた文字は自分のもの）。
     */
    const locationFromGpsRef = useRef(false);
    /**
     * 下書きの世代。**自動入力の書き戻しを、今の下書きに限る。**
     *
     * 位置を引くのに数秒かかるので、その間に閉じて別の写真（や動画）を選ぶと、
     * **前の写真の撮影地が次の投稿に載る**——自宅で撮った1枚を選んで閉じ、
     * 次に別の写真を上げると、ログイン中の全員のトレイに自宅の地名が出る。
     * そのまま「残す」を押せば公開写真の撮影地と地図のピンになる。
     * 写真のアップロード画面は同じ形を2つの手（写真ごとの id 照合と
     * 離脱の札）で塞いでいて、こちらだけ無かった。
     */
    const draftGenRef = useRef(0);
    // ストーリーBGM（任意・1曲）
    const [draftSong, setDraftSong] = useState<SongResult | null>(null);
    const [songPickerOpen, setSongPickerOpen] = useState(false);
    const [songQuery, setSongQuery] = useState("");
    // 検索そのものは共有のフック（3画面で同じものを書いていた）
    const {
        results: songResults, searching: songSearching, error: songSearchError,
        search: runSongSearch, clear: clearSongSearch,
    } = useSongSearch();
    // 曲の「好きな部分」= 30秒プレビュー内の開始位置（秒）
    const [songStart, setSongStart] = useState(0);
    // 画像ストーリーの表示秒数（投稿者が選ぶ）
    const [durationSec, setDurationSec] = useState(STORY_DEFAULT_DURATION_SEC);

    // ── 公開設定 ──
    /**
     * 公開範囲。既定は「全員に公開」＝これまでの姿。
     *
     * **「親しい友達」はまだ出さない。** モックには3つ目があるが、
     * 人を選ぶ一覧の新設が要る。押しても何も起きない選択肢を置かない
     * （`StoryViewer` が「0件のときは返信のボタンを出さない」と書いている
     * のと同じ線）。
     */
    const [visibility, setVisibility] = useState<StoryVisibility>("public");
    /** 返信を受けるか。既定は受ける */
    const [allowReplies, setAllowReplies] = useState(true);
    /**
     * 位置情報を表示するか。既定は表示する。
     *
     * **新しい列は作らない。** 切ったら `location` / `coords` を**送らない**
     * ——保存されていない位置は、一覧にも、残した写真にも、地図にも出ない。
     * 「保存はするが隠す」形にすると、隠しているはずの地名が
     * 残す経路（`storyKeep.ts` が `location` をそのまま写真の撮影地にする）
     * から漏れる口を作ることになる。
     */
    const [showLocation, setShowLocation] = useState(true);

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

    // **試聴を止めてから検索する。** 止めないと、結果が入れ替わっても
    // 前の曲が鳴り続ける（停止ボタンごと画面から消える）。
    // 追い越しを捨てる仕掛けは `useSongSearch` が持っている。
    const searchDraftSongs = async () => {
        // **空の語では何もしない（試聴も止めない）。** 検索ボタンは空だと
        // 押せないが、入力欄の Enter は素通りする——試聴中に語を消して
        // Enter を押すと、以前は無反応だったのが再生が止まっていた
        // （フックに空判定を移したときに、`stopPreview()` が前に出た）。
        if (!songQuery.trim()) return;
        stopPreview();
        await runSongSearch(songQuery);
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

    /**
     * ビューアの中でブロックしたか。**閉じたときに一覧を取り直す。**
     *
     * サーバーは `GET /stories` でブロック両向きを除外するが、ここが
     * 取り直すのはマウント時と `isAuthenticated` の変化時だけ。
     * 伝えないと、ブロックした相手のリングが残って開ける
     * （プロフィール経由だと、ギャラリーへ戻る時点で再マウントされるので
     *   症状が出ない——**症状が出る唯一の経路がビューア側**）。
     */
    const blockedWhileViewingRef = useRef(false);

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
            if (isSeenStoriesKey(e.key)) setSeen(loadSeenStoryIds());
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
        draftGenRef.current++;
        setDraft(null);
        setStoryLocation("");
        setStoryCoords(null);
        locationFromGpsRef.current = false;
        setTexts([]);
        setSelected(null);
        setPhotoOnly(false);
        setTool("font");
        setDraftSong(null);
        setSongPickerOpen(false);
        setSongQuery("");
        clearSongSearch();   // 開き直したときに前回の結果と失敗を出さない
        setSongStart(0);
        setDurationSec(STORY_DEFAULT_DURATION_SEC);
        // **公開設定も戻す。** 残すと、一度「フォロワーのみ」で出した人の
        // 次の投稿が黙って絞られる（画面は閉じているので気づけない）
        setVisibility("public");
        setAllowReplies(true);
        setShowLocation(true);
    }, [stopPreview, clearSongSearch]);

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
        // **GIF はここで断る。** `toUploadSafeFile` は GIF を必ず
        // `UnstrippableFileError` にする（アニメーションを保つため再エンコード
        // せず、保険のバイト除去は JPEG だけ）。投稿時まで待つと、
        // **キャプションと曲まで選んでから必ず断られる**——すぐ下の動画の
        // 関門に「投稿時ではなく選択時にやる」と書いてあるのと同じ理由。
        //
        // **サイズ判定より前に置く。** 写真グリッド側が先に GIF を見るので、
        // 順が違うと 60MB の GIF で画面ごとに違う理由が出る。
        if (file.type === "image/gif") {
            showToast(gifRejectedMessage(locale), "error");
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
        // **下書きを開くときは、ビューアを必ず閉じる。**
        //
        // 動画は下ごしらえ（メタデータ読み＋箱の走査）に数秒かかる一方、
        // その間リングは押せる（`disabled` は `posting` だけ）。押されると
        // ビューアが開き、そこへ下書きが `z-[95]` でかぶさる——裏のビューアは
        // 生きたままなので、BGM は鳴り続け、自動送りも進み、閲覧記録まで
        // 送られる。キャプション欄で ← → を押すと**裏のストーリーが動く**
        // （`StoryViewer` の keydown は `document` に付いている）。
        // フォーカストラップも2つ同時に効く。
        //
        // リング側を止める（`preparing` を作って `disabled` に足す）案も
        // あるが、それは「押しても何も起きない数秒」を新しく作る。
        // 開くときに片方を閉じる方が、見えている物と操作の対応が保てる。
        setViewerGroup(null);
        const gen = ++draftGenRef.current;
        setDraft({ file: prepared, previewUrl: URL.createObjectURL(prepared), mediaType: isVideo ? "video" : "image" });
        setTexts([]);
        setSelected(null);
        setStoryLocation("");
        setStoryCoords(null);
        locationFromGpsRef.current = false;

        // **撮影地は、EXIF を落とす前の元ファイルから読む。**
        // 投稿の直前に `toUploadSafeFile` が GPS ごと消すので、ここを逃すと
        // 二度と取れない。写真のアップロード画面と同じ形（設定 `jp_gps_autofill`・
        // 座標はサーバーが約1kmに丸める・地名はサーバー越しに引く）。
        //
        // **下書きを開くのを待たせない。** 位置を引くのに数秒かかることが
        // あり、その間プレビューが出ないと「固まった」に見える。
        // 失敗しても黙って諦める（写真側と同じ——場所は必須ではない）。
        if (!isVideo) {
            void (async () => {
                try {
                    if (localStorage.getItem("jp_gps_autofill") === "0") return;
                } catch { /* 読めない端末は既定（オン）のまま進む */ }
                try {
                    const { extractExifFromFile, reverseGeocode } = await import("../../../lib/utils/exif");
                    const meta = await extractExifFromFile(file);
                    if (typeof meta.latitude !== "number" || typeof meta.longitude !== "number") return;
                    // **今の下書き宛てのときだけ書き戻す**（上の `draftGenRef`）
                    if (gen !== draftGenRef.current) return;
                    setStoryCoords({ lat: meta.latitude, lng: meta.longitude });
                    const place = await reverseGeocode(meta.latitude, meta.longitude, locale);
                    if (gen !== draftGenRef.current) return;
                    // **打ち始めていたら上書きしない**（後から届く値で消さない）
                    if (place) setStoryLocation((prev) => {
                        // 実際に書けたときだけ「GPS から来た」印を立てる
                        // （打ち始めていた回は、その文字は本人のもの）
                        if (!prev) locationFromGpsRef.current = true;
                        return prev || place;
                    });
                } catch (e) {
                    log.warn("story location autofill failed:", e);
                }
            })();
        }
    }, [locale, showToast]);

    /**
     * 「投稿する」（`PostSheet`）で選んだファイルを受け取る。バーが描かれていれば
     * その場で、別のページで選ばれたぶんはトップへ移ってきたマウント時に
     * （`lib/utils/storyHandoff.ts`）。以後の流れは入力欄から選んだときと同じ
     */
    useEffect(() => {
        const pending = takeHandedStoryFile();
        if (pending) void handleFileSelect(pending);
        return onStoryFileHandoff((f) => { void handleFileSelect(f); });
    }, [handleFileSelect]);

    // 投稿: 圧縮（画像のみ）→ presigned URL → S3 → レコード作成
    const handlePost = useCallback(async () => {
        if (!draft) return;
        // **送る撮影地は、ここで1回だけ決める。**
        //   - **動画には付けない。** 位置は写真の EXIF から来るもので、動画は
        //     `toUploadSafeVideo` が GPS を落としている（サーバーも同じ判断）
        //   - **設定をもう一度見る。** 引いたのは選んだ時点なので、待っている
        //     間に GPS 自動入力を切られたら送らない（写真側は都度と送信時の
        //     両方で見ていて、こちらは選択時の1回だけだった）。
        //     **ただし効かせるのは GPS から来た地名だけ**（`locationFromGpsRef`）
        //     ——設定を切っている人は自動入力を受けないので、欄に在る文字は
        //     必ず手で打ったもの。そこまで落としていたので、「位置情報を表示」が
        //     入のまま何も送られない、という嘘になっていた
        //   - **座標は送る前に丸める。** 写真のアップロード画面は
        //     `page.tsx:870` で同じことをしている
        const gpsOn = (() => {
            try { return localStorage.getItem("jp_gps_autofill") !== "0"; } catch { return true; }
        })();
        //   - **「位置情報を表示」を切っていたら送らない。** 保存しなければ、
        //     一覧にも、残した写真の撮影地にも、地図にも出ない（隠すのでは
        //     なく持たない）
        const sendLocation = draft.mediaType === "image" && showLocation
            && (gpsOn || !locationFromGpsRef.current)
            ? storyLocation.trim() : "";
        const sendCoords = sendLocation && storyCoords
            ? { lat: Math.round(storyCoords.lat * 100) / 100, lng: Math.round(storyCoords.lng * 100) / 100 }
            : null;
        setPosting(true);
        stopPreview();
        // **投稿中でもやめられるようにする。** 以前は投稿ボタンもキャンセルも
        // `disabled={posting}` で、応答が返らない回線では全画面の下書きから
        // **リロード以外に出る手段が無かった**（実測: 10秒・30秒・60秒とも同じ）。
        // 中断したら、上げ終わっている実体は下の catch が打ち消す
        const controller = new AbortController();
        postAbortRef.current = controller;
        const { signal } = controller;
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
                        showToast(unstrippableMessage(e, locale), "error");
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
                signal,
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
                signal,
                body: uploadFile,
                // サーバーが署名した種別で送る（`content-type` は署名対象。
                // 違う文字列だと S3 が 403 にする）
                headers: { "Content-Type": contentType ?? uploadFile.type },
            });
            if (!s3Res.ok) {
                log.error("story S3 upload failed:", s3Res.status);
                throw new Error(locale === "en" ? "Could not upload the file." : "ファイルをアップロードできませんでした。");
            }

            // **表示名は取りに行かない。** ここで `GET /user/profile` を待って
            // いたが、`createStory` は**クライアントの申告を受け取らない**
            // （なりすまし防止のためサーバーが `lookupDisplayName` で引く。
            // `stories.ts:176` にそう書いてある）。つまり**捨てられる値のために
            // Lambda を1本余計に叩いて、その往復ぶん利用者を待たせていた**
            // ——関数ごとにコールドスタートがあり、同時実行はアカウント全体で
            // 10しかないので、待ちはミリ秒では済まない。
            // 投稿の往復は presign → S3 → 保存 の3つで足りる。

            const saveRes = await userFetch("/stories", {
                method: "POST",
                signal,
                body: JSON.stringify({
                    publicUrl,
                    ...(key ? { key } : {}),
                    mediaType: draft.mediaType,
                    // **文言は `texts` が持つ。** `caption`（残したときの題・
                    // 検索に出る文章）はサーバーがこれを繋いで書く——2か所で持たない
                    ...(texts.length ? { texts } : {}),
                    // **撮影地。** 残したときにそのまま写真の撮影地になる
                    // （`storyKeep.ts`）＝地図と `/location/<スラッグ>` に載る。
                    // 座標は地名とセットのときだけ送る（サーバーも同じ判断）
                    ...(sendLocation ? { location: sendLocation } : {}),
                    // **送る前に丸める。** サーバーも `sanitizeCoords` で丸めるが、
                    // 写真のアップロード画面は**送る前にも**丸めている
                    // （`page.tsx:870`）。片側だけ欠けると、経路が1つ増えた
                    // ときに生の緯度経度が外に出る側へ倒れる
                    ...(sendLocation && sendCoords ? { coords: sendCoords } : {}),
                    ...(draftSong ? { song: { title: draftSong.title, artist: draftSong.artist, artwork: draftSong.artwork, previewUrl: draftSong.previewUrl, trackUrl: draftSong.trackUrl, ...(songStart > 0 ? { startSec: songStart } : {}) } } : {}),
                    ...(draft.mediaType === "image" ? { durationSec } : {}),
                    // **公開設定。** 既定と違うときだけ送る——サーバーも
                    // 既定は保存しないので（`storyVisibility.ts`）、
                    // 既定のまま送っても同じだが、**送らなければ古い版の
                    // サーバーでも今までどおり動く**
                    ...(visibility !== "public" ? { visibility } : {}),
                    ...(allowReplies ? {} : { allowReplies: false }),
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
            // **やめたのは失敗ではない。** 中断は利用者の操作なので、
            // 「投稿に失敗しました」ではなく、やめたことだけ伝えて畳む
            if ((e as { name?: string }).name === "AbortError") {
                closeDraft();
                showToast(locale === "en" ? "Cancelled" : "投稿をやめました", "info");
                return;
            }
            log.error("story upload error:", e);
            // サーバーが断る理由を文章で返している場合はそれを出す。
            // 固定文言で塗り潰していた頃は、枚数を確認できなかった 503 も
            // 上限の 403 も、全部「投稿に失敗しました」になっていて、
            // 利用者は何をすれば通るのか分からなかった。
            const fallback = locale === "en" ? "Failed to post story" : "ストーリーの投稿に失敗しました";
            showToast(e instanceof Error && e.message ? e.message : fallback, "error");
        } finally {
            postAbortRef.current = null;
            setPosting(false);
        }
    }, [draft, texts, storyLocation, storyCoords, draftSong, songStart, durationSec,
        visibility, allowReplies, showLocation,
        locale, showToast, loadStories, closeDraft, stopPreview]);

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
                <p className="text-[11px] text-white/50 px-1 pb-1">
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
                    <div
                        ref={draftMediaAreaRef}
                        className="absolute inset-0 flex items-center justify-center"
                        // **掴むのは文字そのもの。** 複数置けるので、絵のどこを
                        // 掴んでも「いま選んでいる1つ」が飛んでくる形にはできない
                        // （どれを動かしたいのかが決まらない）。掴んだ文字を選び、
                        // 指が離れるまでその1つだけを動かす。追随は
                        // `setPointerCapture` に任せる（指が文字から出ても続く）
                        // **余白は「タップで外す・なぞって動かす」。**
                        //
                        // 文字そのものを掴む形だけだと、操作の欄に隠れた文字に
                        // 指が届かない。選んでいる間は写真のどこをなぞっても
                        // その文字が付いてくるようにする——判定は
                        // `lib/utils/tap.ts`（ストーリーの送りと同じしきい値）。
                        // 文字の上で止めた pointerdown は上の `<p>` が受けて
                        // 伝えないので、ここには来ない
                        onPointerDown={(e) => {
                            if (posting) return;
                            bgPressRef.current = { t: Date.now(), x: e.clientX, y: e.clientY };
                            const area = draftMediaAreaRef.current;
                            if (typeof area?.setPointerCapture === "function") area.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                            // **ハンドルが先。** 角を掴んでいる間は、
                            // 同じ指の動きを「文字を運ぶ」に流さない
                            // （流すと、回しながら文字が指を追って飛んでいく）。
                            //
                            // **掴んだ指のぶんだけ見る。** 囲みは画面いっぱい
                            // （`absolute inset-0`）なので、端末を支える親指が
                            // 触れれば別の `pointerId` がここへ来る。見分けずに
                            // 通すと、その指の座標で回転が決まって**文字が飛ぶ**。
                            // 掴んでいる間は他の指を丸ごと無視する
                            const h = handleGrabRef.current;
                            if (h) {
                                if (e.pointerId === h.pointerId) {
                                    transformText(h.index, handleMove(h.grab, e.clientX, e.clientY));
                                }
                                return;
                            }
                            // 余白から始めたなぞりは、**選んでいる文字**を連れていく
                            const press = bgPressRef.current;
                            if (press && draggingIndexRef.current === null
                                && selected !== null && movedBeyondTap(press, e.clientX, e.clientY)) {
                                draggingIndexRef.current = selected;
                                setDragging(true);
                            }
                            const i = draggingIndexRef.current;
                            if (i === null) return;
                            moveTextTo(i, e.clientX, e.clientY);
                        }}
                        onPointerUp={(e) => {
                            // **ハンドルを離した回は、タップの判定に入れない。**
                            //
                            // **控えは必ず落とす。** 以前はここで早く `return`
                            // していたので `bgPressRef` が残り、別の指
                            // （端末を支える親指）の pointerup を拾った回に
                            // **掴み続けている指の次の動きで文字がそこへ飛んだ**。
                            // 掴んだ指以外では回転を終わらせない
                            const h = handleGrabRef.current;
                            if (h) {
                                bgPressRef.current = null;
                                if (e.pointerId === h.pointerId) {
                                    handleGrabRef.current = null;
                                    setDragging(false);
                                }
                                return;
                            }
                            // 動かさずに離した＝タップ。選択を外して、ほかの欄を戻す
                            const press = bgPressRef.current;
                            bgPressRef.current = null;
                            if (press && draggingIndexRef.current === null
                                && !movedBeyondTap(press, e.clientX, e.clientY)) {
                                setSelected(null);
                            }
                            draggingIndexRef.current = null;
                            setDragging(false);
                        }}
                        onPointerCancel={() => {
                            handleGrabRef.current = null;
                            bgPressRef.current = null;
                            draggingIndexRef.current = null;
                            setDragging(false);
                        }}
                        // 選んでいる間は、端末のスクロールに指を取られない
                        style={selected !== null && !posting ? { touchAction: "none" } : undefined}
                    >
                        {/* ⚠️ **`max-w-full max-h-full`（`w-full h-full` ではない）。**
                            `w-full h-full` だと要素は画面いっぱいで、絵はその中で
                            letterbox される——`getBoundingClientRect` が返すのは
                            **要素**なので、絵の矩形が取れない。見る側
                            （`StoryViewer`）は `max-w/max-h` で要素が絵に縮むので、
                            揃えないと**置いた場所と出る場所がずれる**（実測で
                            ずれていた）。見た目は変わらない——どちらも同じように
                            letterbox される */}
                        {draft.mediaType === "video" ? (
                            <video ref={attachDraftMedia} src={draft.previewUrl} className="block max-w-full max-h-full object-contain" controls playsInline muted loop autoPlay onLoadedData={measureDraftMedia} />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img ref={attachDraftMedia} src={draft.previewUrl} alt="" className="block max-w-full max-h-full object-contain" onLoad={measureDraftMedia} />
                        )}
                        {/* 置いた文字。**見る側とまったく同じ部品**——別々に描くと
                            「置いた場所と出る場所が違う」になる */}
                        {texts.length > 0 && (
                            <StoryTextOverlay
                                texts={texts}
                                box={draftMediaBox}
                                dimmed={dragging}
                                selectedIndex={selected}
                                locale={locale}
                                onNudge={posting ? undefined : nudgeText}
                                onTransform={posting ? undefined : transformText}
                                onGrabHandle={posting ? undefined : grabTextHandle}
                                onPickIndex={posting ? undefined : (i, e) => {
                                    e.preventDefault();
                                    // **囲みへ伝えない。** 囲みの pointerdown は
                                    // 「余白をさわった＝選択を外す」なので、
                                    // 伝わると選んだ直後に外れる
                                    e.stopPropagation();
                                    setSelected(i);
                                    draggingIndexRef.current = i;
                                    setDragging(true);
                                    // 掴んだ文字から指が出ても追随させる。捕まえるのは
                                    // **囲み**（動かす計算がそこの座標を使う）。
                                    //
                                    // ⚠️ **持っているか確かめてから呼ぶ。** 無い環境
                                    // （jsdom で実際に踏んだ）では投げ、ハンドラの中で
                                    // 投げると**その場で掴みごと壊れる**。追随しなく
                                    // なるだけで、動かすこと自体は続けられる
                                    const area = draftMediaAreaRef.current;
                                    if (typeof area?.setPointerCapture === "function") area.setPointerCapture(e.pointerId);
                                }}
                            />
                        )}
                    </div>
                    {/* 上下のスクリム（文字と写真が重なっても読めるように）。
                        **畳んでいる間は下を出さない**——下の 2/3 を暗くするので、
                        置いた姿を見るための画面なのに**本番より暗く見える**
                        （実測: 畳んだ画面で写真の下半分が沈んでいた） */}
                    <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                    {!photoOnly && (
                        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none" />
                    )}

                    <div className="relative flex items-center justify-between p-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
                        <h2 id="story-draft-title" className="text-sm font-semibold text-white drop-shadow">
                            {locale === "en" ? "New story" : "新しいストーリー"}
                        </h2>
                        <div className="flex items-center gap-1">
                        {/* **写真だけにする。** 操作の欄が写真の下半分を覆っていて、
                            置いたあとの姿が見えない／空いている所を指せない。
                            畳めば写真が全部出て、どこでも指で決められる */}
                        <button
                            onClick={() => setPhotoOnly((v) => !v)}
                            disabled={posting}
                            aria-pressed={photoOnly}
                            className="p-2 text-white/80 hover:text-white drop-shadow disabled:opacity-40"
                            aria-label={photoOnly
                                ? (locale === "en" ? "Show controls" : "操作に戻る")
                                : (locale === "en" ? "Show photo only" : "写真だけ見る")}
                        >
                            {photoOnly ? <EyeSlashIcon className="w-6 h-6" /> : <EyeIcon className="w-6 h-6" />}
                        </button>
                        <button
                            ref={draftCancelRef}
                            // **投稿中も押せる。** 押したら要求を中断して畳む
                            onClick={() => {
                                if (posting) { postAbortRef.current?.abort(new DOMException("cancelled", "AbortError")); return; }
                                closeDraft();
                            }}
                            className="p-2 text-white/80 hover:text-white drop-shadow"
                            aria-label={posting
                                ? (locale === "en" ? "Stop posting" : "投稿をやめる")
                                : (locale === "en" ? "Cancel" : "キャンセル")}
                        >
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0" />
                    {/* **動かしている間は操作の欄を引っ込める。** 画面の下半分が
                        欄なので、下の方へ置こうとすると自分で見えない
                        ——「置いた場所が見えないまま置く」ことになる。
                        消すのは見た目だけ（指は写真を掴んだままなので、
                        `pointer-events` を切っても掴みは切れない） */}
                    {photoOnly ? (
                        // **戻る道を必ず出す。** 畳んだまま出られないと、
                        // 投稿もやめることもできなくなる
                        <div className="relative flex justify-center pb-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
                            <button
                                onClick={() => setPhotoOnly(false)}
                                className="px-6 py-3 rounded-full bg-white text-black text-sm font-semibold active:scale-95 transition"
                                style={{ touchAction: "manipulation" }}
                            >
                                {locale === "en" ? "Done" : "完了"}
                            </button>
                        </div>
                    ) : (
                    <>
                    <div
                        className={`relative px-4 pt-3 pb-1 space-y-2 max-h-[60%] overflow-y-auto no-scrollbar transition-opacity ${dragging ? "opacity-0 pointer-events-none" : "opacity-100"}`}
                    >
                        {/* **打つ欄は1つ。** いま選んでいる文字を直す。
                            まだ1つも無ければ、打った時点で1つ目ができる
                            （今までどおり「開いて打つだけ」で置ける） */}
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={currentText?.text ?? ""}
                                onChange={(e) => editText(e.target.value)}
                                maxLength={STORY_TEXT_LEN_MAX}
                                placeholder={texts.length === 0
                                    ? (locale === "en" ? "Add a caption..." : "キャプションを追加...")
                                    : (locale === "en" ? "Edit this text..." : "この文字を直す...")}
                                disabled={posting}
                                aria-label={locale === "en" ? "Text" : "文字"}
                                className="flex-1 min-w-0 px-4 py-3 bg-black/55 backdrop-blur-sm ring-1 ring-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:bg-black/70"
                                style={{ fontSize: "16px" }}
                            />
                            {/* 消す。**選んでいるときだけ**（押しても効かない的を置かない） */}
                            {current && (
                                <button
                                    type="button"
                                    onClick={removeSelected}
                                    disabled={posting}
                                    aria-label={current && isStoryStamp(current)
                                        ? (locale === "en" ? "Delete this sticker" : "このスタンプを消す")
                                        : current && isStoryVote(current)
                                            ? (locale === "en" ? "Delete this poll" : "この投票を消す")
                                            : (locale === "en" ? "Delete this text" : "この文字を消す")}
                                    className="flex-shrink-0 rounded-full bg-black/55 ring-1 ring-white/15 text-white/85 flex items-center justify-center active:scale-90 transition"
                                    style={{ width: "44px", height: "44px" }}
                                >
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            )}
                        </div>

                        {/* 文字の見せ方。**打ってから出す**——文字が無いうちは
                            動かすものも飾るものも無い（押しても効かない欄を置かない）。

                            ⚠️ 大きさは px で書く。640px 未満は root が 14px なので、
                            rem の指定は端末で縮む（`w-11` は 38.5px になる）。
                            間隔も `gap-2`（24px 以上）——`gap-1.5` だと root 14px で
                            5.25px になり、隣の的と重なる（`5960be33` で実測） */}
                        {/* **スタンプ。** 押すと写真の上に置かれる。
                            **文字が1つも無くても出す**——スタンプだけの投稿は
                            ありうる（`caption` が空になるだけで、それが正しい）。

                            上限は文字と合わせて数える（`STORY_TEXTS_MAX`）
                            ——多いほど読めなくなるのは絵柄も同じ。
                            ⚠️ 大きさは px（640px 未満で root が 14px になる） */}
                        <div className="space-y-1">
                            <p id="story-stamp-label" className="text-[11px] text-white/70 px-1">
                                {texts.length >= STORY_TEXTS_MAX
                                    ? (locale === "en" ? `Stickers (max ${STORY_TEXTS_MAX} items)` : `スタンプ（合わせて${STORY_TEXTS_MAX}個まで）`)
                                    : (locale === "en" ? "Stickers" : "スタンプ")}
                            </p>
                            <div className="flex gap-2 overflow-x-auto no-scrollbar" role="group" aria-labelledby="story-stamp-label">
                                {STORY_STAMP_KEYS.map((k) => (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => addStamp(k)}
                                        disabled={posting || texts.length >= STORY_TEXTS_MAX}
                                        aria-label={STORY_STAMPS[k].label}
                                        className="flex-shrink-0 rounded-full bg-black/55 ring-1 ring-white/15 flex items-center justify-center active:scale-90 transition disabled:opacity-40"
                                        style={{ width: "40px", height: "40px", minWidth: "40px", fontSize: "20px", lineHeight: 1 }}
                                    >
                                        <span aria-hidden>{STORY_STAMPS[k].glyph}</span>
                                    </button>
                                ))}
                                {/* **投票（2択）。** 絵柄の並びの最後に1つ。
                                    **1投稿に1つ**なので、置いたら押せなくする
                                    （押せるのに保存で消える、を作らない） */}
                                <button
                                    type="button"
                                    onClick={addVote}
                                    disabled={posting || hasVote || texts.length >= STORY_TEXTS_MAX}
                                    aria-label={hasVote
                                        ? (locale === "en" ? "Poll (one per story)" : "投票（1投稿に1つ）")
                                        : (locale === "en" ? "Add a poll" : "投票を置く")}
                                    className="flex-shrink-0 rounded-full bg-black/55 ring-1 ring-white/15 text-white/85 flex items-center justify-center active:scale-90 transition disabled:opacity-40"
                                    style={{ height: "40px", minWidth: "40px", padding: "0 12px", fontSize: "12px", fontWeight: 700 }}
                                >
                                    {locale === "en" ? "Poll" : "投票"}
                                </button>
                            </div>
                        </div>

                        {texts.length > 0 && (
                            <div className="space-y-2" role="group" aria-labelledby="story-text-style-label">
                                <div className="flex items-center justify-between gap-2 px-1">
                                    {/* **1行に収める。** 折り返すと右のボタンとぶつかる（実測） */}
                                    <p id="story-text-style-label" className="text-[11px] text-white/70 truncate">
                                        {locale === "en" ? "Drag to move · tap to select" : "なぞって移動・触って選択"}
                                    </p>
                                    <div className="flex gap-2 flex-shrink-0">
                                        {/* いちばん手前へ（**並びが重なり順**）。
                                            2つ以上あるときだけ——1つだけなら重なりようが無い */}
                                        {current && texts.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={bringSelectedToFront}
                                                disabled={posting}
                                                aria-label={locale === "en" ? "Bring to front" : "いちばん手前へ"}
                                                className="rounded-full bg-black/55 ring-1 ring-white/15 text-white/85 flex items-center justify-center active:scale-90 transition"
                                                style={{ width: "36px", height: "36px" }}
                                            >
                                                <ChevronDoubleUpIcon className="w-4 h-4" />
                                            </button>
                                        )}
                                        {/* もう1つ置く。上限まで */}
                                        <button
                                            type="button"
                                            onClick={addText}
                                            disabled={posting || texts.length >= STORY_TEXTS_MAX}
                                            aria-label={locale === "en" ? "Add another text" : "文字を追加"}
                                            className="rounded-full bg-black/55 ring-1 ring-white/15 text-white/85 flex items-center justify-center active:scale-90 transition disabled:opacity-40"
                                            style={{ width: "36px", height: "36px" }}
                                        >
                                            <PlusIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* 字体・色・大きさ・下地は**選んでいるときだけ**。
                                    選んでいないと `patchSelected` が何もしないので、
                                    出したままだと**押しても効かない的**が並ぶ */}
                                {/* **スタンプを選んでいるときは、大きさだけ。**
                                    字体・色・下地は絵柄に効かない——出すと
                                    「押しても効かない的」が並ぶ（このファイルが
                                    既に文字について書いている判断を、絵柄にも当てる）。
                                    傾きは角のハンドルと `[` `]`（欄を増やさない） */}
                                {current && isStoryStamp(current) && (
                                <div className="flex items-center gap-3">
                                    <span className="text-white/70 flex-shrink-0" style={{ fontSize: "11px" }} aria-hidden="true">小</span>
                                    <input
                                        type="range"
                                        min={STORY_SIZE_MIN}
                                        max={STORY_SIZE_MAX}
                                        step={STORY_SIZE_STEP}
                                        value={current.size}
                                        onChange={(e) => transformText(selected!, { size: Number(e.target.value) })}
                                        disabled={posting}
                                        aria-label={locale === "en" ? "Sticker size" : "スタンプの大きさ"}
                                        className="flex-1 min-w-0 accent-white"
                                        style={{ height: "36px" }}
                                    />
                                    <span className="text-white/70 flex-shrink-0" style={{ fontSize: "17px", lineHeight: 1 }} aria-hidden="true">大</span>
                                </div>
                                )}

                                {/* **投票を選んでいるときは、問い・2択・大きさ。**
                                    字体・色・下地は出さない（カードの見た目は1種類）。
                                    上限は保存側と同じ定数（超えた分は保存で切られる
                                    ——ここで止めておけば「打てたのに消える」が無い）。
                                    ⚠️ 大きさは px（640px 未満で root が 14px になる） */}
                                {currentVote && (
                                <div className="space-y-2" role="group" aria-label={locale === "en" ? "Poll" : "投票"}>
                                    <input
                                        type="text"
                                        value={currentVote.question}
                                        onChange={(e) => patchVote({ question: e.target.value })}
                                        maxLength={STORY_VOTE_QUESTION_MAX}
                                        disabled={posting}
                                        aria-label={locale === "en" ? "Poll question" : "投票の問い"}
                                        className="w-full rounded-full bg-black/55 ring-1 ring-white/15 text-white px-4 outline-none focus:ring-white/40"
                                        style={{ height: "40px", fontSize: "14px" }}
                                    />
                                    <div className="flex gap-2">
                                        {currentVote.options.map((opt, k) => (
                                            <input
                                                key={k}
                                                type="text"
                                                value={opt}
                                                onChange={(e) => {
                                                    const next: [string, string] = [...currentVote.options];
                                                    next[k] = e.target.value;
                                                    patchVote({ options: next });
                                                }}
                                                maxLength={STORY_VOTE_OPTION_MAX}
                                                disabled={posting}
                                                aria-label={locale === "en" ? `Option ${k + 1}` : `選択肢${k + 1}`}
                                                className="flex-1 min-w-0 rounded-full bg-black/55 ring-1 ring-white/15 text-white px-4 text-center outline-none focus:ring-white/40"
                                                style={{ height: "40px", fontSize: "14px" }}
                                            />
                                        ))}
                                    </div>
                                    {/* 欠けは**ここで言う**（送る前に止めているので、理由が無いと
                                        投稿ボタンが黙って押せないだけになる） */}
                                    {!isCompleteStoryVote(currentVote) && (
                                        <p className="text-white/85 px-1" style={{ fontSize: "12px" }} role="status">
                                            {locale === "en" ? "Fill in the question and both options to post" : "問いと2つの選択肢を入れると投稿できます"}
                                        </p>
                                    )}
                                    <div className="flex items-center gap-3">
                                        <span className="text-white/70 flex-shrink-0" style={{ fontSize: "11px" }} aria-hidden="true">小</span>
                                        <input
                                            type="range"
                                            min={STORY_SIZE_MIN}
                                            max={STORY_SIZE_MAX}
                                            step={STORY_SIZE_STEP}
                                            value={currentVote.size}
                                            onChange={(e) => transformText(selected!, { size: Number(e.target.value) })}
                                            disabled={posting}
                                            aria-label={locale === "en" ? "Poll size" : "投票の大きさ"}
                                            className="flex-1 min-w-0 accent-white"
                                            style={{ height: "36px" }}
                                        />
                                        <span className="text-white/70 flex-shrink-0" style={{ fontSize: "17px", lineHeight: 1 }} aria-hidden="true">大</span>
                                    </div>
                                </div>
                                )}

                                {currentText && (
                                <>
                                {/* 🔴 **1度に1つだけ開く。** 字体・色・大きさ・下地を
                                    全部並べると、320×568 で操作の欄が 276px
                                    ——画面の半分を食っていた（owner:「画面の範囲
                                    奪いすぎてる」）。置く相手の写真がその分だけ広く見える */}
                                <div role="tablist" aria-label={locale === "en" ? "Text style" : "文字の見せ方"} className="flex gap-2">
                                    {([
                                        ["font", locale === "en" ? "Font" : "字体"],
                                        ["color", locale === "en" ? "Color" : "色"],
                                        ["size", locale === "en" ? "Size" : "大きさ"],
                                        ["bg", locale === "en" ? "Box" : "下地"],
                                    ] as const).map(([k, label]) => (
                                        <button
                                            key={k}
                                            type="button"
                                            role="tab"
                                            aria-selected={tool === k}
                                            disabled={posting}
                                            onClick={() => setTool(k)}
                                            className={`flex-1 rounded-full transition ${tool === k ? "bg-white/20 text-white ring-1 ring-white/40" : "text-white/60"}`}
                                            style={{ minHeight: "36px", fontSize: "12px" }}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>

                                <div role="tabpanel" aria-label={locale === "en" ? "Text style" : "文字の見せ方"}>
                                {tool === "font" && (
                                <div className="flex gap-2 overflow-x-auto no-scrollbar" role="group" aria-label={locale === "en" ? "Font" : "字体"}>
                                    {STORY_FONT_KEYS.map((k) => (
                                        <button
                                            key={k}
                                            type="button"
                                            role="switch"
                                            aria-checked={currentText?.font === k}
                                            disabled={posting}
                                            onClick={() => patchSelected({ font: k })}
                                            className={`flex-shrink-0 px-3 rounded-full ring-1 transition ${currentText?.font === k ? "bg-white text-black ring-white" : "bg-black/55 text-white/85 ring-white/15"}`}
                                            style={{ minHeight: "36px", fontFamily: STORY_FONTS[k].css, fontWeight: STORY_FONTS[k].weight, fontSize: "13px" }}
                                        >
                                            {STORY_FONTS[k].label}
                                        </button>
                                    ))}
                                </div>
                                )}

                                {tool === "color" && (
                                <div className="flex gap-2 overflow-x-auto no-scrollbar" role="group" aria-label={locale === "en" ? "Color" : "色"}>
                                    {STORY_COLOR_KEYS.map((k) => (
                                        <button
                                            key={k}
                                            type="button"
                                            role="switch"
                                            aria-checked={currentText?.color === k}
                                            disabled={posting}
                                            onClick={() => patchSelected({ color: k })}
                                            aria-label={STORY_COLORS[k].label}
                                            className={`flex-shrink-0 rounded-full ring-2 transition ${currentText?.color === k ? "ring-white" : "ring-white/25"}`}
                                            style={{ width: "32px", height: "32px", minWidth: "32px", background: STORY_COLORS[k].hex }}
                                        />
                                    ))}
                                </div>
                                )}

                                {tool === "size" && (
                                <>
                                {/* 大きさ。**段階ではなくつまみ。**
                                    4段階のチップ（A A A A）で出していたが、並べても
                                    違いが見分けられず**気づかれなかった**
                                    （owner:「文字の大きさも変えたいよね」）。
                                    つまみなら何ができるか一目で分かり、矢印キーでも動く */}
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] text-white/70 flex-shrink-0" style={{ fontWeight: 700, fontSize: "11px" }} aria-hidden="true">A</span>
                                    <input
                                        type="range"
                                        min={STORY_SIZE_MIN}
                                        max={STORY_SIZE_MAX}
                                        step={STORY_SIZE_STEP}
                                        value={currentText?.size ?? STORY_SIZE_DEFAULT}
                                        onChange={(e) => patchSelected({ size: clampStoryTextSize(Number(e.target.value)) })}
                                        disabled={posting}
                                        aria-label={locale === "en" ? "Text size" : "文字の大きさ"}
                                        className="flex-1 min-w-0 accent-white"
                                        style={{ height: "36px" }}
                                    />
                                    <span className="text-white/70 flex-shrink-0" style={{ fontWeight: 700, fontSize: "19px", lineHeight: 1 }} aria-hidden="true">A</span>
                                </div>
                                </>
                                )}

                                {tool === "bg" && (
                                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                                    <div className="flex gap-2 flex-shrink-0" role="group" aria-label={locale === "en" ? "Text background" : "文字の下地"}>
                                        {STORY_BGS.map((k) => (
                                            <button
                                                key={k}
                                                type="button"
                                                role="switch"
                                                aria-checked={currentText?.bg === k}
                                                disabled={posting}
                                                onClick={() => patchSelected({ bg: k })}
                                                className={`flex-shrink-0 px-3 rounded-full ring-1 transition ${currentText?.bg === k ? "bg-white text-black ring-white" : "bg-black/55 text-white/85 ring-white/15"}`}
                                                style={{ minHeight: "36px", fontSize: "12px" }}
                                            >
                                                {k === "none"
                                                    ? (locale === "en" ? "No box" : "下地なし")
                                                    : k === "soft"
                                                        ? (locale === "en" ? "Dim box" : "うす下地")
                                                        : (locale === "en" ? "Filled" : "塗り")}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                )}
                                </div>
                                </>
                                )}
                            </div>
                        )}

                        {/* 🔴 **文字を置いている間は、ほかの欄を畳む。**
                            320×568 の実測で**写真が 95px しか見えていなかった**
                            ——文字をどこへ置くか決められない。撮影地・曲・表示時間は
                            最後に1回さわるもので、置いている最中には要らない。
                            写真の余白をさわると選択が外れて戻る。 */}
                        {selected === null && (
                        <>
                        {/* **動画には出さない。** 位置は写真の EXIF から来るもので、
                            動画は `toUploadSafeVideo` が GPS を落としている
                            （サーバーも動画の位置は受けない）。押しても効かない
                            欄を置かない */}
                        {draft.mediaType === "image" && (
                        <>
                        {/* **撮影地（任意）。** 写真の GPS から自動で入る
                            （設定 `jp_gps_autofill` がオフなら入らない）。
                            ここを埋めておくと、あとで「残す」を押したときに
                            **そのまま地図に載る写真**になる——空だと本人が
                            編集画面で打つまで何にも繋がらない */}
                        <input
                            type="text"
                            value={storyLocation}
                            onChange={(e) => {
                                // 打ち直した文字は本人のもの（GPS の印を外す）
                                locationFromGpsRef.current = false;
                                setStoryLocation(e.target.value);
                            }}
                            maxLength={200}
                            disabled={posting}
                            placeholder={locale === "en" ? "Where? (optional)" : "撮影地（任意）"}
                            aria-label={locale === "en" ? "Shooting location" : "撮影地"}
                            className="w-full px-4 py-2.5 bg-black/55 backdrop-blur-sm ring-1 ring-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:bg-black/70"
                            style={{ fontSize: "16px" }}
                        />
                        </>
                        )}

                        {/* ストーリーBGM（任意） */}
                        {draftSong ? (
                            <div className="rounded-2xl bg-black/50 backdrop-blur-sm ring-1 ring-white/10 p-2.5 space-y-2.5">
                                <div className="flex items-center gap-2.5">
                                    <SongArtwork src={draftSong.artwork} className="w-9 h-9 rounded-lg object-cover bg-white/10 flex-shrink-0" />
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
                                    <p className="text-[11px] text-white/50">
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
                                    <p className="mt-1.5 text-[10px] text-white/50">
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
                                        onKeyDown={(e) => { if (e.key === "Enter" && !isImeKey(e.nativeEvent)) { e.preventDefault(); void searchDraftSongs(); } }}
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
                                    <button onClick={() => { stopPreview(); setSongPickerOpen(false); clearSongSearch(); setSongQuery(""); }}
                                        className="px-2 text-xs text-white/50 hover:text-white/80 active:scale-95 transition">
                                        {locale === "en" ? "Cancel" : "閉じる"}
                                    </button>
                                </div>
                                {songSearchError && (
                                    <SongSearchError />
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
                                                    <SongArtwork src={r.artwork} className="w-full h-full object-cover bg-white/10" />
                                                    <span className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                                        {previewingId === r.id
                                                            ? <PauseIcon className="w-4 h-4 text-white" />
                                                            : <PlayIcon className="w-4 h-4 text-white" />}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={() => { stopPreview(); setDraftSong(r); setSongStart(0); setSongPickerOpen(false); clearSongSearch(); setSongQuery(""); }}
                                                    className="flex-1 min-w-0 flex items-center gap-2.5 py-2 hover:bg-white/10 active:bg-white/15 transition text-left"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs text-white truncate">{r.title}</p>
                                                        <p className="text-[11px] text-white/50 truncate">{r.artist}</p>
                                                    </div>
                                                    <span className="text-[11px] text-white/50 flex-shrink-0">{locale === "en" ? "Set" : "設定"}</span>
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

                        {/* 公開設定（モックの「公開設定」）。
                            **「親しい友達」と「アーカイブに自動保存」はまだ出さない**
                            ——前者は人を選ぶ一覧、後者はアーカイブそのものが
                            要る。押しても何も起きないものを置かない */}
                        <div className="rounded-2xl bg-black/50 backdrop-blur-sm ring-1 ring-white/10 p-3 space-y-3">
                            <p className="text-white/50" style={{ fontSize: "11px" }}>
                                {locale === "en" ? "Sharing" : "公開設定"}
                            </p>

                            <div className="space-y-2">
                                <p className="text-white/80" style={{ fontSize: "13px" }}>
                                    {locale === "en" ? "Who can see this" : "公開範囲"}
                                </p>
                                <div className="flex gap-2" role="group" aria-label={locale === "en" ? "Who can see this" : "公開範囲"}>
                                    {([
                                        ["public", locale === "en" ? "Everyone" : "全員に公開"],
                                        ["followers", locale === "en" ? "Followers only" : "フォロワーのみ"],
                                    ] as Array<[StoryVisibility, string]>).map(([v, label]) => (
                                        <button
                                            key={v}
                                            type="button"
                                            onClick={() => setVisibility(v)}
                                            disabled={posting}
                                            // **`aria-pressed`。** 2つは排他で、
                                            // 押し直しても外れない（片方は必ず選ばれている）
                                            // ——`role="switch"` はこのリポジトリでは
                                            // 「押し直すと外れる」チップの形（`FilterBar`）。
                                            // すぐ上の表示時間の選択と同じ綴りに揃える
                                            aria-pressed={visibility === v}
                                            className={`px-3 py-1.5 rounded-full transition active:scale-95 disabled:opacity-40 ${visibility === v
                                                ? "bg-white text-black font-semibold"
                                                : "bg-white/5 ring-1 ring-white/10 text-white/60"}`}
                                            style={{ fontSize: "12px", touchAction: "manipulation" }}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <SettingSwitch
                                label={locale === "en" ? "Allow replies" : "返信を許可"}
                                checked={allowReplies}
                                onChange={setAllowReplies}
                                disabled={posting}
                            />

                            {/* **位置情報は写真だけ。** 動画は `toUploadSafeVideo` が
                                GPS を落としていて、サーバーも動画の位置を受けない
                                ——すぐ上の撮影地の欄と同じ条件で出す */}
                            {draft.mediaType === "image" && (
                                <SettingSwitch
                                    label={locale === "en" ? "Show location" : "位置情報を表示"}
                                    checked={showLocation}
                                    onChange={setShowLocation}
                                    disabled={posting}
                                />
                            )}
                        </div>
                        </>
                        )}

                    </div>

                    {/* 🔴 **投稿のボタンは、巻き取られる欄の外に出す。**
                        中に置いていたので、欄が伸びると画面の外へ落ちた
                        ——320×568 の実測で**画面外**（スクロールすれば届くが、
                        いちばん押すものが見えない）。文字の欄を足したこの差分で
                        再発させた（台帳の `STORY-4` と同じ形）。
                        外に出せば、これから何を足しても落ちない */}
                    <div
                        className="relative px-4 pt-2"
                        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
                    >
                        <button
                            onClick={() => void handlePost()}
                            disabled={posting || voteIncomplete}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            style={{ touchAction: "manipulation" }}
                        >
                            {posting && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                            {posting
                                ? (locale === "en" ? "Posting..." : "投稿中...")
                                : (locale === "en" ? "Share to story" : "ストーリーに投稿")}
                        </button>
                    </div>
                    </>
                    )}
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
                    onBlocked={() => { blockedWhileViewingRef.current = true; }}
                    // **閉じてから取り直す。** 開いている間に `groups` を
                    // 差し替えると添字がずれ、見ている最中に別の人の
                    // ストーリーへ飛ぶ（消えるのは自分ではなく相手の束）
                    onClose={() => {
                        setViewerGroup(null);
                        if (blockedWhileViewingRef.current) {
                            blockedWhileViewingRef.current = false;
                            void loadStories();
                        }
                    }}
                />
            )}
        </div>
    );
}
