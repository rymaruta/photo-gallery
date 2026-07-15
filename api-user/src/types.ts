export type Photo = {
    id: string;
    src: string;
    thumbSrc?: string; // 一覧グリッド用の軽量サムネイル（512px WebP）。ない写真は src を使う
    title?: string | Record<string, string>;
    description?: string | Record<string, string[]>;
    category?: string;
    tags?: string[];
    location?: string;
    published?: boolean;
    userId?: string;
    uploadedBy?: string;
    displayName?: string;
    createdAt?: string;
    updatedAt?: string;
    coords?: { lat: number; lng: number }; // 撮影地（約1km精度に丸め済み）
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
