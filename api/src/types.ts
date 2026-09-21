/**
 * 2枚目以降の1枚（1投稿に複数枚）。**`api-user/src/photoImages.ts` の
 * `PhotoImage` と対。** api は api-user を import できないので形だけ写す。
 * 派生を足すときは両方と、両方の削除の列挙を見ること。
 */
export type PhotoImage = {
    src: string;
    srcAvif?: string;
    thumbSrc?: string;
    thumbAvif?: string;
    thumbSm?: string;
    thumbSmAvif?: string;
    width?: number;
    height?: number;
    dominantColor?: string;
    blurDataURL?: string;
};

export type Photo = {
    id: string;
    src: string;
    // 派生画像と表示名。実データにはあるのに admin 側の型だけ古く、
    // 型を頼りに書くと漏れる下地だった（api-user/src/types.ts と対。
    // 派生を足すときは両方の型と mediaKeys.ts の MEDIA_FIELDS も見る）
    srcOriginal?: string;  // EXIF除去前の原本（GPS入り。削除時に必ず消す）
    srcAvif?: string;
    src256?: string;
    thumbSrc?: string;
    thumbSm?: string;
    thumbAvif?: string;
    thumbSmAvif?: string;
    blurDataURL?: string;
    /** 2枚目以降。削除の列挙に必ず通す */
    extraImages?: PhotoImage[];
    displayName?: string;
    title?: string | Record<string, string>;
    description?: string | Record<string, string[]>;
    category?: string;
    tags?: string[];
    location?: string;
    published?: boolean;
    userId?: string; // Cognito sub - 投稿者
    uploadedBy?: string;
    createdAt?: string;
    updatedAt?: string;
    coords?: { lat: number; lng: number }; // 撮影地（約1km精度に丸め済み）
    geoApprox?: boolean; // coords が地名から引いたおおよその値（scripts/geocode-locations.js）なら true
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

export type User = {
    userId: string;       // PK - Cognito sub
    username: string;     // GSI - 一意のhandle (例: ryuhei)
    displayName: string;  // 表示名
    email: string;
    bio?: string;
    avatarKey?: string;   // S3キー (例: avatars/xxx.jpg)
    role?: "admin" | "user";
    createdAt: string;
    updatedAt: string;
};
