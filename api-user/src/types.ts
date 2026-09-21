/**
 * 退会済みの印（墓石）が立っているか。
 *
 * 退会でプロフィール行を消すだけにしていた頃、**消したはずのアカウントが
 * 復活しえた**。API Gateway の JWT オーソライザは署名と exp しか見ないので、
 * Cognito のユーザーを消しても既に配ったトークンは期限まで通る。別の端末に
 * 残っていたタブが GET /user/profile を叩くと「行が無い人」に見え、
 * createProfileIfMissing が行を作り直す。
 *
 * **この規則を写経しないこと。** userProfile.ts・follow.ts・userSearch.ts の
 * 3か所が同じ判定を要る。sanitize.ts の「対で保つ」2コピーで、片方だけ直して
 * 食い違わせた前科があるので、こちらは1か所に置いて import する。
 *
 * **DynamoDB から引くときは射影に deletedAt を入れること。** 射影に無ければ
 * 属性は返らず、この判定は**常に false になって死ぬ**（テストのモックは射影を
 * 無視して Item をそのまま返すので、緑のまま穴が開く）。
 */
export function isDeletedProfile(p: unknown): boolean {
    return typeof (p as { deletedAt?: unknown } | null)?.deletedAt === "string";
}

export type Photo = {
    id: string;
    src: string;
    thumbSrc?: string; // 一覧グリッド用の軽量サムネイル（512px WebP）。ない写真は src を使う
    srcOriginal?: string; // EXIF除去前の原本（GPS入り。削除時に必ず消す）
    src256?: string;
    title?: string | Record<string, string>;
    description?: string | Record<string, string[]>;
    category?: string;
    tags?: string[];
    location?: string;
    published?: boolean;
    blurDataURL?: string; // 極小ぼかしプレビュー（data:image/webp;base64,...）
    thumbAvif?: string;   // 512 AVIF（レスポンシブ/AVIF 派生）
    thumbSm?: string;     // 256 WebP
    thumbSmAvif?: string; // 256 AVIF
    srcAvif?: string;     // 詳細用（≤1600）AVIF
    userId?: string;
    uploadedBy?: string;
    displayName?: string;
    createdAt?: string;
    updatedAt?: string;
    coords?: { lat: number; lng: number }; // 撮影地（約1km精度に丸め済み）
    /** 撮影スポット台帳の ID（`spot#...` 行）。確定した紐づけだけ入る */
    spotId?: string;
    /**
     * 一覧（正方形に切り抜く場所）で写真のどこを中心に置くか。0〜1 の割合で、
     * `object-position: x% y%` になる。**未設定なら中央**（今までの挙動）。
     * 読む側（`GalleryGrid` / `ModalImage` / 写真ページ）は前からこれを見て
     * いたが、**書く口がどこにも無かった**ので誰も設定できなかった。
     */
    focalPoint?: { x: number; y: number };
    exif?: {
        camera?: string;
        lens?: string;
        aperture?: string;
        exposure?: string;
        iso?: number;
        focalLength?: string;
        whiteBalance?: string;
        imageSize?: string;
        dateTimeOriginal?: string;
    };
    [key: string]: unknown;
};
